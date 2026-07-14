namespace BotAI;

internal static class WindowsPatchDefinitions
{
    internal static IReadOnlyDictionary<string, (string signature, string patch, string expectedOriginal, int patchOffset)> All { get; } =
        new Dictionary<string, (string signature, string patch, string expectedOriginal, int patchOffset)>()
    {

        // Force HasVisitedEnemySpawn = 1 so bots don't revisit enemy spawn
        ["HasVisitedEnemySpawn"] = (
        signature: "40 88 B7 20 05 00 00",
        patch: "C6 87 20 05 00 00 01",
        expectedOriginal: "40 88 B7 20 05 00 00",
        patchOffset: 0
        ),

        // NOP the BombState reset to avoid bot confusion
        ["GameState_Reset"] = (
        signature: "83 7F 0C 00 74 07 C7 47 0C 00 00 00 00",
        patch: "0F 1F 80 00 00 00 00",
        expectedOriginal: "C7 47 0C 00 00 00 00",
        patchOffset: 6
        ),

        // IsSafe() always false in IdleState → bots don't idle near safe areas
        ["Idle_IsSafeAlwaysFalse"] = (
        signature: "74 28 33 D2 48 8B CE E8 ? ? ? ? 84 C0 75 1A",
        patch: "EB 28",
        expectedOriginal: "74 28",
        patchOffset: 0
        ),


        // EscapeFromBombState::OnEnter tail-call jmp → ret (prevents crash)
        ["EscapeFromBomb_OnEnter_NoEquipKnife"] = (
        signature: "C6 83 ? ? 00 00 00 C6 83 ? ? 00 00 00 48 83 C4 20 5B E9",
        patch: "C3 90 90 90 90",
        expectedOriginal: "E9 ? ? ? ?",
        patchOffset: 19
        ),

        // EscapeFromBombState::OnUpdate call → NOP
        ["EscapeFromBomb_OnUpdate_NoEquipKnife"] = (
        signature: "75 0F 48 8B 5C 24 50 48 83 C4 40 5F E9 ? ? ? ? E8 ? ? ? ?",
        patch: "90 90 90 90 90",
        expectedOriginal: "E8 ? ? ? ?",
        patchOffset: 17
        ),

        // EscapeFromFlamesState::OnEnter call → NOP
        ["EscapeFromFlames_OnEnter_NoEquipKnife"] = (
        signature: "48 8B CB 40 88 BB ? ? 00 00 40 88 BB ? ? 00 00 E8 ? ? ? ? F3 0F 10 0D",
        patch: "90 90 90 90 90",
        expectedOriginal: "E8 ? ? ? ?",
        patchOffset: 17
        ),


        ["PlantBombLookAtPriorityLow"] = (
        signature: "41 B9 02 00 00 00 C6 44 24 38 00 F3 0F 10 0D",
        patch: "41 B9 00 00 00 00",
        expectedOriginal: "41 B9 02 00 00 00",
        patchOffset: 0    // VA 0x18031ae2c
        ),

        ["DefuseBombLookAtPriorityLow"] = (
        signature: "41 B9 02 00 00 00 C6 44 24 38 00 4C 8B C7",
        patch: "41 B9 00 00 00 00",
        expectedOriginal: "41 B9 02 00 00 00",
        patchOffset: 0    // VA 0x18031cce6
        ),

        // MoveToState::OnUpdate - DefuseBomb IsVisible gate removal
        // Source: if (me->IsVisible(*bombPos)) { me->DefuseBomb(); }
        // Patch: NOP the je that skips DefuseBomb when IsVisible returns false.
        // The two preceding distance checks (72u 3D + 48u 2D) remain intact.
        ["DefuseBomb_SkipIsVisibleCheck"] = (
        signature: "0F 2F C8 0F 86 ? ? ? ? 45 33 C9 45 33 C0 48 8B D3 48 8B CE E8 ? ? ? ? 84 C0 0F 84 ? ? ? ? 48 8B CE",
        patch: "90 90 90 90 90 90",
        expectedOriginal: "0F 84 D9 00 00 00",
        patchOffset: 28
        ),

        ["AttackState_SkipFireRateCheck"] = (
        signature: "0F 2F 8B ? ? 00 00 0F 82",
        patch: "90 90 90 90 90 90",
        expectedOriginal: "0F 82 87 00 00 00",
        patchOffset: 7    // VA 0x1802f22a0
        ),

        // Force bot to hold the trigger at all ranges & all weapons.
        // At the trigger gate, the release-between-shots flag bpl is set to 1 (tap/burst)
        // when fire delay > one tick. Rewrite "mov bpl,1" -> "xor bpl,bpl" so bpl is
        // always 0 (hold trigger) -> continuous spray everywhere; recoil control follows.
        ["SprayAllDistances_ForceHoldTrigger"] = (
        signature: "76 12 48 8B 05 ? ? ? ? 0F 2F 40 30 76 05 40 B5 01 EB 03 40 32 ED",
        patch: "40 32 ED",
        expectedOriginal: "40 B5 01",
        patchOffset: 15
        ),

        ["AttackState_SkipSteadyFireShortcut"] = (
        signature: "0F B6 F0 84 C0 74 3C 48 8B 4B 18 48 8B 11 FF 92 90 00 00 00",
        patch: "90 90",
        expectedOriginal: "74 3C",
        patchOffset: 5    // RVA 0x2f1be5: je+3C → NOP (remove HasViewBeenSteady fire shortcut)
        ),

        ["AttackState_SkipZoomFireShortcut"] = (
        signature: "FF 90 ? ? 00 00 84 C0 74 15 48 8D 8B ? ? 00 00 48 89 AB",
        patch: "90 90",
        expectedOriginal: "74 15",
        patchOffset: 8    // RVA 0x2f1c0c: je+15 → NOP (remove IsWaitingForZoom fire shortcut)
        ),

        ["AttackState_SkipSniperSpreadCheck"] = (
            signature: "41 0F 28 C8 0F 57 C0 FF 15 ? ? ? ? F3 0F 10 0D ? ? ? ? 0F 2F C8 0F 86 ? ? ? ? 48 8B 9E ? ? 00 00",
            patch: "90 90 90 90 90 90",
            expectedOriginal: "0F 86 ? ? ? ?",
            patchOffset: 24  // RVA 0x320153: NOP jbe+47B
        ),


        ["AttackState_DodgeDuringReload"] = (
        signature: "E9 ? ? ? ? 0F 2F BB ? 00 00 00 76 74",
        patch: "EB 74",
        expectedOriginal: "76 74",
        patchOffset: 12    // BLOCK_TIMER_A jbe→jmp
        ),

        ["SniperCrouchDodge_jb"] = (
        signature: "0F 2F BB ? 00 00 00 0F 28 7C 24 30 76 74",
        patch: "90 90",
        expectedOriginal: "76 74",
        patchOffset: 12    // BLOCK_TIMER_B NOP jbe → DODGE_B (RVA 0x2f2420)
        ),

        ["LowSKill_JumpChance0"] = (
        signature: "FF 90 90 00 00 00 0F 2F 05 ? ? ? ? 76 11",
        patch: "EB 40",
        expectedOriginal: "76 11",
        patchOffset: 13    // RVA 0x2f4587: jbe +11 → jmp +40 to non-jump 
        ),

        // Source: AttackState::OnEnter
        // skill>0.5 && (Outnumbered || CanSeeSniper) → dodgeChance=100
        // wildcard the jbe displacement (0x14/0x15 depends on
        // whether the movaps xmm6,xmm<const> is 3 or 4 bytes). The EB 11 patch jumps to
        // that movaps (jbe+0x13), which is invariant across all tested versions.
        ["AttackState_DodgeChance100_Always"] = (
            signature: "0F 28 F0 F3 0F 59 35 ? ? ? ? 76 ?",
            patch: "EB 11",
            expectedOriginal: "76 ?",
            patchOffset: 11
        ),

        // Source: AttackState::OnUpdate
        // (CanSeeSniper && !IsSniper) → retreat
        // anchor on the two consecutive (je; mov rcx,rsi; call; test al,al) blocks,
        // whose encoding varies (44 38 B6 / r14b vs 38 9E / bl). Patch flips only the
        // opcode 74->EB, preserving whatever displacement is present.
        ["AttackState_RetreatOnSniper_Disable"] = (
            signature: "74 ? 48 8B CE E8 ? ? ? ? 84 C0 74 ? 48 8B CE E8 ? ? ? ? 84 C0",
            patch: "EB",
            expectedOriginal: "74",
            patchOffset: 0
        ),

        ["AllSkill_KeepMoving_WhenSeeSniper"] = (
        signature: "0F 2F 05 ? ? ? ? 76 0D 80 BF ? ? 00 00 00 0F 85",
        patch: "90 90",
        expectedOriginal: "76 0D",
        patchOffset: 7    // RVA 0x2cbb4d: jbe +0D → NOP
        ),

        // Anchor on the preceding AttackState CanStrafe
        // gate (comiss xmm1,[rbx+0xac]; jb; mov rcx,rbx; call CanStrafe; test al,al; je).
        ["AttackState_CanStrafe_jne"] = (
        signature: "0F 2F 8B ? ? 00 00 0F 82 ? ? ? ? 48 8B CB E8 ? ? ? ? 84 C0 74 7B",
        patch: "90 90",
        expectedOriginal: "74 7B",
        patchOffset: 23    // je+7B at AttackState CanStrafe gate (710 rva 0x2f1580)
        ),

        ["SniperDodge_SkipIsSniper_DodgeA"] = (
        signature: "84 F6 75 6A 48 8B 05",
        patch: "90 90",
        expectedOriginal: "75 6A",
        patchOffset: 2    // RVA 0x2f23a8：DODGE_A IsSniper jne+6A → NOP
        ),


        ["Vision_AlwaysWatchApproachPoints"] = (
        signature: "80 BF ? ? 00 00 00 75 25 0F 2F",
        patch: "EB 25",
        expectedOriginal: "75 25",
        patchOffset: 7    // VA 0x180319304: jne→jmp
        ),

        // wildcard the comiss register byte (xmm6/xmm7 varies by build) 
        // and the jbe displacement. Anchored on movss xmm0,[rax+0xc]; comiss; jbe.
        ["Vision_ApproachBody_SkipSkillCheck"] = (
            signature: "F3 0F 10 40 0C 0F 2F ? 76 ?",
            patch: "90 90",
            expectedOriginal: "76 ?",
            patchOffset: 8
        ),

        // The trailing cmp byte[reg+0x43] encoding varies
        // (41 80 7E.. / r14 vs 80 7D.. / rbp), so anchor only on the CanSeeSniper cmp
        // (cmp byte[rdi+0x5c??],0) + its je.
        ["Vision_ApproachBody_SkipHidingSpotCheck"] = (
            signature: "80 BF ? 5C 00 00 00 74 ?",
            patch: "90 90",
            expectedOriginal: "74 ?",
            patchOffset: 7
        ),

        ["Vision_SkipIsMovingGate"] = (
            signature: "0F 2F 35 ? ? ? ? 77 ? 49 8B ? 48 8B CF E8 ? ? ? ? 84 C0 75 ?",
            patch: "90 90",
            expectedOriginal: "77 ?",
            patchOffset: 7
        ),

        // Wildcard the REX/modrm of the following
        // mov qword[reg+8],0 (49 C7 46 / r14 vs 48 C7 45 / rbp). Patch flips 75->EB,
        // keeping the displacement.
        ["Vision_AlwaysEnterApproachBody"] = (
            signature: "84 C0 75 ? ? C7 ? 08 00 00 00 00 E9 ? ? ? ?",
            patch: "EB",
            expectedOriginal: "75",
            patchOffset: 2
        ),

        // IsNoticable（raw 0x2DA930）
        ["IsNoticable_AlwaysTrue"] = (
        signature: "40 53 48 83 EC 30 48 8B D9 BA FF FF FF FF 48 8D 0D ? ? ? ? E8 ? ? ? ? 48 85 C0 75",
        patch: "B0 01 C3",
        expectedOriginal: "40 53 48",
        patchOffset: 0
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
        // NOP the outer-FOV jbe so the function falls
        // through to `xor eax,eax; ret` (returns 0).
        // the companion InViewCone_RemoveInnerFOV branch is then never reached (as in stable).
        ["InViewCone_RemoveOuterFOV"] = (
            signature: "FF 90 ? ? 00 00 0F 2F 05 ? ? ? ? 76 08 33 C0 48 83 C4 20 5B C3 48 8B 03 48 8B CB FF 90 ? ? 00 00",
            patch: "90 90",
            expectedOriginal: "76 08",
            patchOffset: 13
        ),

        ["InViewCone_RemoveInnerFOV"] = (
        signature: "0F 96 C0 FF C0 48 83 C4 20 5B C3",
        patch: "B0 01 90",
        expectedOriginal: "0F 96 C0",
        patchOffset: 0
        ),


        ["InvestigateNoise_SkipSelfDefenseCheck"] = (
        signature: "83 BB ? ? 00 00 02 74 1E",
        patch: "90 90",
        expectedOriginal: "74 1E",
        patchOffset: 7     // VA 0x180335696: je → NOP NOP
        ),

        // Source: IdleState::OnUpdate, T-side "bomb planted but site unknown" path
        //   bombSite = GetGameState()->GetNextBombsiteToSearch();
        //   → replaced with:
        //   bombSite = GetGameState()->GetPlantedBombsite();
        // With the patch active: [gameState+0x68] is set at plant time for all bots.
        //  directly to the planted site instead of random searching.
        ["TBot_BombsiteSearch_UseKnownPlantedSite"] = (
            signature: "48 8B 8E ? ? 00 00 E8 ? ? ? ? ? 8B ? E8 ? ? ? ? 4C 8B 05 ? ? ? ? 85 C0",
            patch: "E8 28 41 F9 FF",
            expectedOriginal: "E8 38 3B F9 FF",
            patchOffset: 15
        ),

        // Source: cs_bot_event_bomb / OnBombBeep handler
        //   const float bombBeepHearRangeSq = 1500.0f * 1500.0f;
        //   if (rangeSq > bombBeepHearRangeSq) return;
        // NOP the jbe → CT bots always enter the bombsite-update path,
        // regardless of distance to the bomb.
        ["BombBeep_CT_GlobalHearRange"] = (
            signature: "0F 2F ? 76 67 48 8B ? 18 80 B8 44 03 00 00 03",
            patch: "90 90",
            expectedOriginal: "76 67",
            patchOffset: 3
        ),

        // Source: cs_bot_event_bomb.cpp — OnBombPickedUp
        //   const float bombPickupHearRangeSq = 1000.0f * 1000.0f;
        //   if (LengthSqr() < bombPickupHearRangeSq) → CT tracks bomber
        // NOP jbe → all CT bots always track who picks up the bomb.
        ["BombPickup_CT_GlobalHearRange"] = (
            signature: "0F 2F ? 76 23 48 8B ? ? 5E 00 00 E8",
            patch: "90 90",
            expectedOriginal: "76 23",
            patchOffset: 3
        ),

        // Source: CCSBot::OnAudibleEvent — universal sound event gate
        //   if (newNoiseDist < range) → heard
        // All sound events (weapon_fire, footsteps, reload, grenade bounce,
        //   door, flashbang, etc.) funnel through OnAudibleEvent.
        // NOP the jbe (6 bytes: 0F 86 → 90 90 90 90 90 90) → every bot
        // hears every sound event regardless of distance. This replaces the
        // need for individual per-event patches
        ["OnAudibleEvent_GlobalHearRange"] = (
            signature: "F3 44 0F 51 CA EB 0C 0F 28 C2 E8 ? ? ? ? 44 0F 28 C8 45 0F 2F D1 0F 86 ? ? ? ?",
            patch: "90 90 90 90 90 90",
            expectedOriginal: "0F 86 ? ? ? ?",
            patchOffset: 23
        ),

        // Source: CSGameState::OnBombPlanted (cs_gamestate)
        //   // Terrorists always know where the bomb is
        //   if (m_owner->GetTeamNumber() == TEAM_TERRORIST && plantingPlayer)
        //       UpdatePlantedBomb(plantingPlayer->GetAbsOrigin());
        // NOP the jne → ALL bots learn the planted site.
        // Anchored on cmp byte[rdx+0x3??],2; jne;
        // test rbx,rbx; je (the "team==T && plantingPlayer" gate).
        ["OnBombPlanted_AllBotsLearnSite"] = (
            signature: "80 BA ? ? 00 00 02 0F 85 ? ? ? ? 48 85 DB 0F 84 ? ? ? ?",
            patch: "90 90 90 90 90 90",
            expectedOriginal: "0F 85 ? ? ? ?",
            patchOffset: 7
        ),

        // Source: cs_bot_defuse_bomb.cpp — DefuseBombState enter
        //   me->SetDisposition(SELF_DEFENSE);  ← suppresses investigate-noise,
        //   prevents the bot from reacting to anything except direct threats.
        //   SELF_DEFENSE=2, ENGAGE_AND_INVESTIGATE=0, OPPORTUNITY_FIRE=1
        // Patch edx=2 → edx=0 (ENGAGE_AND_INVESTIGATE) so the defusing CT
        // will chase noises and actively hunt while moving to defuse.
        ["CT_Defuse_EngageAndInvestigate"] = (
        signature: "C7 86 ? ? 00 00 03 00 00 00 BA 02 00 00 00 48 8B CE",
        patch: "BA 00 00 00 00",
        expectedOriginal: "BA 02 00 00 00",
        patchOffset: 10
        ),

        // Source: cs_bot_defuse_bomb.cpp — DefuseBombState::OnUpdate
        //   me->SetDisposition(CCSBot::SELF_DEFENSE); 
        // mov edx, 2 (SELF_DEFENSE)-> 0 (ENGAGE_AND_INVESTIGATE)
        ["DefuseBombState_OnUpdate_EngageAndInvestigate"] = (
        signature: "48 8D 8A ? ? 00 00 48 8B DA E8 ? ? ? ? BA 02 00 00 00 48 8B CB",
        patch: "BA 00 00 00 00",
        expectedOriginal: "BA 02 00 00 00",
        patchOffset: 15
        ),

        // Source: cs_bot_defuse_bomb.cpp — DefuseBombState::OnEnter
        //   me->SetDisposition(CCSBot::SELF_DEFENSE);
        // SetDisposition call at RVA 0x334CC5: edx=2 (SELF_DEFENSE)
        // patch edx=2 → edx=0 (ENGAGE_AND_INVESTIGATE)
        ["DefuseBombState_OnEnter_EngageAndInvestigate"] = (
        signature: "48 89 5C 24 08 57 48 83 EC 20 48 8B DA BA 02 00 00 00 48 8B CB",
        patch: "BA 00 00 00 00",
        expectedOriginal: "BA 02 00 00 00",
        patchOffset: 13
        ),


        // Source: cs_bot_weapon.cpp — CheckGrenadeDanger(), flash avoidance block
        //   m_me->ClearLookAt();     ← KEPT (writes to bot state fields, harmless)
        //   m_me->SetLookAt("Avoid Flashbang", away, PRIORITY_UNINTERRUPTABLE, duration);  ← PATCHED OUT
        //   m_me->StopAiming();      ← PATCHED OUT
        //   return false;            ← KEPT (return value unchanged, avoid crash)
        // Wildcard the flag field offset low byte (0x5c7c/0x5c84
        // varies). NOPs exactly the 15 bytes call + mov rax,[r14] + mov byte[rax+0x5c??],0;
        // the trailing `32 C0` (xor al,al = return false) is kept as an anchor, not patched.
        ["FlashbangAvoidance_Disable"] = (
            signature: "E8 ? ? ? ? 49 8B 06 C6 80 ? 5C 00 00 00 32 C0",
            patch: "90 90 90 90 90 90 90 90 90 90 90 90 90 90 90",
            expectedOriginal: "E8 ? ? ? ? 49 8B 06 C6 80 ? 5C 00 00 00",
            patchOffset: 0
        ),
    };
}
