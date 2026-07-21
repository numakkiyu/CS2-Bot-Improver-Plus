namespace MatchCore;

public sealed record TradeResult(bool IsTrade, string? TradedPlayerId);

public sealed class TradeTracker
{
    private readonly List<KillTrace> _kills = [];

    public void Clear() => _kills.Clear();

    public TradeResult RecordKill(
        string killerId,
        string victimId,
        TeamSide killerSide,
        TeamSide victimSide,
        DateTimeOffset occurredAt)
    {
        _kills.RemoveAll(kill => !OpenRatingCalculator.IsTrade(kill.OccurredAt, occurredAt));
        var traded = _kills.LastOrDefault(kill =>
            kill.KillerId.Equals(victimId, StringComparison.OrdinalIgnoreCase) &&
            kill.KillerSide == victimSide &&
            kill.VictimSide == killerSide);

        _kills.Add(new KillTrace(killerId, victimId, killerSide, victimSide, occurredAt));
        return new TradeResult(traded != null, traded?.VictimId);
    }

    private sealed record KillTrace(
        string KillerId,
        string VictimId,
        TeamSide KillerSide,
        TeamSide VictimSide,
        DateTimeOffset OccurredAt);
}
