namespace MatchCore;

public sealed class MatchStatistics
{
    private readonly Dictionary<string, PlayerMatchStats> _players = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, RoundFlags> _round = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyCollection<PlayerMatchStats> Players => _players.Values;

    public void Register(MatchPlayer player, TeamSide team)
    {
        _players.TryAdd(player.Id, new PlayerMatchStats
        {
            PlayerId = player.Id,
            Name = player.Name,
            Kind = player.Kind,
            Team = team
        });
    }

    public void StartRound()
    {
        _round.Clear();
        foreach (var id in _players.Keys) _round[id] = new RoundFlags();
    }

    public void Damage(string attackerId, int damage)
    {
        if (_players.TryGetValue(attackerId, out var attacker)) attacker.Damage += Math.Max(0, damage);
    }

    public void Kill(string attackerId, string victimId, TeamSide attackerSide, bool headshot, bool openingKill, bool tradeKill, double swing, double economy)
    {
        if (_players.TryGetValue(attackerId, out var attacker))
        {
            attacker.Kills++;
            if (headshot) attacker.Headshots++;
            if (openingKill) attacker.FirstKills++;
            if (tradeKill) attacker.TradeKills++;
            if (attackerSide == TeamSide.Ct) attacker.CtKills++; else attacker.TKills++;
            attacker.RoundSwing += swing;
            attacker.EconomyAdjustment += economy;
            if (_round.TryGetValue(attackerId, out var flags)) { flags.Kills++; flags.Contributed = true; }
        }
        if (_players.TryGetValue(victimId, out var victim))
        {
            victim.Deaths++;
            if (openingKill) victim.FirstDeaths++;
            if (_round.TryGetValue(victimId, out var flags)) flags.Survived = false;
        }
    }

    public void Assist(string playerId)
    {
        if (_players.TryGetValue(playerId, out var player)) player.Assists++;
        if (_round.TryGetValue(playerId, out var flags)) flags.Contributed = true;
    }

    public void MarkTraded(string victimId)
    {
        if (_round.TryGetValue(victimId, out var flags)) flags.Traded = true;
    }

    public void EndRound(TeamSide _winner)
    {
        foreach (var (id, player) in _players)
        {
            var flags = _round.TryGetValue(id, out var value) ? value : new RoundFlags();
            player.RoundsPlayed++;
            if (flags.Survived) player.RoundsSurvived++;
            if (flags.Survived || flags.Contributed || flags.Traded) player.KastRounds++;
            if (flags.Kills >= 2) player.MultiKills[flags.Kills] = player.MultiKills.GetValueOrDefault(flags.Kills) + 1;
        }
    }

    public IReadOnlyList<PlayerMatchStats> FinalizeRatings(OpenRatingWeights? weights = null)
    {
        foreach (var player in _players.Values) player.Rating = OpenRatingCalculator.Calculate(player, weights);
        return _players.Values.OrderByDescending(player => player.Rating?.OpenRating ?? 0).ToArray();
    }

    private sealed class RoundFlags
    {
        public bool Survived { get; set; } = true;
        public bool Contributed { get; set; }
        public bool Traded { get; set; }
        public int Kills { get; set; }
    }
}
