using System.Text.Json;
using System.Text.Json.Serialization;

namespace MatchCore;

public static class MatchJson
{
    public const int SchemaVersion = 1;

    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) }
    };
}

public enum MatchSide { Random, Ct, T }
public enum MatchDifficulty { Low, Medium, High }
public enum MatchOpponentKind { FeaturedTeam, Random }
public enum MatchState { Prepared, Launching, Loading, Warmup, Live, Finished, Interrupted }
public enum DemoState { Disabled, Pending, Recording, Validating, Ready, Failed, Interrupted }
public enum PlayerKind { Human, Bot }
public enum TeamSide { Ct, T }
public enum WeaponClass { Awp, TierOneRifle, TierTwoRifle, SmgShotgun, UpgradedPistol, StarterPistol, Other }

public sealed record MapCatalogEntry(
    string Id,
    string DisplayName,
    string WorkshopName,
    string Thumbnail,
    string RequiredVpk);

public sealed record TeamCatalogEntry(
    string Id,
    string Name,
    string Badge,
    int? Ranking,
    IReadOnlyList<string> Players);

public sealed record MatchCatalog(
    int SchemaVersion,
    string CatalogVersion,
    string FreezeDate,
    string Source,
    IReadOnlyList<MapCatalogEntry> Maps,
    IReadOnlyList<TeamCatalogEntry> Teams,
    IReadOnlyList<string> Difficulties);

public sealed record MatchPlayer(
    string Id,
    string Name,
    PlayerKind Kind,
    bool IsLocalPlayer = false);

public sealed record MatchRequest(
    int SchemaVersion,
    string SessionId,
    long CreatedAtUnix,
    string MapId,
    MatchSide PlayerSide,
    MatchDifficulty Difficulty,
    MatchOpponentKind OpponentKind,
    string? OpponentTeamId,
    string OpponentName,
    bool RecordDemo,
    IReadOnlyList<MatchPlayer> PlayerTeam,
    IReadOnlyList<MatchPlayer> OpponentTeam,
    string ResultPath,
    string DemoPath);

public sealed record DemoStatus(
    DemoState State,
    string? Path,
    long SizeBytes,
    string? ErrorCode,
    string? Detail);

public sealed record RatingPlusBreakdown(
    string ModelVersion,
    double Kills,
    double Damage,
    double Survival,
    double Kast,
    double MultiKills,
    double RoundSwing,
    double EconomyAdjustment,
    double RatingPlus);

public sealed class PlayerMatchStats
{
    public required string PlayerId { get; init; }
    public required string Name { get; init; }
    public PlayerKind Kind { get; init; }
    public TeamSide Team { get; init; }
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public int Assists { get; set; }
    public int Headshots { get; set; }
    public int Damage { get; set; }
    public int RoundsPlayed { get; set; }
    public int RoundsSurvived { get; set; }
    public int KastRounds { get; set; }
    public int FirstKills { get; set; }
    public int FirstDeaths { get; set; }
    public int Mvps { get; set; }
    public int Clutches { get; set; }
    public int TradeKills { get; set; }
    public int TradeDenials { get; set; }
    public int FailedTrades { get; set; }
    public int CtKills { get; set; }
    public int TKills { get; set; }
    public double RoundSwing { get; set; }
    public double EconomyAdjustment { get; set; }
    public Dictionary<int, int> MultiKills { get; init; } = [];
    public RatingPlusBreakdown? Rating { get; set; }

    public int Difference => Kills - Deaths;
    public double Adr => RoundsPlayed == 0 ? 0 : Damage / (double)RoundsPlayed;
    public double KastPercent => RoundsPlayed == 0 ? 0 : KastRounds * 100d / RoundsPlayed;
    public double HeadshotPercent => Kills == 0 ? 0 : Headshots * 100d / Kills;
}

public sealed record MatchResult(
    int SchemaVersion,
    string SessionId,
    MatchState State,
    string MapId,
    long StartedAtUnix,
    long FinishedAtUnix,
    int PlayerScore,
    int OpponentScore,
    string OpponentName,
    string RatingModelVersion,
    DemoStatus Demo,
    IReadOnlyList<PlayerMatchStats> Players,
    string? InterruptionReason);

public sealed record MatchSession(
    int SchemaVersion,
    string SessionId,
    MatchState State,
    string MapId,
    string OpponentName,
    long CreatedAtUnix,
    int PlayerScore,
    int OpponentScore,
    DemoStatus Demo,
    string? ResultPath);
