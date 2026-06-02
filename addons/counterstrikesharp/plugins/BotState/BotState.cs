using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Utils;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Core.Capabilities;
using RayTraceAPI;
using System;

namespace BotState;

public class BotState : BasePlugin
{
    public override string ModuleName => "Smarter-Bot";
    public override string ModuleVersion => "1.7.1";
    public override string ModuleAuthor => "ed0ard & XBribo";
    public override string ModuleDescription => "Make bots smarter";

    private const float ExpandedValue = 500f;
    private const float NormalValue = 50f;
    private const float RestoreDelay = 1.0f;

    private bool _isExpanded = false;
    private ConVar? _smokeConVar;
    private bool _isBombBeingDefused = false;
    private bool _isDefuseExpanded = false;
    private CounterStrikeSharp.API.Modules.Timers.Timer? _defuseExpandTimer = null;

    private readonly Random _random = new Random();

    private readonly Dictionary<int, bool> _prevInAir = new();
    private readonly Dictionary<int, float> _lastForwardDir = new();
    private readonly Dictionary<int, float> _ladderExitTime = new();
    private readonly Dictionary<int, float> _lastLateralDir = new();
    private readonly Dictionary<int, float> _doorEventCooldown = new();

    private readonly Dictionary<int, float> _stuckStartTime = new();
    private readonly Dictionary<int, Vector> _stuckStartPos = new();
    private readonly Dictionary<int, bool> _stuckJumpDone = new();
    private readonly Dictionary<int, int> _stuckJumpCount = new();
    private readonly Dictionary<int, float> _stuckMaxSpeed = new();
    private readonly Dictionary<int, float> _idleStartTime = new();
    private readonly Dictionary<int, float> _lastRepathTime = new();
    private bool _isFreezeTime = false;

    private readonly HashSet<int> _hasFiredThisAttack = new();
    private readonly Dictionary<int, bool> _prevIsAttacking = new();

    private readonly Dictionary<int, bool> _cachedInAir = new();
    private readonly Dictionary<int, bool> _cachedNearLadder = new();

    // Flashbang avoidance via Ray-Trace
    private static readonly PluginCapability<CRayTraceInterface> RayTraceCap =
        new("raytrace:craytraceinterface");
    private CRayTraceInterface? _rayTrace;
    private Vector? _scratchEye;

    private const float FlashFuseSeconds = 1.5f;        // CS2 flashbang fuse
    private const float FlashFovHorizDeg = 110f;        // bot horizontal cone (full angle)
    private const float FlashFovVertDeg = 90f;         // bot vertical cone (full angle)
    private readonly Dictionary<uint, float> _flashThrownAt = new();   // flash entindex -> server time first seen
    private readonly Dictionary<int, HashSet<uint>> _flashRolledByBot = new(); // bot idx  -> evaluated flashes

    // Per-(bot, flash) decision + sight window. Single source of truth consumed by OnPlayerBlind.
    private struct FlashDecision
    {
        public float FirstSeen;
        public float LastSeen;
        public float DetonateAt;
        public bool Avoided;
    }
    private readonly Dictionary<(int bot, uint flash), FlashDecision> _flashDecisions = new();
    private readonly HashSet<(int bot, uint flash)> _flashRejectLogged = new();

    // Debug logging (toggle with `css_botstate_flashdebug`)
    private bool _debugFlash = false;
    //---------------------------------------------------------------------------------------
    public override void Load(bool hotReload)
    {
        _smokeConVar = ConVar.Find("bot_max_visible_smoke_length");
        RegisterEventHandler<EventPlayerHurt>(OnPlayerHurt);
        RegisterEventHandler<EventPlayerSpawn>(OnPlayerSpawn);
        RegisterEventHandler<EventRoundFreezeEnd>(OnRoundFreezeEnd);
        RegisterEventHandler<EventPlayerBlind>(OnPlayerBlind);
        RegisterEventHandler<EventBombPlanted>(OnBombPlanted);
        RegisterEventHandler<EventBombBegindefuse>(OnBombBeginDefuse);
        RegisterEventHandler<EventBombAbortdefuse>(OnBombAbortDefuse);
        RegisterEventHandler<EventBombDefused>(OnBombDefused);
        RegisterEventHandler<EventBombExploded>(OnBombExploded);
        RegisterEventHandler<EventDoorOpen>(OnDoorOpen);
        RegisterEventHandler<EventDoorClose>(OnDoorClose);
        RegisterEventHandler<EventWeaponFire>(OnWeaponFire);
        RegisterListener<Listeners.OnTick>(OnTick);
    }

    public override void OnAllPluginsLoaded(bool hotReload)
    {
        try { _rayTrace = RayTraceCap.Get(); } catch { _rayTrace = null; }
        if (_rayTrace == null)
            Console.WriteLine("[Smarter-Bot] Ray-Trace not available");
        else
            _scratchEye = new Vector();
    }

    [ConsoleCommand("css_botstate_flashdebug", "Toggle Smarter-Bot flashbang debug log")]
    [CommandHelper(minArgs: 0, usage: "[0|1]", whoCanExecute: CommandUsage.CLIENT_AND_SERVER)]
    public void OnFlashDebugCmd(CCSPlayerController? caller, CommandInfo cmd)
    {
        if (cmd.ArgCount > 1)
        {
            string arg = cmd.GetArg(1);
            _debugFlash = arg == "1"
                       || arg.Equals("true", StringComparison.OrdinalIgnoreCase)
                       || arg.Equals("on", StringComparison.OrdinalIgnoreCase);
        }
        else
        {
            _debugFlash = !_debugFlash;
        }

        cmd.ReplyToCommand($"[Smarter-Bot] flash debug = {_debugFlash}");
        cmd.ReplyToCommand($"[Smarter-Bot] ray-trace loaded = {_rayTrace != null}");
        Console.WriteLine($"[Smarter-Bot] flash debug = {_debugFlash}, raytrace = {_rayTrace != null}");
    }

    // Server stdout + every connected human's console. Use only for debug-gated lines
    // so we don't spam non-debug runs.
    private static void BroadcastDebug(string msg)
    {
        Console.WriteLine(msg);
        foreach (var p in Utilities.GetPlayers())
        {
            if (p == null || !p.IsValid || p.IsBot || p.IsHLTV) continue;
            p.PrintToConsole(msg);
        }
    }
    //---------------------------------------------------------------------------------------
    private HookResult OnPlayerHurt(EventPlayerHurt @event, GameEventInfo _)
    {
        try
        {
            var victim = @event.Userid;
            if (victim == null || !victim.IsValid || !victim.IsBot) return HookResult.Continue;

            if (!_isExpanded)
            {
                _isExpanded = true;
                SetSmokeLength(ExpandedValue);
                AddTimer(RestoreDelay, () =>
                {
                    SetSmokeLength(NormalValue);
                    _isExpanded = false;
                });
            }
        }
        catch { }
        return HookResult.Continue;
    }

    private void SetSmokeLength(float value)
    {
        if (_smokeConVar != null)
            _smokeConVar.SetValue(value);
        else
            Server.ExecuteCommand($"bot_max_visible_smoke_length {value}");
    }

    public override void Unload(bool hotReload)
    {
        SetSmokeLength(NormalValue);
        _defuseExpandTimer?.Kill();
    }
    // Spam smoke when an enemy is defusing the bomb
    private HookResult OnBombAbortDefuse(EventBombAbortdefuse @event, GameEventInfo info)
    {
        StopDefuseSmoke();
        return HookResult.Continue;
    }

    private HookResult OnBombDefused(EventBombDefused @event, GameEventInfo info)
    {
        StopDefuseSmoke();
        return HookResult.Continue;
    }

    private HookResult OnBombExploded(EventBombExploded @event, GameEventInfo info)
    {
        StopDefuseSmoke();
        return HookResult.Continue;
    }

    private void StopDefuseSmoke()
    {
        _isBombBeingDefused = false;
        _defuseExpandTimer?.Kill();
        _defuseExpandTimer = null;
        if (_isDefuseExpanded)
        {
            _isDefuseExpanded = false;
            SetSmokeLength(NormalValue);
        }
    }

    private void StartDefuseSmokeCycle()
    {
        if (_defuseExpandTimer != null) return;

        _defuseExpandTimer = AddTimer(3.5f, () =>
        {
            _defuseExpandTimer = null;
            if (!_isBombBeingDefused) return;

            _isDefuseExpanded = true;
            SetSmokeLength(ExpandedValue);

            AddTimer(1.5f, () =>
            {
                _isDefuseExpanded = false;
                SetSmokeLength(NormalValue);
                if (_isBombBeingDefused) StartDefuseSmokeCycle();
            });
        });
    }
    //---------------------------------------------------------------------------------------
    private HookResult OnPlayerBlind(EventPlayerBlind @event, GameEventInfo info)
    {
        var player = @event.Userid;

        if (player is null || !player.IsValid || !player.IsBot)
            return HookResult.Continue;
        // In case the bot has been taken over
        bool isTakenOver = player.HasBeenControlledByPlayerThisRound;
        if (isTakenOver)
            return HookResult.Continue;

        int bidx = (int)player.Index;
        float origBlind = @event.BlindDuration;
        bool isImmune;

        // Match this blind event to the bot's most-recently-detonating tracked flash.
        // detonateAt should be ~now; allow a 250ms slack since CSS event dispatch and tick
        // boundaries don't line up exactly.
        float matchNow = Server.CurrentTime;
        (int bot, uint flash)? matchedKey = null;
        FlashDecision matched = default;
        float bestDelta = float.MaxValue;
        foreach (var kvp in _flashDecisions)
        {
            if (kvp.Key.bot != bidx) continue;
            float delta = Math.Abs(kvp.Value.DetonateAt - matchNow);
            if (delta < bestDelta && delta < 0.25f)
            {
                bestDelta = delta;
                matchedKey = kvp.Key;
                matched = kvp.Value;
            }
        }

        if (_rayTrace != null)
        {
            if (matchedKey.HasValue)
            {
                isImmune = matched.Avoided;
                _flashDecisions.Remove(matchedKey.Value);
            }
            else
            {
                // Bot never saw this flash through FOV+LOS — should be flashed normally
                isImmune = false;
            }
        }
        else
        {
            // Fallback when raytrace is unavailable
            isImmune = _random.NextDouble() <= 0.6;
        }

        if (isImmune)
        {
            @event.BlindDuration = 0f;
            var pawn = player.PlayerPawn?.Value;
            if (pawn != null && pawn.IsValid)
            {
                ref float blindStartTime = ref pawn.BlindStartTime;
                blindStartTime = 0f;

                ref float blindUntilTime = ref pawn.BlindUntilTime;
                blindUntilTime = 0f;

                ref float flashDuration = ref pawn.FlashDuration;
                flashDuration = 0f;

                ref float flashMaxAlpha = ref pawn.FlashMaxAlpha;
                flashMaxAlpha = 0f;
            }
        }

        if (_debugFlash)
        {
            string detail;
            if (matchedKey.HasValue)
            {
                float visibleMs = (matched.LastSeen - matched.FirstSeen) * 1000f;
                detail = $"flash#{matchedKey.Value.flash} visible={visibleMs:F0}ms rolled={(matched.Avoided ? "AVOID" : "flash")}";
            }
            else
            {
                detail = "no tracked flash (out of FOV / occluded entire flight)";
            }
            BroadcastDebug(
                $"[Smarter-Bot/Flash] blind event bot={player.PlayerName} immune={isImmune} origDur={origBlind:F2}s ({detail})");
        }

        return HookResult.Continue;
    }
    //---------------------------------------------------------------------------------------
    [GameEventHandler]
    public HookResult OnPlayerSpawn(EventPlayerSpawn @event, GameEventInfo info)
    {
        var player = @event.Userid;
        if (player == null || !player.IsValid || !player.IsBot)
            return HookResult.Continue;

        Server.NextFrame(() =>
        {
            if (player == null || !player.IsValid) return;
            ApplyBotState(player);
        });

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnRoundFreezeEnd(EventRoundFreezeEnd @event, GameEventInfo info)
    {
        _isFreezeTime = false;
        foreach (var player in Utilities.FindAllEntitiesByDesignerName<CCSPlayerController>("cs_player_controller"))
        {
            if (!player.IsValid || !player.IsBot) continue;
            ApplyBotState(player);
        }
        return HookResult.Continue;
    }
    //---------------------------------------------------------------------------------------
    private void OnTick()
    {
        ProcessFlashbangAvoidance();

        foreach (var player in Utilities.FindAllEntitiesByDesignerName<CCSPlayerController>("cs_player_controller"))
        {
            if (!player.IsValid || !player.IsBot)
                continue;

            var pawn = player.PlayerPawn.Value;
            if (pawn == null || !pawn.IsValid)
                continue;

            var bot = pawn.Bot;
            if (bot == null)
                continue;
            // In case the bot has been taken over
            bool isTakenOver = player.HasBeenControlledByPlayerThisRound;
            if (isTakenOver) continue;

            int idx = (int)player.Index;
            float now = Server.CurrentTime;
            // Door Stuck Fix
            bool inDoorCooldown = _doorEventCooldown.TryGetValue(idx, out float doorCooldownEnd) && now < doorCooldownEnd;

            ref bool isSleeping = ref bot.IsSleeping;
            isSleeping = false;

            ref bool allowActive = ref bot.AllowActive;
            allowActive = true;

            ref bool isRapidFiring = ref bot.IsRapidFiring;
            isRapidFiring = true;

            ref float peripheralTimestamp = ref bot.PeripheralTimestamp;
            peripheralTimestamp = 0.0f;

            ref float fireWeaponTimestamp = ref bot.FireWeaponTimestamp;
            fireWeaponTimestamp = 0.0f;
            // Alert
            CountdownTimer alertTimer = bot.AlertTimer;
            ref float alertduration = ref alertTimer.Duration;
            alertduration = 600.0f;

            ref float alerttimestamp = ref alertTimer.Timestamp;
            alerttimestamp = now + alertduration;

            ref float alerttimescale = ref alertTimer.Timescale;
            alerttimescale = 1.0f;
            // Never ignore enemies
            CountdownTimer ignoreEnemiesTimer = bot.IgnoreEnemiesTimer;

            ref float ignoreEnemiesduration = ref ignoreEnemiesTimer.Duration;
            ignoreEnemiesduration = 0.0f;

            ref float ignoreEnemiestimestamp = ref ignoreEnemiesTimer.Timestamp;
            ignoreEnemiestimestamp = 0.0f;

            ref float ignoreEnemiestimescale = ref ignoreEnemiesTimer.Timescale;
            ignoreEnemiestimescale = 1.0f;

            // Never lookat (panic)
            CountdownTimer panicTimer = bot.PanicTimer;

            ref float panicduration = ref panicTimer.Duration;
            panicduration = 0.0f;

            ref float panictimestamp = ref panicTimer.Timestamp;
            panictimestamp = 0.0f;

            ref float panictimescale = ref panicTimer.Timescale;
            panictimescale = 1.0f;
            // Always dodge
            ref bool isEnemySniperVisible = ref bot.IsEnemySniperVisible;
            isEnemySniperVisible = true;

            CountdownTimer sawEnemySniperTimer = bot.SawEnemySniperTimer;

            ref float sawEnemySniperduration = ref sawEnemySniperTimer.Duration;
            sawEnemySniperduration = 600.0f;

            ref float sawEnemySniperTimestamp = ref sawEnemySniperTimer.Timestamp;
            sawEnemySniperTimestamp = now + sawEnemySniperduration;

            ref float sawEnemySniperTimescale = ref sawEnemySniperTimer.Timescale;
            sawEnemySniperTimescale = 1.0f;
            // Teammate Stuck Fix
            ref bool IsWaitingBehindFriend = ref bot.IsWaitingBehindFriend;
            IsWaitingBehindFriend = false;

            CountdownTimer politeTimer = bot.PoliteTimer;

            ref float politeTimerDuration = ref politeTimer.Duration;
            politeTimerDuration = 0.0f;

            ref float politeTimerTimestamp = ref politeTimer.Timestamp;
            politeTimerTimestamp = 0.0f;

            ref float politeTimerTimescale = ref politeTimer.Timescale;
            politeTimerTimescale = 1.0f;

            // Sniper Peek
            bool curIsAttacking = bot.IsAttacking;

            if (curIsAttacking && _hasFiredThisAttack.Remove(idx))
            {
                string? wpn = pawn.WeaponServices?.ActiveWeapon?.Value?.DesignerName;
                if (wpn == "weapon_awp" || wpn == "weapon_ssg08")
                {
                    _lastLateralDir.TryGetValue(idx, out float lastDir);
                    if (lastDir != 0f)
                    {
                        float yawS = pawn.EyeAngles.Y * MathF.PI / 180f;
                        float rx = -MathF.Sin(yawS), ry = MathF.Cos(yawS);
                        float injX = rx * (-lastDir) * 250f;
                        float injY = ry * (-lastDir) * 250f;
                        pawn.AbsVelocity.X += injX;
                        pawn.AbsVelocity.Y += injY;

                        ResetLookAroundForBot(player);
                    }
                }
            }
            // Avoid Confusion
            if (curIsAttacking)
            {
                ref bool eyeAnglesUnderPathFinderControl = ref bot.EyeAnglesUnderPathFinderControl;
                eyeAnglesUnderPathFinderControl = false;

                ref float inhibitLookAroundTimestamp = ref bot.InhibitLookAroundTimestamp;
                inhibitLookAroundTimestamp = 0f;
            }
            //Test Alert! Can cause crash when bot_debug 1 !
            ref bool isAimingAtEnemy = ref bot.IsAimingAtEnemy;
            if (isAimingAtEnemy && !curIsAttacking)
            {
                bot.IsAttacking = true;
            }
            // Cancel Crouch After Attack
            if (_prevIsAttacking.TryGetValue(idx, out bool prevAttack))
            {
                if (prevAttack == true && curIsAttacking == false)
                {
                    ref bool isCrouching = ref bot.IsCrouching;
                    isCrouching = false;
                }
            }
            _prevIsAttacking[idx] = curIsAttacking;

            if (!curIsAttacking)
            {
                _hasFiredThisAttack.Remove(idx);
                float yawL2 = pawn.EyeAngles.Y * MathF.PI / 180f;
                float latX = -MathF.Sin(yawL2), latY = MathF.Cos(yawL2);
                float latSpd = pawn.AbsVelocity.X * latX + pawn.AbsVelocity.Y * latY;
                if (MathF.Abs(latSpd) > 10f)
                {
                    float newDir = latSpd > 0f ? 1f : -1f;
                    float prevDir = _lastLateralDir.GetValueOrDefault(idx);
                    _lastLateralDir[idx] = newDir;
                }
            }

            // Ladder Stuck Issue Fix
            var moveServices = pawn.MovementServices as CCSPlayer_MovementServices;
            var ladderNormal = moveServices?.LadderNormal;

            bool nearLadder = pawn.MoveType == MoveType_t.MOVETYPE_LADDER
                        || (ladderNormal != null
                            && (ladderNormal.X != 0f || ladderNormal.Y != 0f || ladderNormal.Z != 0f));

            if (nearLadder) _ladderExitTime[idx] = Server.CurrentTime;

            bool inLadderCooldown = nearLadder
                || (_ladderExitTime.TryGetValue(idx, out float exitTime)
                    && Server.CurrentTime - exitTime < 5.0f);

            bool inAir = !inLadderCooldown
                    && (pawn.GroundEntity == null || !pawn.GroundEntity.IsValid);

            _prevInAir.TryGetValue(idx, out bool prevInAir);
            // Door Stuck Issue Fix
            if (inDoorCooldown)
            {
                _prevInAir[idx] = inAir;
                continue;
            }
            // Jump Crouch Forward/Backward
            var angles = pawn.EyeAngles;
            float yawDir = angles.Y * MathF.PI / 180f;
            float fwdX = MathF.Cos(yawDir);
            float fwdY = MathF.Sin(yawDir);
            float currentFwd = pawn.AbsVelocity.X * fwdX + pawn.AbsVelocity.Y * fwdY;

            if (currentFwd >= 20f || currentFwd <= -20f)
            {
                _lastForwardDir[idx] = currentFwd > 0f ? 1f : -1f;
            }

            if (inAir)
            {
                if (!pawn.IsDefusing)
                {
                    ref bool isCrouching = ref bot.IsCrouching;
                    isCrouching = true;
                }
                if (!curIsAttacking)// Avoid Jump and Gun
                {
                    float targetSpeed;
                    if (currentFwd <= -20f)
                    {
                        targetSpeed = -215f;
                    }
                    else if (currentFwd >= 20f)
                    {
                        targetSpeed = 215f;
                    }
                    else
                    {
                        float lastDir = _lastForwardDir.TryGetValue(idx, out float dir) ? dir : 1f;
                        targetSpeed = lastDir > 0f ? 215f : -215f;
                    }
                    const float accel = 12f;
                    const float tickInterval = 0.015625f;
                    float delta = targetSpeed - currentFwd;
                    if (targetSpeed > 0)
                    {
                        if (delta > 0)
                        {
                            float addSpeed = delta * accel * tickInterval;

                            pawn.AbsVelocity.X += fwdX * addSpeed;
                            pawn.AbsVelocity.Y += fwdY * addSpeed;
                        }
                    }
                    else
                    {
                        if (delta < 0)
                        {
                            float addSpeed = delta * accel * tickInterval;

                            pawn.AbsVelocity.X += fwdX * addSpeed;
                            pawn.AbsVelocity.Y += fwdY * addSpeed;
                        }
                    }
                }
            }
            // Cancel Crouch
            if (prevInAir && !inAir)
            {
                ref bool isCrouching = ref bot.IsCrouching;
                isCrouching = false;
            }
            _prevInAir[idx] = inAir;
            // cache the parameters for counter-strafe
            _cachedInAir[idx] = inAir;
            _cachedNearLadder[idx] = nearLadder;
            // Normal Un-Stuck Process
            ref bool isStuck = ref bot.IsStuck;
            if (isStuck)
            {
                ref bool isRunning = ref bot.IsRunning;
                isRunning = true;

                ref float jumpTimestamp = ref bot.JumpTimestamp;
                jumpTimestamp = 0.0f;

                CountdownTimer stuckJumpTimer = bot.StuckJumpTimer;

                ref float stuckduration = ref stuckJumpTimer.Duration;
                stuckduration = 0.0f;

                ref float stucktimestamp = ref stuckJumpTimer.Timestamp;
                stucktimestamp = Server.CurrentTime;

                ref float stucktimescale = ref stuckJumpTimer.Timescale;
                stucktimescale = 1.0f;

                // Manual Stuck State
                float speed2D = MathF.Sqrt(
                    pawn.AbsVelocity.X * pawn.AbsVelocity.X +
                    pawn.AbsVelocity.Y * pawn.AbsVelocity.Y);

                var curPos = pawn.AbsOrigin!;

                if (!_stuckStartTime.ContainsKey(idx))
                {
                    _stuckStartTime[idx] = now;
                    _stuckStartPos[idx] = new Vector(curPos.X, curPos.Y, curPos.Z);
                    _stuckJumpDone[idx] = false;
                    _stuckMaxSpeed[idx] = 0f;
                }

                if (speed2D > _stuckMaxSpeed.GetValueOrDefault(idx))
                    _stuckMaxSpeed[idx] = speed2D;

                float elapsed = now - _stuckStartTime.GetValueOrDefault(idx);
                var sp = _stuckStartPos.GetValueOrDefault(idx, new Vector(curPos.X, curPos.Y, curPos.Z));
                float dist2D = MathF.Sqrt(
                    MathF.Pow(curPos.X - sp.X, 2) +
                    MathF.Pow(curPos.Y - sp.Y, 2));
                float maxSpd = _stuckMaxSpeed.GetValueOrDefault(idx);

                bool condA = elapsed >= 1.0f && maxSpd <= 10f;
                bool condB = elapsed >= 3.0f && maxSpd > 10f && dist2D < 75f;

                if ((condA || condB) && !_stuckJumpDone.GetValueOrDefault(idx))
                {
                    ref bool isCrouching = ref bot.IsCrouching;
                    isCrouching = false;

                    _stuckJumpDone[idx] = true;

                    int jumpCount = _stuckJumpCount.GetValueOrDefault(idx);
                    _stuckJumpCount[idx] = jumpCount + 1;

                    float sideSign = (jumpCount % 2 == 0) ? 1f : -1f;
                    float offsetRad = 30f * MathF.PI / 180f * sideSign;
                    float baseYaw = pawn.EyeAngles.Y * MathF.PI / 180f;
                    float backYaw = baseYaw + MathF.PI + offsetRad;

                    pawn.AbsVelocity.X = MathF.Cos(backYaw) * 100f;
                    pawn.AbsVelocity.Y = MathF.Sin(backYaw) * 100f;

                    CountdownTimer repathTimer = bot.RepathTimer;

                    ref float repathduration = ref repathTimer.Duration;
                    repathduration = 0.0f;

                    ref float repathtimestamp = ref repathTimer.Timestamp;
                    repathtimestamp = Server.CurrentTime;

                    ref float repathtimescale = ref repathTimer.Timescale;
                    repathtimescale = 1.0f;

                    // Reset
                    _stuckStartTime[idx] = now;
                    _stuckStartPos[idx] = new Vector(curPos.X, curPos.Y, curPos.Z);
                    _stuckMaxSpeed[idx] = 0f;
                }
            }
            else
            {
                // Clear
                _stuckStartTime.Remove(idx);
                _stuckStartPos.Remove(idx);
                _stuckJumpDone.Remove(idx);
                _stuckMaxSpeed.Remove(idx);

                // Idle repath: if speed < 5 for 5s, force a repath
                float speed2DIdle = MathF.Sqrt(
                    pawn.AbsVelocity.X * pawn.AbsVelocity.X +
                    pawn.AbsVelocity.Y * pawn.AbsVelocity.Y);

                if (speed2DIdle < 5f)
                {
                    if (!_idleStartTime.ContainsKey(idx))
                        _idleStartTime[idx] = now;

                    float idleElapsed = now - _idleStartTime[idx];
                    float lastRepath = _lastRepathTime.GetValueOrDefault(idx, -999f);

                    if (idleElapsed >= 5f && now - lastRepath >= 5f && !curIsAttacking && !pawn.IsDefusing)
                    {
                        ref bool isCrouching = ref bot.IsCrouching;
                        isCrouching = false;

                        _lastRepathTime[idx] = now;

                        CountdownTimer repathTimer = bot.RepathTimer;

                        ref float repathduration = ref repathTimer.Duration;
                        repathduration = 0.0f;

                        ref float repathtimestamp = ref repathTimer.Timestamp;
                        repathtimestamp = Server.CurrentTime;

                        ref float repathtimescale = ref repathTimer.Timescale;
                        repathtimescale = 1.0f;

                        ResetLookAroundForBot(player);
                    }
                }
                else
                {
                    _idleStartTime.Remove(idx);
                }
            }

            //Inferno Sewer Stuck Fix
            if (pawn.AbsOrigin != null)
            {
                Vector pos = pawn.AbsOrigin;
                bool isInferno = string.Equals(Server.MapName, "de_inferno", StringComparison.OrdinalIgnoreCase);
                float dx = pos.X - 285f;
                float dy = pos.Y - 450f;
                float dist = MathF.Sqrt(dx * dx + dy * dy);

                if (isInferno && dist < 50f)
                {
                    CountdownTimer repathTimer = bot.RepathTimer;

                    ref float repathduration = ref repathTimer.Duration;
                    repathduration = 0.0f;

                    ref float repathtimestamp = ref repathTimer.Timestamp;
                    repathtimestamp = Server.CurrentTime;

                    ref float repathtimescale = ref repathTimer.Timescale;
                    repathtimescale = 1.0f;
                }
            }
        }
    }
    //---------------------------------------------------------------------------------------
    private HookResult OnRoundStart(EventRoundStart @event, GameEventInfo info)
    {
        _isFreezeTime = true;
        return HookResult.Continue;
    }

    private HookResult OnDoorOpen(EventDoorOpen @event, GameEventInfo info)
    {
        var player = @event.Userid;
        if (player == null || !player.IsValid || !player.IsBot) return HookResult.Continue;

        int idx = (int)player.Index;
        _doorEventCooldown[idx] = Server.CurrentTime + 1.0f;
        return HookResult.Continue;
    }

    private HookResult OnDoorClose(EventDoorClose @event, GameEventInfo info)
    {
        var player = @event.Userid;
        if (player == null || !player.IsValid || !player.IsBot) return HookResult.Continue;

        int idx = (int)player.Index;
        _doorEventCooldown[idx] = Server.CurrentTime + 1.0f;
        return HookResult.Continue;
    }

    private HookResult OnWeaponFire(EventWeaponFire @event, GameEventInfo info)
    {
        var shooter = @event.Userid;
        if (shooter == null || !shooter.IsValid || !shooter.IsBot) return HookResult.Continue;

        int idx = (int)shooter.Index;
        var pawn = shooter.PlayerPawn?.Value;
        if (pawn == null || !pawn.IsValid) return HookResult.Continue;

        var bot = pawn.Bot;
        if (bot == null) return HookResult.Continue;
        // Sniper Peek
        _hasFiredThisAttack.Add(idx);

        // Counter-strafe on fire
        bool cachedInAir = _cachedInAir.GetValueOrDefault(idx, false);
        bool cachedNearLadder = _cachedNearLadder.GetValueOrDefault(idx, false);
        if (!cachedInAir && !cachedNearLadder)
        {
            string? wpnFire = pawn.WeaponServices?.ActiveWeapon?.Value?.DesignerName;
            if (wpnFire != null)
            {
                float vx = pawn.AbsVelocity.X;
                float vy = pawn.AbsVelocity.Y;
                float speed2D = MathF.Sqrt(vx * vx + vy * vy);

                if (wpnFire is "weapon_glock" or "weapon_hkp2000" or "weapon_p250"
                            or "weapon_fiveseven" or "weapon_cz75a" or "weapon_tec9"
                            or "weapon_mac10" or "weapon_mp9")
                {
                    if (speed2D > 70f)
                    {
                        float scale = 70f / speed2D;
                        pawn.AbsVelocity.X = vx * scale;
                        pawn.AbsVelocity.Y = vy * scale;
                    }
                }
                else if (wpnFire is "weapon_usp_silencer" or "weapon_deagle"
                                or "weapon_ssg08" or "weapon_awp"
                                or "weapon_scar20" or "weapon_g3sg1"
                                or "weapon_galilar" or "weapon_ak47" or "weapon_sg556"
                                or "weapon_famas" or "weapon_m4a1" or "weapon_m4a1_silencer"
                                or "weapon_aug" or "weapon_m249" or "weapon_negev")
                {
                    if (speed2D > 0f)
                    {
                        pawn.AbsVelocity.X = 0f;
                        pawn.AbsVelocity.Y = 0f;
                    }
                }
                // Other weapons: no speed change
            }
        }

        if (pawn.IsDefusing || !bot.IsAttacking) return HookResult.Continue;
        // Random combat crouch
        double crouchChance = 0.0;
        string? wpn = pawn.WeaponServices?.ActiveWeapon?.Value?.DesignerName;
        if (wpn != null)
        {
            if (wpn is "weapon_glock" or "weapon_hkp2000" or "weapon_p250" or "weapon_fiveseven")
                crouchChance = 0.20;

            else if (wpn is "weapon_usp_silencer" or "weapon_deagle")
                crouchChance = 0.30;

            else if (wpn is "weapon_elite" or "weapon_tec9" or "weapon_cz75a" or "weapon_revolver"
                    or "weapon_scar20" or "weapon_g3sg1")
                crouchChance = 0.10;

            else if (wpn is "weapon_mac10" or "weapon_mp9" or "weapon_bizon")
                crouchChance = 0.03;

            else if (wpn is "weapon_mp5sd" or "weapon_ump45" or "weapon_p90"
                    or "weapon_nova" or "weapon_xm1014" or "weapon_sawedoff" or "weapon_mag7"
                    or "weapon_ssg08" or "weapon_awp")
                crouchChance = 0.05;

            else if (wpn is "weapon_galilar" or "weapon_ak47" or "weapon_sg556"
                    or "weapon_famas" or "weapon_m4a1" or "weapon_m4a1_silencer" or "weapon_aug"
                    or "weapon_m249")
                crouchChance = 0.50;

            else if (wpn == "weapon_negev")
                crouchChance = 0.90;
        }

        ref bool isCrouching = ref bot.IsCrouching;
        isCrouching = _random.NextDouble() < crouchChance;

        CountdownTimer sneakTimer = bot.SneakTimer;

        ref float sneakduration = ref sneakTimer.Duration;
        sneakduration = 0.0f;

        ref float sneaktimestamp = ref sneakTimer.Timestamp;
        sneaktimestamp = 0.0f;

        ref float sneaktimescale = ref sneakTimer.Timescale;
        sneaktimescale = 1.0f;

        return HookResult.Continue;
    }

    private HookResult OnBombPlanted(EventBombPlanted @event, GameEventInfo info)
    {
        foreach (var player in Utilities.FindAllEntitiesByDesignerName<CCSPlayerController>("cs_player_controller"))
        {
            if (!player.IsValid || !player.IsBot)
                continue;

            var pawn = player.PlayerPawn.Value;
            if (pawn == null || !pawn.IsValid)
                continue;

            var bot = pawn.Bot;
            if (bot == null)
                continue;

            bool isTakenOver = player.HasBeenControlledByPlayerThisRound;
            if (isTakenOver) continue;

            CountdownTimer hurryTimer = bot.HurryTimer;

            ref float duration = ref hurryTimer.Duration;
            duration = 40.0f;

            ref float timestamp = ref hurryTimer.Timestamp;
            timestamp = Server.CurrentTime + duration;

            ref float timescale = ref hurryTimer.Timescale;
            timescale = 1.0f;

            ref bool isRunning = ref bot.IsRunning;
            isRunning = true;
        }
        return HookResult.Continue;
    }

    private HookResult OnBombBeginDefuse(EventBombBegindefuse @event, GameEventInfo info)
    {
        ResetLookAroundForBot(@event.Userid);
        _isBombBeingDefused = true;
        StartDefuseSmokeCycle();

        var player = @event.Userid;
        if (player == null || !player.IsValid || !player.IsBot) return HookResult.Continue;

        var pawn = player.PlayerPawn?.Value;
        if (pawn == null || !pawn.IsValid) return HookResult.Continue;

        var bot = pawn.Bot;
        if (bot == null) return HookResult.Continue;

        bool isTakenOver = player.HasBeenControlledByPlayerThisRound;
        if (isTakenOver) return HookResult.Continue;

        bool hasLivingEnemies = Utilities
            .FindAllEntitiesByDesignerName<CCSPlayerController>("cs_player_controller")
            .Any(p => p.IsValid && p.PawnIsAlive
                && ((int)p.TeamNum == 2 || (int)p.TeamNum == 3)
                && (int)p.TeamNum != (int)player.TeamNum);
        // Fake Defuse
        if (hasLivingEnemies)
        {
            // If we have a defuser, tend to defuse directly
            var itemSvc = pawn.ItemServices?.Handle != nint.Zero
                ? new CCSPlayer_ItemServices(pawn.ItemServices!.Handle)
                : null;
            bool hasDefuser = itemSvc?.HasDefuser ?? false;
            double fakeChance = hasDefuser ? 0.10 : 0.66;

            if (_random.NextDouble() < fakeChance)
            {
                float yaw = pawn.EyeAngles.Y * MathF.PI / 180f;
                float rx = -MathF.Sin(yaw);
                float ry = MathF.Cos(yaw);
                float side = _random.NextDouble() < 0.5 ? 1f : -1f;

                pawn.AbsVelocity.X += rx * side * 150f;
                pawn.AbsVelocity.Y += ry * side * 150f;
                pawn.AbsVelocity.Z += 255f;

                ResetLookAroundForBot(player);
            }
        }

        return HookResult.Continue;
    }

    private static void ResetLookAroundForBot(CCSPlayerController? player)
    {
        if (player == null || !player.IsValid || !player.IsBot) return;
        var pawn = player.PlayerPawn?.Value;
        if (pawn == null || !pawn.IsValid) return;
        var bot = pawn.Bot;
        if (bot == null) return;

        ref float inhibitLookAroundTimestamp = ref bot.InhibitLookAroundTimestamp;
        inhibitLookAroundTimestamp = 0f;

        ref int checkedHidingSpotCount = ref bot.CheckedHidingSpotCount;
        checkedHidingSpotCount = 0;

        ref float lookAroundStateTimestamp = ref bot.LookAroundStateTimestamp;
        lookAroundStateTimestamp = 0f;
    }
    //---------------------------------------------------------------------------------------
    private static void ApplyBotState(CCSPlayerController player)
    {
        var pawn = player.PlayerPawn.Value;
        if (pawn == null || !pawn.IsValid) return;

        var bot = pawn.Bot;
        if (bot == null) return;

        ref float safeTime = ref bot.SafeTime;
        safeTime = 0f;

        ref bool hasVisitedEnemySpawn = ref bot.HasVisitedEnemySpawn;
        hasVisitedEnemySpawn = true;
    }
    //---------------------------------------------------------------------------------------
    private bool IsReloading(CCSPlayerController player)
    {
        if (player == null || !player.IsValid)
            return false;

        var pawn = player.PlayerPawn?.Value;
        if (pawn == null || !pawn.IsValid)
            return false;

        var activeWeapon = pawn.WeaponServices?.ActiveWeapon?.Value;
        if (activeWeapon == null || !activeWeapon.IsValid)
            return false;

        return Schema.GetRef<bool>(activeWeapon.Handle, "CCSWeaponBase", "m_bInReload");
    }
    //---------------------------------------------------------------------------------------
    // Pre-roll flash avoidance per (bot, flash). On the first tick the bot can both see
    // (FOV + raytrace LOS) the flash projectile, draw against the time-to-detonate tier
    // probability. The result is consumed in OnPlayerBlind.
    private void ProcessFlashbangAvoidance()
    {
        if (_rayTrace == null || _scratchEye == null) return;

        float now = Server.CurrentTime;

        var live = new List<(uint idx, Vector pos, float detonateAt)>();
        foreach (var ent in Utilities.FindAllEntitiesByDesignerName<CBaseEntity>("flashbang_projectile"))
        {
            if (!ent.IsValid) continue;
            var pos = ent.AbsOrigin;
            if (pos == null) continue;

            uint eidx = ent.Index;
            bool isNew = !_flashThrownAt.ContainsKey(eidx);
            if (isNew)
            {
                _flashThrownAt[eidx] = now;
                if (_debugFlash)
                    BroadcastDebug($"[Smarter-Bot/Flash] new flash#{eidx} at ({pos.X:F0},{pos.Y:F0},{pos.Z:F0}) fuse={FlashFuseSeconds:F2}s");
            }
            live.Add((eidx, pos, _flashThrownAt[eidx] + FlashFuseSeconds));
        }

        // Drop tracking for flashes that no longer exist (detonated / round end). Decisions
        // linger for 2 seconds past detonation so OnPlayerBlind can still match them.
        if (_flashThrownAt.Count > live.Count)
        {
            var alive = new HashSet<uint>(live.Select(f => f.idx));
            var stale = _flashThrownAt.Keys.Where(k => !alive.Contains(k)).ToList();
            foreach (var k in stale)
            {
                if (_debugFlash)
                {
                    foreach (var key in _flashDecisions.Keys.Where(p => p.flash == k).ToList())
                    {
                        var d = _flashDecisions[key];
                        BroadcastDebug(
                            $"[Smarter-Bot/Flash] flash#{k} ended; bot#{key.bot} visible {(d.LastSeen - d.FirstSeen) * 1000f:F0}ms");
                    }
                }
                _flashThrownAt.Remove(k);
                foreach (var s in _flashRolledByBot.Values) s.Remove(k);
                _flashRejectLogged.RemoveWhere(p => p.flash == k);
            }
        }

        // Expire stale decisions (2s past their detonation) so we don't leak across rounds.
        if (_flashDecisions.Count > 0)
        {
            var expired = _flashDecisions.Where(kvp => now - kvp.Value.DetonateAt > 2f)
                                          .Select(kvp => kvp.Key)
                                          .ToList();
            foreach (var k in expired) _flashDecisions.Remove(k);
        }

        if (live.Count == 0) return;

        foreach (var bot in Utilities.FindAllEntitiesByDesignerName<CCSPlayerController>("cs_player_controller"))
        {
            if (!bot.IsValid || !bot.IsBot) continue;
            if (bot.HasBeenControlledByPlayerThisRound) continue;

            var pawn = bot.PlayerPawn?.Value;
            if (pawn == null || !pawn.IsValid || pawn.LifeState != (byte)LifeState_t.LIFE_ALIVE) continue;

            int bidx = (int)bot.Index;
            if (!_flashRolledByBot.TryGetValue(bidx, out var rolled))
            {
                rolled = new HashSet<uint>();
                _flashRolledByBot[bidx] = rolled;
            }

            foreach (var (fidx, fpos, detonateAt) in live)
            {
                if (now > detonateAt) continue;

                bool inFov = IsInFov(pawn, fpos, FlashFovHorizDeg, FlashFovVertDeg,
                                     out float dYaw, out float dPit);
                if (!inFov)
                {
                    if (_debugFlash && _flashRejectLogged.Add((bidx, fidx)))
                        BroadcastDebug($"[Smarter-Bot/Flash] bot={bot.PlayerName} flash#{fidx} REJECT-FOV dYaw={dYaw:F1} dPit={dPit:F1}");
                    continue;
                }
                if (!BotCanSee(pawn, fpos))
                {
                    if (_debugFlash && _flashRejectLogged.Add((bidx, fidx)))
                        BroadcastDebug($"[Smarter-Bot/Flash] bot={bot.PlayerName} flash#{fidx} REJECT-LOS dYaw={dYaw:F1} dPit={dPit:F1}");
                    continue;
                }
                _flashRejectLogged.Remove((bidx, fidx));

                var key = (bidx, fidx);

                if (rolled.Contains(fidx))
                {
                    // Already rolled — refresh lastSeen so visible duration reflects full sight window
                    if (_flashDecisions.TryGetValue(key, out var d))
                    {
                        d.LastSeen = now;
                        _flashDecisions[key] = d;
                    }
                    continue;
                }
                rolled.Add(fidx);

                float msLeft = (detonateAt - now) * 1000f;
                double prob = msLeft <= 150f ? 0.05
                            : msLeft <= 250f ? 0.20
                            : msLeft <= 400f ? 0.50
                            : msLeft <= 600f ? 0.90
                            : 0.95;

                bool avoided = _random.NextDouble() <= prob;

                _flashDecisions[key] = new FlashDecision
                {
                    FirstSeen = now,
                    LastSeen = now,
                    DetonateAt = detonateAt,
                    Avoided = avoided,
                };

                if (_debugFlash)
                {
                    BroadcastDebug(
                        $"[Smarter-Bot/Flash] bot={bot.PlayerName} sees flash#{fidx} t-{msLeft:F0}ms prob={prob * 100:F0}% roll={(avoided ? "AVOID" : "flash")}");
                }
            }
        }
    }

    // Decoupled horizontal/vertical FOV check. Source 2 QAngle convention:
    //   EyeAngles.Y = yaw   (0 deg => +X axis, 90 deg => +Y axis)
    //   EyeAngles.X = pitch (positive => looking DOWN; this is the Quake/Source convention)
    // Returns true when target is inside both cones; outDeltaYaw/outDeltaPitch are
    // signed angle deltas (target relative to bot view) for debug logging.
    private static bool IsInFov(CCSPlayerPawn pawn, Vector target,
                                float horizDeg, float vertDeg,
                                out float outDeltaYaw, out float outDeltaPitch)
    {
        outDeltaYaw = 0f;
        outDeltaPitch = 0f;

        var origin = pawn.AbsOrigin;
        if (origin == null) return false;

        float eyeZ = origin.Z + pawn.ViewOffset.Z;

        double dx = target.X - origin.X;
        double dy = target.Y - origin.Y;
        double dz = target.Z - eyeZ;

        double horizDist = Math.Sqrt(dx * dx + dy * dy);
        if (horizDist < 1e-3 && Math.Abs(dz) < 1e-3) return true;

        double yawToTarget = Math.Atan2(dy, dx) * 180.0 / Math.PI;
        double pitchToTarget = -Math.Atan2(dz, horizDist) * 180.0 / Math.PI;

        double yawDelta = NormalizeAngleDeg(yawToTarget - pawn.EyeAngles.Y);
        double pitchDelta = NormalizeAngleDeg(pitchToTarget - pawn.EyeAngles.X);

        outDeltaYaw = (float)yawDelta;
        outDeltaPitch = (float)pitchDelta;

        return Math.Abs(yawDelta) <= horizDeg * 0.5
            && Math.Abs(pitchDelta) <= vertDeg * 0.5;
    }

    private static double NormalizeAngleDeg(double a)
    {
        a %= 360.0;
        if (a > 180.0) a -= 360.0;
        if (a < -180.0) a += 360.0;
        return a;
    }

    private bool BotCanSee(CCSPlayerPawn pawn, Vector target)
    {
        if (_rayTrace == null || _scratchEye == null) return false;

        var origin = pawn.AbsOrigin;
        if (origin == null) return false;

        _scratchEye.X = origin.X;
        _scratchEye.Y = origin.Y;
        _scratchEye.Z = origin.Z + pawn.ViewOffset.Z;

        var opts = new TraceOptions(InteractionLayers.MASK_WORLD_ONLY);
        _rayTrace.TraceEndShape(_scratchEye, target, pawn, opts, out var result);
        return result.Fraction >= 0.999f;
    }
}
//---------------------------------------------------------------------------------------
