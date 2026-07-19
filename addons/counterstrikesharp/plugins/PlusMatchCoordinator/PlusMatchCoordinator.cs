using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Utils;
using MatchCore;
using System.Text.Json;

namespace PlusMatchCoordinator;

public sealed class PlusMatchCoordinatorPlugin : BasePlugin
{
    public override string ModuleName => "PLUS Match Coordinator";
    public override string ModuleVersion => "1.4.2.5";
    public override string ModuleAuthor => "CS2BotImproverPlus contributors";
    public override string ModuleDescription => "Offline MR12 match sessions, GOTV demos, and Rating Plus statistics";

    private readonly object _gate = new();
    private readonly TradeTracker _trades = new();
    private readonly Dictionary<int, string> _playerIdsBySlot = new();
    private MatchRequest? _request;
    private MatchStatistics? _statistics;
    private MatchRules? _rules;
    private DateTimeOffset _startedAt;
    private bool _roundHasOpeningKill;
    private bool _finalizing;

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnMapStart>(OnMapStart);
        RegisterListener<Listeners.OnMapEnd>(OnMapEnd);
        RegisterEventHandler<EventRoundStart>(OnRoundStart);
        RegisterEventHandler<EventPlayerHurt>(OnPlayerHurt);
        RegisterEventHandler<EventPlayerDeath>(OnPlayerDeath);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        RegisterEventHandler<EventRoundMvp>(OnRoundMvp);
        RegisterEventHandler<EventPlayerDisconnect>(OnPlayerDisconnect);
    }

    public override void Unload(bool hotReload)
    {
        if (_request != null && !_finalizing) FinalizeMatch(MatchState.Interrupted, "plugin_unloaded");
    }

    private void OnMapStart(string mapName)
    {
        Task.Run(() => LoadActiveRequest(mapName));
    }

    private void LoadActiveRequest(string mapName)
    {
        MatchRequest? request = null;
        try
        {
            var active = Path.Combine(Server.GameDirectory, ".csbip", "match-active.json");
            if (!File.Exists(active)) return;
            request = JsonSerializer.Deserialize<MatchRequest>(File.ReadAllText(active), MatchJson.Options);
            if (request == null || !request.MapId.Equals(mapName, StringComparison.OrdinalIgnoreCase)) return;
            ValidateTeam(request.PlayerTeam);
            ValidateTeam(request.OpponentTeam);
            ValidateRequestPaths(request);
            Server.NextFrame(() => StartSession(request));
        }
        catch (Exception error)
        {
            Console.WriteLine($"[PlusMatchCoordinator] request rejected: {error}");
            if (request != null)
            {
                var demo = new DemoStatus(
                    request.RecordDemo ? DemoState.Interrupted : DemoState.Disabled,
                    request.RecordDemo ? request.DemoPath : null,
                    0,
                    "REQUEST_REJECTED",
                    error.Message);
                WriteResult(request, new MatchResult(
                    MatchJson.SchemaVersion, request.SessionId, MatchState.Interrupted,
                    request.MapId, request.CreatedAtUnix, DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    0, 0, request.OpponentName, RatingPlusWeights.ProxyV1.ModelVersion,
                    demo, [], "request_rejected"));
            }
        }
    }

    private static void ValidateTeam(IEnumerable<MatchPlayer> team)
    {
        RosterSelector.ValidateTeam(team.Select(player => player.Name));
        foreach (var player in team)
        {
            if (player.Name.Length > 64 || player.Name.Any(char.IsControl) || player.Name.Contains('"') || player.Name.Contains(';'))
                throw new InvalidDataException($"Unsafe bot name: {player.Name}");
        }
    }

    private static void ValidateRequestPaths(MatchRequest request)
    {
        if (request.SessionId.Length == 0 || request.SessionId.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('-' or '_')))
            throw new InvalidDataException("Unsafe match session id");
        var gameRoot = Path.GetFullPath(Server.GameDirectory).TrimEnd(Path.DirectorySeparatorChar);
        var expectedResult = Path.Combine(gameRoot, ".csbip", "matches", request.SessionId, "result.json");
        var expectedDemo = Path.Combine(gameRoot, "demos", "csbip", request.SessionId + ".dem");
        if (!Path.GetFullPath(request.ResultPath).Equals(expectedResult, StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFullPath(request.DemoPath).Equals(expectedDemo, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Match request paths are outside the managed session roots");
    }

    private void StartSession(MatchRequest request)
    {
        lock (_gate)
        {
            _request = request;
            _statistics = new MatchStatistics();
            _rules = new MatchRules();
            _playerIdsBySlot.Clear();
            _startedAt = DateTimeOffset.UtcNow;
            _finalizing = false;
        }

        Server.ExecuteCommand("mp_autoteambalance 0");
        Server.ExecuteCommand("mp_limitteams 0");
        Server.ExecuteCommand("mp_maxrounds 24");
        Server.ExecuteCommand("mp_halftime 1");
        Server.ExecuteCommand("mp_overtime_enable 1");
        Server.ExecuteCommand("mp_overtime_maxrounds 6");
        Server.ExecuteCommand("bot_quota_mode normal");
        Server.ExecuteCommand("bot_kick");

        var playerSide = request.PlayerSide == MatchSide.T ? TeamSide.T : TeamSide.Ct;
        var opponentSide = playerSide == TeamSide.Ct ? TeamSide.T : TeamSide.Ct;
        foreach (var player in request.PlayerTeam.Where(player => player.Kind == PlayerKind.Bot)) AddBot(player.Name, playerSide);
        foreach (var player in request.OpponentTeam) AddBot(player.Name, opponentSide);
        Server.ExecuteCommand("bot_quota 9");

        if (request.RecordDemo)
        {
            var demoName = request.SessionId.Replace("\"", string.Empty, StringComparison.Ordinal);
            Server.ExecuteCommand($"tv_enable 1; tv_record \"demos/csbip/{demoName}\"");
        }
        AddTimer(1.0f, RegisterPlayers);
    }

    private static void AddBot(string name, TeamSide side)
    {
        var safeName = name.Replace("\"", string.Empty, StringComparison.Ordinal);
        Server.ExecuteCommand($"bot_add_{(side == TeamSide.Ct ? "ct" : "t")} \"{safeName}\"");
    }

    private void RegisterPlayers()
    {
        var request = _request;
        var statistics = _statistics;
        if (request == null || statistics == null) return;
        var playerSide = request.PlayerSide == MatchSide.T ? TeamSide.T : TeamSide.Ct;
        var opponentSide = playerSide == TeamSide.Ct ? TeamSide.T : TeamSide.Ct;
        foreach (var human in Utilities.GetPlayers().Where(player => player is { IsValid: true, IsBot: false }))
            human.SwitchTeam(playerSide == TeamSide.Ct ? CsTeam.CounterTerrorist : CsTeam.Terrorist);
        foreach (var player in Utilities.GetPlayers().Where(player => player is { IsValid: true }))
            _playerIdsBySlot[player.Slot] = player.IsBot ? $"bot-{player.PlayerName}" : "player-local";
        foreach (var player in request.PlayerTeam) statistics.Register(player, playerSide);
        foreach (var player in request.OpponentTeam) statistics.Register(player, opponentSide);
    }

    private HookResult OnRoundStart(EventRoundStart @event, GameEventInfo info)
    {
        _roundHasOpeningKill = false;
        _trades.Clear();
        _statistics?.StartRound();
        return HookResult.Continue;
    }

    private HookResult OnPlayerHurt(EventPlayerHurt @event, GameEventInfo info)
    {
        var attacker = IdFor(@event.Attacker);
        if (attacker != null) _statistics?.Damage(attacker, @event.DmgHealth);
        return HookResult.Continue;
    }

    private HookResult OnPlayerDeath(EventPlayerDeath @event, GameEventInfo info)
    {
        var attackerId = IdFor(@event.Attacker);
        var victimId = IdFor(@event.Userid);
        if (attackerId == null || victimId == null || attackerId == victimId) return HookResult.Continue;

        var now = DateTimeOffset.UtcNow;
        var attackerSide = SideFor(@event.Attacker);
        var victimSide = SideFor(@event.Userid);
        var trade = _trades.RecordKill(attackerId, victimId, attackerSide, victimSide, now);
        var opening = !_roundHasOpeningKill;
        _roundHasOpeningKill = true;
        var before = SwingContext(attackerSide, false);
        var after = before with
        {
            CtAlive = before.CtAlive - (victimSide == TeamSide.Ct ? 1 : 0),
            TAlive = before.TAlive - (victimSide == TeamSide.T ? 1 : 0)
        };
        var economy = RatingPlusCalculator.EconomyKillAdjustment(100, RatingPlusCalculator.ClassifyWeapon(@event.Weapon));
        _statistics?.Kill(attackerId, victimId, attackerSide, @event.Headshot, opening, trade.IsTrade, RoundSwingModel.Delta(before, after), economy);
        if (trade.TradedPlayerId != null) _statistics?.MarkTraded(trade.TradedPlayerId);

        var assister = IdFor(@event.Assister);
        if (assister != null) _statistics?.Assist(assister);
        return HookResult.Continue;
    }

    private HookResult OnRoundEnd(EventRoundEnd @event, GameEventInfo info)
    {
        var winner = @event.Winner == (byte)CsTeam.Terrorist ? TeamSide.T : TeamSide.Ct;
        _statistics?.EndRound(winner);
        if (_rules?.AddRound(winner) == true) FinalizeMatch(MatchState.Finished, null);
        return HookResult.Continue;
    }

    private HookResult OnRoundMvp(EventRoundMvp @event, GameEventInfo info)
    {
        var id = IdFor(@event.Userid);
        var player = _statistics?.Players.FirstOrDefault(value => value.PlayerId == id);
        if (player != null) player.Mvps++;
        return HookResult.Continue;
    }

    private HookResult OnPlayerDisconnect(EventPlayerDisconnect @event, GameEventInfo info)
    {
        if (@event.Userid is { IsValid: true } player) _playerIdsBySlot.Remove(player.Slot);
        if (_request != null && @event.Userid is { IsBot: false }) FinalizeMatch(MatchState.Interrupted, "local_player_disconnected");
        return HookResult.Continue;
    }

    private void OnMapEnd()
    {
        if (_request != null && !_finalizing) FinalizeMatch(MatchState.Interrupted, "map_changed");
    }

    private void FinalizeMatch(MatchState state, string? reason)
    {
        MatchRequest? request;
        MatchStatistics? statistics;
        MatchRules? rules;
        lock (_gate)
        {
            if (_request == null || _finalizing) return;
            _finalizing = true;
            request = _request;
            statistics = _statistics;
            rules = _rules;
        }

        if (request.RecordDemo) Server.ExecuteCommand("tv_stoprecord");
        var players = statistics?.FinalizeRatings() ?? [];
        var playerSide = request.PlayerSide == MatchSide.T ? TeamSide.T : TeamSide.Ct;
        var playerScore = playerSide == TeamSide.Ct ? rules?.CtScore ?? 0 : rules?.TScore ?? 0;
        var opponentScore = playerSide == TeamSide.Ct ? rules?.TScore ?? 0 : rules?.CtScore ?? 0;
        var opponentName = request.OpponentName;
        var result = new MatchResult(
            MatchJson.SchemaVersion, request.SessionId, state, request.MapId,
            _startedAt.ToUnixTimeSeconds(), DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            playerScore, opponentScore, opponentName, RatingPlusWeights.ProxyV1.ModelVersion,
            new DemoStatus(request.RecordDemo ? DemoState.Validating : DemoState.Disabled, request.RecordDemo ? request.DemoPath : null, 0, null, null),
            players, reason);

        Task.Run(() => WriteResult(request, result));
    }

    private void WriteResult(MatchRequest request, MatchResult result)
    {
        try
        {
            var path = Path.GetFullPath(request.ResultPath);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + $".tmp-{Environment.ProcessId}-{Guid.NewGuid():N}";
            File.WriteAllText(temporary, JsonSerializer.Serialize(result, MatchJson.Options));
            File.Move(temporary, path, true);
        }
        catch (Exception error)
        {
            Console.WriteLine($"[PlusMatchCoordinator] result write failed: {error}");
        }
        finally
        {
            lock (_gate) { _request = null; _statistics = null; _rules = null; _playerIdsBySlot.Clear(); }
        }
    }

    private string? IdFor(CCSPlayerController? player)
    {
        if (player is not { IsValid: true }) return null;
        if (_playerIdsBySlot.TryGetValue(player.Slot, out var id)) return id;
        id = player.IsBot ? $"bot-{player.PlayerName}" : "player-local";
        _playerIdsBySlot[player.Slot] = id;
        return id;
    }

    private static TeamSide SideFor(CCSPlayerController? player) =>
        player?.Team == CsTeam.Terrorist ? TeamSide.T : TeamSide.Ct;

    private static RoundSwingContext SwingContext(TeamSide eventTeam, bool bombPlanted)
    {
        var players = Utilities.GetPlayers().Where(player => player is { IsValid: true, PawnIsAlive: true }).ToArray();
        return new RoundSwingContext(0, players.Count(player => player.Team == CsTeam.CounterTerrorist),
            players.Count(player => player.Team == CsTeam.Terrorist), 20000, 20000, bombPlanted, eventTeam);
    }
}
