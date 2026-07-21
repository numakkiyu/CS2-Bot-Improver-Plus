using System.Text.Json;
using System.Text.Json.Serialization;

namespace MatchCore;

public sealed record BotIdentity(
    [property: JsonPropertyName("steamid")] uint SteamAccountId,
    [property: JsonPropertyName("crosshair_code")] string? CrosshairCode,
    [property: JsonPropertyName("scoreboard_flair")] uint ScoreboardFlair)
{
    public const ulong SteamId64Base = 76561197960265728UL;
    public ulong SteamId64 => SteamId64Base + SteamAccountId;
}

public sealed class BotIdentityCatalog
{
    private readonly IReadOnlyDictionary<string, BotIdentity> _identities;

    private BotIdentityCatalog(IReadOnlyDictionary<string, BotIdentity> identities)
    {
        _identities = identities;
    }

    public static BotIdentityCatalog Load(string path)
    {
        var source = JsonSerializer.Deserialize<Dictionary<string, BotIdentity>>(
            File.ReadAllText(path), MatchJson.Options)
            ?? throw new InvalidDataException("bot_info.json is empty");
        var identities = new Dictionary<string, BotIdentity>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, identity) in source)
        {
            if (string.IsNullOrWhiteSpace(name) || identity.SteamAccountId == 0)
                continue;
            if (!identities.TryAdd(name, identity))
                throw new InvalidDataException($"Duplicate bot identity: {name}");
        }
        return new BotIdentityCatalog(identities);
    }

    public bool TryGet(string name, out BotIdentity identity) =>
        _identities.TryGetValue(name, out identity!);
}
