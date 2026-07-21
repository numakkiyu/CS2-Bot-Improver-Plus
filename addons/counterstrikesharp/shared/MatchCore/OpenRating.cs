using System.Text.Json;
using System.Text.Json.Serialization;

namespace MatchCore;

public sealed record OpenRatingWeights(
    string ModelVersion,
    double Kills,
    double Damage,
    double Survival,
    double Kast,
    double MultiKills,
    double RoundSwing,
    double Economy,
    double Intercept,
    IReadOnlyDictionary<string, double> MapSidePriors)
{
    public static readonly OpenRatingWeights ProxyV1 = new(
        "open-rating-3.0-proxy-v1",
        0.3347209816908208,
        0.47510339992828865,
        0.3785772969943543,
        0.2239626370653013,
        0.136410832801464,
        0.3956972806498023,
        0.14666847859595622,
        -0.7309958084287365,
        new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase));

    public double MapSidePrior(string mapId) => MapSidePriors.GetValueOrDefault(mapId, 0);

    public static OpenRatingWeights Load(string path)
    {
        var document = JsonSerializer.Deserialize<OpenRatingModelDocument>(File.ReadAllText(path))
            ?? throw new InvalidDataException("OpenRating model is empty");
        if (document.SchemaVersion != 1 || string.IsNullOrWhiteSpace(document.ModelVersion))
            throw new InvalidDataException("Unsupported OpenRating model schema");
        var values = new[]
        {
            document.Weights.Kills, document.Weights.Damage, document.Weights.Survival,
            document.Weights.Kast, document.Weights.MultiKills, document.Weights.RoundSwing,
            document.Weights.Economy, document.Weights.Intercept
        };
        if (values.Any(value => !double.IsFinite(value)) || values.Take(7).Any(value => value < 0))
            throw new InvalidDataException("OpenRating weights must be finite and non-negative");
        if (document.MapSidePriors.Any(entry => !double.IsFinite(entry.Value) || Math.Abs(entry.Value) > 2))
            throw new InvalidDataException("OpenRating map side priors are invalid");
        return new OpenRatingWeights(
            document.ModelVersion,
            document.Weights.Kills,
            document.Weights.Damage,
            document.Weights.Survival,
            document.Weights.Kast,
            document.Weights.MultiKills,
            document.Weights.RoundSwing,
            document.Weights.Economy,
            document.Weights.Intercept,
            new Dictionary<string, double>(document.MapSidePriors, StringComparer.OrdinalIgnoreCase));
    }
}

internal sealed class OpenRatingModelDocument
{
    [JsonPropertyName("schema_version")] public int SchemaVersion { get; init; }
    [JsonPropertyName("model_version")] public string ModelVersion { get; init; } = "";
    [JsonPropertyName("weights")] public OpenRatingWeightDocument Weights { get; init; } = new();
    [JsonPropertyName("map_side_priors")] public Dictionary<string, double> MapSidePriors { get; init; } = [];
}

internal sealed class OpenRatingWeightDocument
{
    [JsonPropertyName("kills")] public double Kills { get; init; }
    [JsonPropertyName("damage")] public double Damage { get; init; }
    [JsonPropertyName("survival")] public double Survival { get; init; }
    [JsonPropertyName("kast")] public double Kast { get; init; }
    [JsonPropertyName("multi_kills")] public double MultiKills { get; init; }
    [JsonPropertyName("round_swing")] public double RoundSwing { get; init; }
    [JsonPropertyName("economy")] public double Economy { get; init; }
    [JsonPropertyName("intercept")] public double Intercept { get; init; }
}

public static class OpenRatingCalculator
{
    public const int AssistDamageThreshold = 40;
    public static readonly TimeSpan TradeWindow = TimeSpan.FromSeconds(5);

    public static OpenRatingBreakdown Calculate(PlayerMatchStats stats, OpenRatingWeights? weights = null)
    {
        weights ??= OpenRatingWeights.ProxyV1;
        var rounds = Math.Max(1, stats.RoundsPlayed);
        var killRate = stats.Kills / (double)rounds;
        var damageRate = stats.Damage / (double)rounds;
        var survivalRate = stats.RoundsSurvived / (double)rounds;
        var kastRate = stats.KastRounds / (double)rounds;
        var multiValue = stats.MultiKills.Sum(entry => Math.Max(0, entry.Key - 1) * entry.Value) / (double)rounds;

        var kills = Clamp(killRate / 0.70);
        var damage = Clamp(damageRate / 82.0);
        var survival = Clamp(survivalRate / 0.68);
        var kast = Clamp(kastRate / 0.72);
        var multis = Clamp(multiValue / 0.32);
        var swing = Clamp(1.0 + stats.RoundSwing / rounds);
        var economy = Math.Clamp(stats.EconomyAdjustment / rounds, -0.20, 0.20);
        var rating = weights.Intercept
            + weights.Kills * kills
            + weights.Damage * damage
            + weights.Survival * survival
            + weights.Kast * kast
            + weights.MultiKills * multis
            + weights.RoundSwing * swing
            + weights.Economy * (1.0 + economy);

        return new OpenRatingBreakdown(
            weights.ModelVersion,
            Round(kills), Round(damage), Round(survival), Round(kast), Round(multis), Round(swing),
            Round(economy), Round(Math.Clamp(rating, 0, 3)));
    }

    public static WeaponClass ClassifyWeapon(string weapon)
    {
        var id = weapon.Trim().ToLowerInvariant().Replace("weapon_", string.Empty);
        if (id == "awp") return WeaponClass.Awp;
        if (id is "ak47" or "m4a1" or "m4a1_silencer" or "aug" or "sg556") return WeaponClass.TierOneRifle;
        if (id is "famas" or "galilar" or "ssg08") return WeaponClass.TierTwoRifle;
        if (id is "glock" or "hkp2000" or "usp_silencer") return WeaponClass.StarterPistol;
        if (id is "deagle" or "revolver" or "elite" or "fiveseven" or "tec9" or "cz75a" or "p250") return WeaponClass.UpgradedPistol;
        if (id is "mac10" or "mp9" or "mp7" or "mp5sd" or "ump45" or "p90" or "bizon" or "nova" or "xm1014" or "mag7" or "sawedoff") return WeaponClass.SmgShotgun;
        return WeaponClass.Other;
    }

    public static double EconomyKillAdjustment(int victimArmor, WeaponClass victimWeapon)
    {
        var armorFactor = Math.Clamp(victimArmor, 0, 100) / 100d;
        var weaponFactor = victimWeapon switch
        {
            WeaponClass.Awp => 1.0,
            WeaponClass.TierOneRifle => 0.86,
            WeaponClass.TierTwoRifle => 0.68,
            WeaponClass.SmgShotgun => 0.48,
            WeaponClass.UpgradedPistol => 0.32,
            WeaponClass.StarterPistol => 0.12,
            _ => 0.25
        };
        return Round((armorFactor * 0.35 + weaponFactor * 0.65) - 0.5);
    }

    public static int EquipmentValue(WeaponClass weapon) => weapon switch
    {
        WeaponClass.Awp => 4750,
        WeaponClass.TierOneRifle => 3000,
        WeaponClass.TierTwoRifle => 1900,
        WeaponClass.SmgShotgun => 1250,
        WeaponClass.UpgradedPistol => 500,
        WeaponClass.StarterPistol => 200,
        _ => 0
    };

    public static bool IsTrade(DateTimeOffset death, DateTimeOffset response) =>
        response >= death && response - death <= TradeWindow;

    private static double Clamp(double value) => Math.Clamp(value, 0, 2.5);
    private static double Round(double value) => Math.Round(value, 4, MidpointRounding.AwayFromZero);
}

public sealed record RoundSwingContext(
    double MapSidePrior,
    int CtAlive,
    int TAlive,
    int CtEquipmentValue,
    int TEquipmentValue,
    bool BombPlanted,
    TeamSide EventTeam);

public static class RoundSwingModel
{
    public static double WinProbability(RoundSwingContext context)
    {
        var alive = (context.CtAlive - context.TAlive) * 0.72;
        var economy = Math.Clamp((context.CtEquipmentValue - context.TEquipmentValue) / 20000d, -1.5, 1.5);
        var bomb = context.BombPlanted ? -0.9 : 0;
        var logit = context.MapSidePrior + alive + economy + bomb;
        return 1d / (1d + Math.Exp(-logit));
    }

    public static double Delta(RoundSwingContext before, RoundSwingContext after)
    {
        var ctDelta = WinProbability(after) - WinProbability(before);
        return after.EventTeam == TeamSide.Ct ? ctDelta : -ctDelta;
    }
}
