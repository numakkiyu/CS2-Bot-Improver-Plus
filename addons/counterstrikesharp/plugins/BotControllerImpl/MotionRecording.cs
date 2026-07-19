// Recording model and JSON load/save

using System.Text.Json;

using BotControllerApi;

namespace BotControllerImpl;

// Recorded motion plus the tickrate it was captured at
public sealed class MotionRecording
{
    public int Tickrate { get; set; } = 64;
    public ReplayTick[] Ticks { get; set; } = Array.Empty<ReplayTick>();
    public SubtickMove[] Subticks { get; set; } = Array.Empty<SubtickMove>();
}

// File + capture-buffer on top of the native calls
public static class MotionStore
{
    // IncludeFields
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
        IncludeFields = true,
    };

    // Save a slot's recorded motion to a JSON file. Returns tick count, or -1
    // if nothing was recorded
    public static int SaveToFile(int slot, string path, int tickrate = 64)
    {
        var (ticks, subs) = BotController.GetRecordedMotion(slot);
        if (ticks.Length == 0) return -1;
        var rec = new MotionRecording
        {
            Tickrate = tickrate,
            Ticks = ticks,
            Subticks = subs,
        };
        File.WriteAllText(path, JsonSerializer.Serialize(rec, JsonOpts));
        return ticks.Length;
    }

    // Load a JSON recording from disk
    public static MotionRecording LoadFromFile(string path)
        => JsonSerializer.Deserialize<MotionRecording>(File.ReadAllText(path), JsonOpts)
           ?? new MotionRecording();
}
