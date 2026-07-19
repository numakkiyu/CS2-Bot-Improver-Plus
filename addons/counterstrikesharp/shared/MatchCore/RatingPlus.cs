namespace MatchCore;

public sealed record RatingPlusWeights(
    string ModelVersion,
    double Kills,
    double Damage,
    double Survival,
    double Kast,
    double MultiKills,
    double RoundSwing,
    double Economy,
    double Intercept)
{
    public static readonly RatingPlusWeights ProxyV1 = new(
        "rating-plus-3.0-proxy-v1", 0.24, 0.20, 0.14, 0.14, 0.12, 0.12, 0.04, 0.0);
}

public static class RatingPlusCalculator
{
    public const int AssistDamageThreshold = 40;
    public static readonly TimeSpan TradeWindow = TimeSpan.FromSeconds(5);

    public static RatingPlusBreakdown Calculate(PlayerMatchStats stats, RatingPlusWeights? weights = null)
    {
        weights ??= RatingPlusWeights.ProxyV1;
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

        return new RatingPlusBreakdown(
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
