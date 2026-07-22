namespace MatchCore;

public enum RosterAction
{
    None,
    RemovePlayerBot,
    RemoveOpponentBot,
    AddPlayerBot,
    AddOpponentBot
}

public static class RosterReconciler
{
    public static RosterAction Next(
        int actualPlayerBots,
        int actualOpponentBots,
        int targetPlayerBots,
        int targetOpponentBots)
    {
        if (actualPlayerBots < 0 || actualOpponentBots < 0 || targetPlayerBots < 0 || targetOpponentBots < 0)
            throw new ArgumentOutOfRangeException(nameof(actualPlayerBots), "Roster counts cannot be negative");
        if (actualPlayerBots > targetPlayerBots) return RosterAction.RemovePlayerBot;
        if (actualOpponentBots > targetOpponentBots) return RosterAction.RemoveOpponentBot;
        if (actualPlayerBots < targetPlayerBots) return RosterAction.AddPlayerBot;
        if (actualOpponentBots < targetOpponentBots) return RosterAction.AddOpponentBot;
        return RosterAction.None;
    }
}
