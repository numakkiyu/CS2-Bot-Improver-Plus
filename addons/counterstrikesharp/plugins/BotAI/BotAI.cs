using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Utils;
using Common;
using Microsoft.Extensions.Logging;
using System.Runtime.InteropServices;

namespace BotAI;

public record PatchInfo(string Name, nint Address, List<byte> OriginalBytes);

public static class BotOffsets
{
    public const int m_gameState   = 0x6038;
    public const int m_isRoundOver = 0x08;
    public const int m_bombState   = 0x0C;
}

[MinimumApiVersion(304)]
public class BotAI : BasePlugin
{
    public override string ModuleName        => "Patches - Bot AI";
    public override string ModuleVersion     => "1.8.1";
    public override string ModuleAuthor      => "K4ryuu & Austin (updated by ed0ard)";
    public override string ModuleDescription =>
        "Improve and fix bots' behavior comprehensively";

    private readonly List<PatchInfo> _appliedPatches = [];

    private readonly Dictionary<string, (string signature, string patch, string expectedOriginal, int patchOffset)>
        _patchDefinitions = new()
    {

        // Force HasVisitedEnemySpawn = 1 so bots don't revisit enemy spawn
        ["HasVisitedEnemySpawn"] = (
            signature:        "40 88 B7 20 05 00 00",
            patch:            "C6 87 20 05 00 00 01",
            expectedOriginal: "40 88 B7 20 05 00 00",
            patchOffset:      0
        ),

        // NOP the BombState reset to avoid bot confusion
        ["GameState_Reset"] = (
            signature:        "83 7F 0C 00 74 07 C7 47 0C 00 00 00 00",
            patch:            "0F 1F 80 00 00 00 00",
            expectedOriginal: "C7 47 0C 00 00 00 00",
            patchOffset:      6
        ),

        // IsSafe() always false in IdleState → bots don't idle near safe areas
        ["Idle_IsSafeAlwaysFalse"] = (
            signature:        "74 28 33 D2 48 8B CE E8 ? ? ? ? 84 C0 75 1A",
            patch:            "EB 28",
            expectedOriginal: "74 28",
            patchOffset:      0
        ),


        // EscapeFromBombState::OnEnter tail-call jmp → ret (prevents crash)
        ["EscapeFromBomb_OnEnter_NoEquipKnife"] = (
            signature:        "C6 83 ? ? 00 00 00 C6 83 ? ? 00 00 00 48 83 C4 20 5B E9",
            patch:            "C3 90 90 90 90",
            expectedOriginal: "E9 ? ? ? ?",
            patchOffset:      19
        ),

        // EscapeFromBombState::OnUpdate call → NOP
        ["EscapeFromBomb_OnUpdate_NoEquipKnife"] = (
            signature:        "75 0F 48 8B 5C 24 50 48 83 C4 40 5F E9 ? ? ? ? E8 ? ? ? ?",
            patch:            "90 90 90 90 90",
            expectedOriginal: "E8 ? ? ? ?",
            patchOffset:      17
        ),

        // EscapeFromFlamesState::OnEnter call → NOP
        ["EscapeFromFlames_OnEnter_NoEquipKnife"] = (
            signature:        "48 8B CB 40 88 BB ? ? 00 00 40 88 BB ? ? 00 00 E8 ? ? ? ? F3 0F 10 0D",
            patch:            "90 90 90 90 90",
            expectedOriginal: "E8 ? ? ? ?",
            patchOffset:      17
        ),


        ["PlantBombLookAtPriorityLow"] = (
            signature:        "41 B9 02 00 00 00 C6 44 24 38 00 F3 0F 10 0D",
            patch:            "41 B9 00 00 00 00",
            expectedOriginal: "41 B9 02 00 00 00",
            patchOffset:      0    // VA 0x18031ae2c
        ),

        ["DefuseBombLookAtPriorityLow"] = (
            signature:        "41 B9 02 00 00 00 C6 44 24 38 00 4C 8B C7",
            patch:            "41 B9 00 00 00 00",
            expectedOriginal: "41 B9 02 00 00 00",
            patchOffset:      0    // VA 0x18031cce6
        ),


        ["AttackState_SkipFireRateCheck"] = (
            signature:        "0F 2F 8B ? ? 00 00 0F 82",
            patch:            "90 90 90 90 90 90",
            expectedOriginal: "0F 82 87 00 00 00",
            patchOffset:      7    // VA 0x1802f22a0
        ),

        // Force bot to hold the trigger at all ranges & all weapons.
        // At the trigger gate, the release-between-shots flag bpl is set to 1 (tap/burst)
        // when fire delay > one tick. Rewrite "mov bpl,1" -> "xor bpl,bpl" so bpl is
        // always 0 (hold trigger) -> continuous spray everywhere; recoil control follows.
        ["SprayAllDistances_ForceHoldTrigger"] = (
            signature:        "76 12 48 8B 05 ? ? ? ? 0F 2F 40 30 76 05 40 B5 01 EB 03 40 32 ED",
            patch:            "40 32 ED",
            expectedOriginal: "40 B5 01",
            patchOffset:      15
        ),

        ["AttackState_SkipSteadyFireShortcut"] = (
            signature:        "0F B6 F0 84 C0 74 3C 48 8B 4B 18 48 8B 11 FF 92 90 00 00 00",
            patch:            "90 90",
            expectedOriginal: "74 3C",
            patchOffset:      5    // RVA 0x2f1be5: je+3C → NOP (remove HasViewBeenSteady fire shortcut)
        ),
 
        ["AttackState_SkipZoomFireShortcut"] = (
            signature:        "FF 90 ? ? 00 00 84 C0 74 15 48 8D 8B ? ? 00 00 48 89 AB",
            patch:            "90 90",
            expectedOriginal: "74 15",
            patchOffset:      8    // RVA 0x2f1c0c: je+15 → NOP (remove IsWaitingForZoom fire shortcut)
        ),

        ["AttackState_SkipSniperSpreadCheck"] = (
            signature:        "41 0F 28 C8 0F 57 C0 FF 15 ? ? ? ? F3 0F 10 0D ? ? ? ? 0F 2F C8 0F 86",
            patch:            "90 90 90 90 90 90",
            expectedOriginal: "0F 86 8A 04 00 00",
            patchOffset:      24  // RVA 0x320153: NOP jbe+47B
        ),


        ["AttackState_DodgeDuringReload"] = (
            signature:        "E9 ? ? ? ? 0F 2F BB ? 00 00 00 76 74",
            patch:            "EB 74",
            expectedOriginal: "76 74",
            patchOffset:      12    // BLOCK_TIMER_A jbe→jmp
        ),

        ["SniperCrouchDodge_jb"] = (
            signature:        "0F 2F BB ? 00 00 00 0F 28 7C 24 30 76 74",
            patch:            "90 90",
            expectedOriginal: "76 74",
            patchOffset:      12    // BLOCK_TIMER_B NOP jbe → DODGE_B (RVA 0x2f2420)
        ),

        ["LowSKill_JumpChance0"] = (
            signature:        "FF 90 90 00 00 00 0F 2F 05 ? ? ? ? 76 11",
            patch:            "EB 40",
            expectedOriginal: "76 11",
            patchOffset:      13    // RVA 0x2f4587: jbe +11 → jmp +40 to non-jump 
        ),

        // Source: AttackState::OnEnter
        // skill>0.5 && (Outnumbered || CanSeeSniper) → dodgeChance=100
        ["AttackState_DodgeChance100_Always"] = (
            signature:        "0F 28 F0 F3 0F 59 35 ? ? ? ? 76 15",
            patch:            "EB 11",
            expectedOriginal: "76 15",
            patchOffset:      11
        ),

        // Source: AttackState::OnUpdate
        // (CanSeeSniper && !IsSniper) → retreat
        ["AttackState_RetreatOnSniper_Disable"] = (
            signature:        "44 38 B6 ? 5C 00 00 74 0C 48 8B CE E8 ? ? ? ? 84 C0",
            patch:            "EB 0C",
            expectedOriginal: "74 0C",
            patchOffset:      7
        ),

        ["AllSkill_KeepMoving_WhenSeeSniper"] = (
            signature:        "0F 2F 05 ? ? ? ? 76 0D 80 BF ? ? 00 00 00 0F 85",
            patch:            "90 90",
            expectedOriginal: "76 0D",
            patchOffset:      7    // RVA 0x2cbb4d: jbe +0D → NOP
        ),

        ["AttackState_CanStrafe_jne"] = (
            signature:        "48 8B CB E8 ? ? ? ? 84 C0 74 7B",
            patch:            "90 90",
            expectedOriginal: "74 7B",
            patchOffset:      10    // RVA 0x2f22b0
        ),

        ["SniperDodge_SkipIsSniper_DodgeA"] = (
            signature:        "84 F6 75 6A 48 8B 05",
            patch:            "90 90",
            expectedOriginal: "75 6A",
            patchOffset:      2    // RVA 0x2f23a8：DODGE_A IsSniper jne+6A → NOP
        ),


        ["Vision_AlwaysWatchApproachPoints"] = (
            signature:        "80 BF ? ? 00 00 00 75 25 0F 2F",
            patch:            "EB 25",
            expectedOriginal: "75 25",
            patchOffset:      7    // VA 0x180319304: jne→jmp
        ),

        ["Vision_ApproachBody_SkipSkillCheck"] = (
            signature:        "0F 2F C7 76 3B 80 BF ? ? 00 00 00 74 32",
            patch:            "90 90",
            expectedOriginal: "76 3B",
            patchOffset:      3
        ),

        ["Vision_ApproachBody_SkipHidingSpotCheck"] = (
            signature:        "0F 2F C7 76 3B 80 BF ? ? 00 00 00 74 32",
            patch:            "90 90",
            expectedOriginal: "74 32",
            patchOffset:      12
        ),

        ["Vision_SkipIsMovingGate"] = (
            signature:        "0F 2F 35 ? ? ? ? 77 0F 49 8B D7 48 8B CF E8",
            patch:            "90 90",
            expectedOriginal: "77 0F",
            patchOffset:      7    //RVA 0x319306: ja → NOP
        ),

        ["Vision_AlwaysEnterApproachBody"] = (
            signature:        "84 C0 75 0D 49 C7 46 08 00 00 00 00 E9",
            patch:            "EB 0D",
            expectedOriginal: "75 0D",
            patchOffset:      2    //RVA 0x31931c: jne → jmp
        ),

        // IsNoticable（raw 0x2DA930）
        ["IsNoticable_AlwaysTrue"] = (
            signature:        "40 53 48 83 EC 30 48 8B D9 BA FF FF FF FF 48 8D 0D ? ? ? ? E8 ? ? ? ? 48 85 C0 75",
            patch:            "B0 01 C3",
            expectedOriginal: "40 53 48",
            patchOffset:      0
        ),

        // InViewCone(bot, target):
        //      angle = GetFOVToPosition(target) 
        //      if angle > 60.0f:
        //          return 0 
        //      eax = 0
        //      angle2 = GetFOVToPosition(target)
        //      eax = (angle2 <= 25.0f) ? 1 : 0
        //      eax += 1
        //      return eax   
        ["InViewCone_RemoveOuterFOV"] = (
            signature:        "FF 90 C8 00 00 00 0F 2F 05 ? ? ? ? 76 08 33 C0",
            patch:            "90 90",
            expectedOriginal: "76 08",
            patchOffset:      13
        ),

        ["InViewCone_RemoveInnerFOV"] = (
            signature:        "0F 96 C0 FF C0 48 83 C4 20 5B C3",
            patch:            "B0 01 90",
            expectedOriginal: "0F 96 C0",
            patchOffset:      0
        ),


        ["InvestigateNoise_SkipSelfDefenseCheck"] = (
            signature:        "83 BB ? ? 00 00 02 74 1E",
            patch:            "90 90",
            expectedOriginal: "74 1E",
            patchOffset:      7     // VA 0x180335696: je → NOP NOP
        ),

        // Source: IdleState::OnUpdate, T-side "bomb planted but site unknown" path
        //   bombSite = GetGameState()->GetNextBombsiteToSearch();
        //   → replaced with:
        //   bombSite = GetGameState()->GetPlantedBombsite();
        // With the patch active: [gameState+0x68] is set at plant time for all bots.
        //  directly to the planted site instead of random searching.
        ["TBot_BombsiteSearch_UseKnownPlantedSite"] = (
            signature:        "48 8B 8E ? ? 00 00 E8 ? ? ? ? 49 8B CC E8 ? ? ? ? 4C 8B 05 ? ? ? ? 85 C0",
            patch:            "E8 55 46 F9 FF",
            expectedOriginal: "E8 D5 3F F9 FF",
            patchOffset:      15
        ),

        // Source: cs_bot_event_bomb / OnBombBeep handler
        //   const float bombBeepHearRangeSq = 1500.0f * 1500.0f;
        //   if (rangeSq > bombBeepHearRangeSq) return;
        // NOP the jbe → CT bots always enter the bombsite-update path,
        // regardless of distance to the bomb.
        ["BombBeep_CT_GlobalHearRange"] = (
            signature:        "F3 0F 59 F6 F3 0F 59 DB F3 0F 59 D2 F3 0F 58 DA F3 0F 58 DE 0F 2F C3 76 67",
            patch:            "90 90",
            expectedOriginal: "76 67",
            patchOffset:      23
        ),

        // Source: cs_bot_event_bomb.cpp — OnBombPickedUp
        //   const float bombPickupHearRangeSq = 1000.0f * 1000.0f;
        //   if (LengthSqr() < bombPickupHearRangeSq) → CT tracks bomber
        // NOP jbe → all CT bots always track who picks up the bomb.
        ["BombPickup_CT_GlobalHearRange"] = (
            signature:        "F3 0F 5C 78 08 F3 0F 59 D2 F3 0F 59 FF F3 0F 58 CA F3 0F 58 CF 0F 28 BC 24 E0 00 00 00 0F 2F C1 76 23",
            patch:            "90 90",
            expectedOriginal: "76 23",
            patchOffset:      32
        ),

        // Source: CCSBot::OnAudibleEvent — universal sound event gate
        //   if (newNoiseDist < range) → heard
        // All sound events (weapon_fire, footsteps, reload, grenade bounce,
        //   door, flashbang, etc.) funnel through OnAudibleEvent.
        // NOP the jbe (6 bytes: 0F 86 → 90 90 90 90 90 90) → every bot
        // hears every sound event regardless of distance. This replaces the
        // need for individual per-event patches
        ["OnAudibleEvent_GlobalHearRange"] = (
            signature:        "F3 44 0F 51 CA EB 0C 0F 28 C2 E8 ? ? ? ? 44 0F 28 C8 45 0F 2F D1 0F 86 ? ? ? ?",
            patch:            "90 90 90 90 90 90",
            expectedOriginal: "0F 86 F4 03 00 00",
            patchOffset:      23
        ),
   
        // Source: CSGameState::OnBombPlanted (cs_gamestate)
        //   // Terrorists always know where the bomb is
        //   if (m_owner->GetTeamNumber() == TEAM_TERRORIST && plantingPlayer)
        //       UpdatePlantedBomb(plantingPlayer->GetAbsOrigin());
        // NOP the jne (75 6D → 90 90) → ALL bots get
        ["OnBombPlanted_AllBotsLearnSite"] = (
            signature:        "80 BA ? ? 00 00 02 75 6D 48 85 DB 74 68",
            patch:            "90 90",
            expectedOriginal: "75 6D",
            patchOffset:      7
        ), 

        // Source: cs_bot_defuse_bomb.cpp — DefuseBombState enter
        //   me->SetDisposition(SELF_DEFENSE);  ← suppresses investigate-noise,
        //   prevents the bot from reacting to anything except direct threats.
        //   SELF_DEFENSE=2, ENGAGE_AND_INVESTIGATE=0, OPPORTUNITY_FIRE=1
        // Patch edx=2 → edx=0 (ENGAGE_AND_INVESTIGATE) so the defusing CT
        // will chase noises and actively hunt while moving to defuse.
        ["CT_Defuse_EngageAndInvestigate"] = (
            signature:        "C7 86 ? ? 00 00 03 00 00 00 BA 02 00 00 00 48 8B CE",
            patch:            "BA 00 00 00 00",
            expectedOriginal: "BA 02 00 00 00",
            patchOffset:      10
        ),

        // Source: cs_bot_defuse_bomb.cpp — DefuseBombState::OnUpdate
        //   me->SetDisposition(CCSBot::SELF_DEFENSE); 
        // mov edx, 2 (SELF_DEFENSE)-> 0 (ENGAGE_AND_INVESTIGATE)
        ["DefuseBombState_OnUpdate_EngageAndInvestigate"] = (
            signature:        "48 8D 8A ? ? 00 00 48 8B DA E8 ? ? ? ? BA 02 00 00 00 48 8B CB",
            patch:            "BA 00 00 00 00",
            expectedOriginal: "BA 02 00 00 00",
            patchOffset:      15
        ),

        // Source: cs_bot_defuse_bomb.cpp — DefuseBombState::OnEnter
        //   me->SetDisposition(CCSBot::SELF_DEFENSE);
        // SetDisposition call at RVA 0x334CC5: edx=2 (SELF_DEFENSE)
        // patch edx=2 → edx=0 (ENGAGE_AND_INVESTIGATE)
        ["DefuseBombState_OnEnter_EngageAndInvestigate"] = (
            signature:        "48 89 5C 24 08 57 48 83 EC 20 48 8B DA BA 02 00 00 00 48 8B CB",
            patch:            "BA 00 00 00 00",
            expectedOriginal: "BA 02 00 00 00",
            patchOffset:      13
        ),


        // Source: cs_bot_weapon.cpp — CheckGrenadeDanger(), flash avoidance block
        //   m_me->ClearLookAt();     ← KEPT (writes to bot state fields, harmless)
        //   m_me->SetLookAt("Avoid Flashbang", away, PRIORITY_UNINTERRUPTABLE, duration);  ← PATCHED OUT
        //   m_me->StopAiming();      ← PATCHED OUT
        //   return false;            ← KEPT (return value unchanged, avoid crash)
        ["FlashbangAvoidance_Disable"] = (
            signature:        "49 8B 0E 0F 14 E3 F2 0F 11 65 17 F3 0F 11 55 1F F3 0F 11 4C 24 20 E8 ? ? ? ? 49 8B 06 C6 80 ? ? 00 00 00",
            patch:            "90 90 90 90 90 90 90 90 90 90 90 90 90 90 90",
            expectedOriginal: "E8 CE BC 02 00 49 8B 06 C6 80 84 5C 00 00 00",
            patchOffset:      22
        ),
    };

    public override void Load(bool hotReload)
    {
        Logger.LogInformation("Bot AI Patches loading...");

        foreach (var name in _patchDefinitions.Keys)
        {
            if (ApplyPatch(name)) Logger.LogInformation($"{name}: applied.");
            else                  Logger.LogError($"{name}: FAILED.");
        }

        RegisterEventHandler<EventPlayerSpawn>((@event, info) =>
        {
            var player = @event.Userid;
            if (player?.IsValid != true || !player.IsBot) return HookResult.Continue;

            var pawn = player.PlayerPawn.Value;
            if (pawn?.IsValid != true
                || player.Team <= CsTeam.Spectator
                || !pawn.BotAllowActive)
                return HookResult.Continue;

            var gameRules = Utilities
                .FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules")
                .FirstOrDefault()?.GameRules;

            if (gameRules == null || gameRules.BombPlanted) return HookResult.Continue;

            UpdateBotBombState(pawn, player.PlayerName);
            return HookResult.Continue;
        });

        Logger.LogInformation($"Applied {_appliedPatches.Count}/{_patchDefinitions.Count} patches.");
    }

    public override void Unload(bool hotReload)
    {
        Logger.LogInformation("Bot AI Patches unloading...");
        foreach (var patch in _appliedPatches) RestorePatch(patch);
        _appliedPatches.Clear();
        Logger.LogInformation("All patches restored.");
    }

    // ── Patch machinery ───────────────────────────────────────────────────────

    private bool ApplyPatch(string name)
    {
        try
        {
            if (!_patchDefinitions.TryGetValue(name, out var def)) return false;

            nint sigAddr = NativeAPI.FindSignature(GameUtils.GetModulePath("server"), def.signature);
            if (sigAddr == 0) { Logger.LogError($"'{name}': signature not found."); return false; }

            nint addr     = sigAddr + def.patchOffset;
            var patchBytes = ParseHex(def.patch);
            if (patchBytes.Count == 0 || !IsValid(addr)) return false;

            var origBytes = new List<byte>();
            for (int i = 0; i < patchBytes.Count; i++)
                origBytes.Add(Marshal.ReadByte(addr, i));

            if (!ValidateOrig(name, origBytes, def.expectedOriginal))
            {
                Logger.LogError($"'{name}': byte mismatch. Expected [{def.expectedOriginal}] " +
                                $"got [{string.Join(" ", origBytes.Select(b => $"{b:X2}"))}].");
                return false;
            }

            if (!MemoryPatch.SetMemAccess(addr, patchBytes.Count)) return false;
            for (int i = 0; i < patchBytes.Count; i++) Marshal.WriteByte(addr, i, patchBytes[i]);

            _appliedPatches.Add(new PatchInfo(name, addr, origBytes));
            Logger.LogInformation($"'{name}' patched at 0x{addr:X} ({patchBytes.Count} bytes).");
            return true;
        }
        catch (Exception ex) { Logger.LogError($"'{name}': {ex.Message}"); return false; }
    }

    private void RestorePatch(PatchInfo p)
    {
        try
        {
            if (!IsValid(p.Address)) return;
            if (!MemoryPatch.SetMemAccess(p.Address, p.OriginalBytes.Count)) return;
            for (int i = 0; i < p.OriginalBytes.Count; i++)
                Marshal.WriteByte(p.Address, i, p.OriginalBytes[i]);
        }
        catch (Exception ex) { Logger.LogError($"Restore '{p.Name}': {ex.Message}"); }
    }

    private bool ValidateOrig(string name, List<byte> actual, string expectedHex)
    {
        try
        {
            var tokens = expectedHex.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (actual.Count != tokens.Length) return false;
            for (int i = 0; i < tokens.Length; i++)
            {
                if (tokens[i] == "?") continue;
                if (actual[i] != Convert.ToByte(tokens[i], 16)) return false;
            }
            return true;
        }
        catch { return false; }
    }

    private static bool IsValid(nint addr)
    {
        if (addr == nint.Zero) return false;
        try { Marshal.ReadByte(addr); return true; }
        catch { return false; }
    }

    private static List<byte> ParseHex(string hex) =>
        [.. hex.Split(' ', StringSplitOptions.RemoveEmptyEntries)
               .Where(t => t != "?")
               .Select(t => Convert.ToByte(t, 16))];

    private bool UpdateBotBombState(CCSPlayerPawn pawn, string playerName)
    {
        try
        {
            if (pawn?.Bot?.Handle is not { } handle || handle == nint.Zero) return false;
            if (!IsValid(handle)) return false;

            nint gsPtr = handle + BotOffsets.m_gameState;
            if (!IsValid(gsPtr)) return false;
            if (Marshal.ReadByte(gsPtr + BotOffsets.m_isRoundOver) != 0) return true;

            nint bombAddr = gsPtr + BotOffsets.m_bombState;
            if (!IsValid(bombAddr)) return false;
            if (!MemoryPatch.SetMemAccess(bombAddr, sizeof(int))) return false;
            if (Marshal.ReadInt32(bombAddr) != 0) Marshal.WriteInt32(bombAddr, 0);
            return true;
        }
        catch (Exception ex)
        {
            Logger.LogError($"UpdateBotBombState({playerName}): {ex.Message}");
            return false;
        }
    }
}
