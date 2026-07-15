using PlayerKnifeCustomizer;

static KnifePreset Preset(int paint, int count = 0) => new()
{
    Paint = paint,
    Seed = 0,
    Wear = 0.01f,
    StatTrakEnabled = true,
    StatTrakCount = count,
};

static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
// Test the weapon preset resolver
var config = new KnifeConfig();
config.Loadouts.Ct.GunPresets[16] = Preset(309);
config.Loadouts.T.GunPresets[7] = Preset(661);
config.Loadouts.Ct.GunPresets[9] = Preset(344, 10);
config.Loadouts.T.GunPresets[9] = Preset(279, 20);
config.SharedWeaponLinks[9] = false;

Require(WeaponPresetResolver.TryResolveGunPreset(config, 16, CosmeticTeam.T, out var m4) && m4.Paint == 309,
    "A CT-exclusive weapon must resolve the CT preset after a T pickup.");
Require(WeaponPresetResolver.TryResolveGunPreset(config, 7, CosmeticTeam.Ct, out var ak) && ak.Paint == 661,
    "A T-exclusive weapon must resolve the T preset after a CT pickup.");
Require(WeaponPresetResolver.TryResolveGunPreset(config, 9, CosmeticTeam.Ct, out var ctAwp) && ctAwp.Paint == 344,
    "An unlinked shared weapon must resolve the current CT preset.");
Require(WeaponPresetResolver.TryResolveGunPreset(config, 9, CosmeticTeam.T, out var tAwp) && tAwp.Paint == 279,
    "An unlinked shared weapon must resolve the current T preset.");
Require(!WeaponPresetResolver.TryResolveGunPreset(config, 9, null, out _),
    "A spectator or unknown team must not receive a cosmetic preset.");

tAwp.StatTrakCount++;
Require(config.Loadouts.T.GunPresets[9].StatTrakCount == 21 && config.Loadouts.Ct.GunPresets[9].StatTrakCount == 10,
    "StatTrak must update only the resolved team preset.");

config.Loadouts.T.GunPresets.Remove(9);
config.SharedWeaponLinks[9] = true;
Require(WeaponPresetResolver.TryResolveGunPreset(config, 9, CosmeticTeam.T, out var linkedAwp) && linkedAwp.Paint == 344,
    "A linked shared weapon must fall back to the configured side.");

var tracker = new ApplyGenerationTracker();
nint playerHandle = (nint)0x1000;

long initialSpawn = tracker.Begin(playerHandle, CosmeticApplyPhase.All);
long firstGive = tracker.Begin(playerHandle, CosmeticApplyPhase.Guns);
Require(!tracker.IsCurrent(playerHandle, initialSpawn),
    "A GiveNamedItem event must invalidate callbacks from the previous generation.");
Require(tracker.IsPending(playerHandle, firstGive, CosmeticApplyPhase.Knife) &&
        tracker.IsPending(playerHandle, firstGive, CosmeticApplyPhase.Gloves) &&
        tracker.IsPending(playerHandle, firstGive, CosmeticApplyPhase.Guns) &&
        tracker.IsPending(playerHandle, firstGive, CosmeticApplyPhase.Music),
    "A GiveNamedItem event must carry every unfinished spawn phase into the new generation.");

Require(tracker.Complete(playerHandle, firstGive, CosmeticApplyPhase.Music),
    "The current generation must complete a phase before a pickup storm.");
long pickupStorm = firstGive;
for (int i = 0; i < 100; i++)
    pickupStorm = tracker.Begin(playerHandle, CosmeticApplyPhase.Guns);
Require(!tracker.IsPending(playerHandle, pickupStorm, CosmeticApplyPhase.Music),
    "A completed phase must not be reintroduced by later gun-only events.");
Require(tracker.IsPending(playerHandle, pickupStorm, CosmeticApplyPhase.Knife) &&
        tracker.IsPending(playerHandle, pickupStorm, CosmeticApplyPhase.Gloves) &&
        tracker.IsPending(playerHandle, pickupStorm, CosmeticApplyPhase.Guns),
    "A GiveNamedItem storm must preserve unfinished knife, glove, and gun phases.");
Require(tracker.MarkRetryExhausted(playerHandle, pickupStorm),
    "The final bounded attempt must record unfinished phases once.");
Require(!tracker.MarkRetryExhausted(playerHandle, pickupStorm) && tracker.RetryExhaustions == 1,
    "Repeated final callbacks must not duplicate retry exhaustion diagnostics.");
long retryAfterEvent = tracker.Begin(playerHandle, CosmeticApplyPhase.Guns);
Require(tracker.MarkRetryExhausted(playerHandle, retryAfterEvent) && tracker.RetryExhaustions == 2,
    "A later gameplay event must create a fresh bounded retry window.");

tracker.CancelAll();
for (int i = 0; i < 1000; i++)
{
    nint firstPawn = (nint)(0x2000 + i * 2);
    nint replacementPawn = firstPawn + 1;

    long spawn = tracker.Begin(playerHandle, CosmeticApplyPhase.All);
    Require(tracker.TryBindContext(playerHandle, spawn, firstPawn, (int)CosmeticTeam.Ct),
        "The current spawn generation must bind its initial pawn and team.");
    Require(tracker.Complete(playerHandle, spawn, CosmeticApplyPhase.Knife),
        "The first knife write must complete the knife phase.");
    Require(!tracker.IsPending(playerHandle, spawn, CosmeticApplyPhase.Knife),
        "A completed phase must not be written again by a later retry.");

    long teamChange = tracker.Begin(playerHandle, CosmeticApplyPhase.All);
    Require(!tracker.IsCurrent(playerHandle, spawn),
        "A team change must invalidate every callback from the old spawn generation.");
    Require(!tracker.Complete(playerHandle, spawn, CosmeticApplyPhase.Gloves),
        "A stale callback must not complete or write any phase.");
    Require(tracker.TryBindContext(playerHandle, teamChange, replacementPawn, (int)CosmeticTeam.T),
        "The replacement generation must bind the replacement pawn and team.");
    Require(!tracker.TryBindContext(playerHandle, teamChange, firstPawn, (int)CosmeticTeam.T),
        "A pawn replacement inside one generation must cancel that generation.");
    Require(!tracker.IsCurrent(playerHandle, teamChange),
        "A generation with a changed pawn must remain cancelled.");

    long pickup = tracker.Begin(playerHandle, CosmeticApplyPhase.Guns);
    Require(tracker.TryBindContext(playerHandle, pickup, replacementPawn, (int)CosmeticTeam.T),
        "A pickup generation must bind the current pawn.");
    Require(tracker.Complete(playerHandle, pickup, CosmeticApplyPhase.Guns),
        "A pickup generation must complete its single gun phase.");
    Require(!tracker.HasPending(playerHandle, pickup),
        "A completed pickup generation must not schedule repeated native writes.");
}

tracker.CancelAll();
Require(!tracker.IsCurrent(playerHandle, 3000), "Map or round cleanup must cancel all generations.");
Require(tracker.ActiveCount == 0 && tracker.ContextInvalidations == 1000,
    "Lifecycle diagnostics must count invalidated Pawn contexts without retaining generations.");

var throttle = new ApplyErrorThrottle(TimeSpan.FromSeconds(30));
var now = DateTimeOffset.UtcNow;
Require(throttle.Check("gun", now).ShouldLog, "The first native write error must be logged.");
Require(!throttle.Check("gun", now.AddSeconds(1)).ShouldLog,
    "Repeated errors inside the throttle window must be suppressed.");
var resumed = throttle.Check("gun", now.AddSeconds(31));
Require(resumed.ShouldLog && resumed.Suppressed == 1,
    "The next error record must report how many duplicate errors were suppressed.");

Console.WriteLine("PlayerKnifeCustomizer resolver, lifecycle, and log-throttle tests passed.");
