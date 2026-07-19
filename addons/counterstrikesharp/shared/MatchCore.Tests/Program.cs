using MatchCore;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

var selected = RosterSelector.SelectUnique(["a", "b", "b", "c", "d", "e", "f"], 5, ["a"], 42);
Check(selected.Count == 5 && selected.Distinct(StringComparer.OrdinalIgnoreCase).Count() == 5, "roster selection must be unique");
Check(!selected.Contains("a", StringComparer.OrdinalIgnoreCase), "excluded player was selected");
Check(RosterSelector.CompleteTeam(["a", "a", "b"], ["a", "b", "c", "d", "e", "f"], seed: 1).Count == 5, "team fill failed");

var regulation = new MatchRules();
for (var i = 0; i < 13; i++) regulation.AddRound(regulation.SideForOriginalCtTeam());
Check(regulation.IsFinished && regulation.CtScore == 13, "MR12 regulation did not finish at 13");

var halftime = new MatchRules();
for (var i = 0; i < 12; i++) halftime.AddRound(halftime.SideForOriginalCtTeam());
Check(halftime.SideForOriginalCtTeam() == TeamSide.T, "original CT team did not swap at halftime");
halftime.AddRound(halftime.SideForOriginalCtTeam());
Check(halftime.IsFinished && halftime.CtScore == 13 && halftime.TScore == 0, "score did not follow the team across halftime");

var overtime = new MatchRules();
for (var i = 0; i < 12; i++) { overtime.AddRound(TeamSide.Ct); overtime.AddRound(TeamSide.T); }
Check(overtime.IsOvertime && !overtime.IsFinished, "12-12 must enter overtime");
for (var i = 0; i < 4; i++) overtime.AddRound(overtime.SideForOriginalCtTeam());
Check(overtime.IsFinished && overtime.CtScore == 16, "MR3 overtime did not finish at four wins");

Check(RatingPlusCalculator.IsTrade(DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch.AddSeconds(5)), "five second trade window must be inclusive");
Check(!RatingPlusCalculator.IsTrade(DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch.AddMilliseconds(5001)), "trade window exceeded five seconds");
var trades = new TradeTracker();
var first = trades.RecordKill("enemy", "teammate", TeamSide.T, TeamSide.Ct, DateTimeOffset.UnixEpoch);
var unrelated = trades.RecordKill("ct-other", "t-other", TeamSide.Ct, TeamSide.T, DateTimeOffset.UnixEpoch.AddSeconds(1));
var traded = trades.RecordKill("ct-trader", "enemy", TeamSide.Ct, TeamSide.T, DateTimeOffset.UnixEpoch.AddSeconds(2));
Check(!first.IsTrade && !unrelated.IsTrade, "unrelated kills must not be marked as trades");
Check(traded is { IsTrade: true, TradedPlayerId: "teammate" }, "trade must mark the original victim for KAST");
Check(RatingPlusCalculator.AssistDamageThreshold == 40, "assist threshold drifted");
Check(RatingPlusCalculator.ClassifyWeapon("weapon_awp") == WeaponClass.Awp, "AWP classification failed");
Check(RatingPlusCalculator.ClassifyWeapon("ak47") == WeaponClass.TierOneRifle, "rifle classification failed");
Check(RatingPlusCalculator.ClassifyWeapon("glock") == WeaponClass.StarterPistol, "starter pistol classification failed");

var before = new RoundSwingContext(0.1, 5, 5, 22000, 22000, false, TeamSide.Ct);
var after = before with { TAlive = 4 };
Check(RoundSwingModel.Delta(before, after) > 0, "CT opening kill should add positive swing");

var stats = new MatchStatistics();
stats.Register(new MatchPlayer("one", "one", PlayerKind.Human), TeamSide.Ct);
stats.Register(new MatchPlayer("two", "two", PlayerKind.Bot), TeamSide.T);
stats.StartRound();
stats.Damage("one", 100);
stats.Kill("one", "two", TeamSide.Ct, true, true, false, 0.2, 0.1);
stats.EndRound(TeamSide.Ct);
var result = stats.FinalizeRatings().Single(player => player.PlayerId == "one");
Check(result.KastRounds == 1 && result.RoundsSurvived == 1, "KAST/survival tracking failed");
Check(result.Rating is { RatingPlus: > 0, ModelVersion: "rating-plus-3.0-proxy-v1" }, "Rating Plus calculation failed");

Console.WriteLine("MatchCore tests passed");
