namespace MatchCore;

public sealed class MatchRules
{
    public const int RegulationRoundsPerHalf = 12;
    public const int RegulationWinScore = 13;
    public const int OvertimeRoundsPerHalf = 3;

    // Scores belong to the teams that started on CT and T, not to the current
    // sides. This keeps one scoreboard across regulation and overtime swaps.
    public int CtScore { get; private set; }
    public int TScore { get; private set; }
    public int RoundsPlayed => CtScore + TScore;
    public bool IsOvertime => RoundsPlayed >= 24;
    public bool IsFinished { get; private set; }
    public TeamSide? Winner { get; private set; }

    public bool AddRound(TeamSide winner)
    {
        if (IsFinished) throw new InvalidOperationException("The match has already finished");
        if (winner == SideForOriginalCtTeam()) CtScore++; else TScore++;
        Evaluate();
        return IsFinished;
    }

    public TeamSide SideForOriginalCtTeam()
    {
        if (!IsOvertime) return RoundsPlayed < RegulationRoundsPerHalf ? TeamSide.Ct : TeamSide.T;
        var overtimeRound = RoundsPlayed - 24;
        return (overtimeRound / OvertimeRoundsPerHalf) % 2 == 0 ? TeamSide.Ct : TeamSide.T;
    }

    private void Evaluate()
    {
        if (RoundsPlayed < 24)
        {
            if (CtScore >= RegulationWinScore || TScore >= RegulationWinScore) FinishLeader();
            return;
        }

        var completedOvertimeBlocks = (RoundsPlayed - 24) / 6;
        var blockBase = 12 + completedOvertimeBlocks * 3;
        if (CtScore >= blockBase + 4 || TScore >= blockBase + 4)
        {
            FinishLeader();
            return;
        }

        if ((RoundsPlayed - 24) % 6 == 0 && CtScore != TScore) FinishLeader();
    }

    private void FinishLeader()
    {
        IsFinished = true;
        Winner = CtScore > TScore ? TeamSide.Ct : TeamSide.T;
    }
}
