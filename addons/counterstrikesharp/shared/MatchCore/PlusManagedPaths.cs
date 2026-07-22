namespace MatchCore;

public static class PlusManagedPaths
{
    public static string ResolveCsgoRoot(string serverGameDirectory)
    {
        var candidates = CandidateCsgoRoots(serverGameDirectory);
        foreach (var candidate in candidates)
        {
            if (File.Exists(Path.Combine(candidate, "gameinfo.gi")))
                return candidate;
        }

        throw new DirectoryNotFoundException(
            $"Cannot resolve the CS2 content directory from '{serverGameDirectory}'. " +
            $"None of these candidates contains gameinfo.gi: {string.Join(", ", candidates)}");
    }

    public static IReadOnlyList<string> CandidateCsgoRoots(string serverGameDirectory)
    {
        if (string.IsNullOrWhiteSpace(serverGameDirectory))
            throw new ArgumentException("CounterStrikeSharp game directory is empty", nameof(serverGameDirectory));

        var reported = Path.GetFullPath(serverGameDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var leaf = Path.GetFileName(reported);
        var candidates = new List<string>();

        if (leaf.Equals("csgo", StringComparison.OrdinalIgnoreCase))
            candidates.Add(reported);
        if (leaf.Equals("game", StringComparison.OrdinalIgnoreCase))
            candidates.Add(Path.Combine(reported, "csgo"));

        candidates.Add(Path.Combine(reported, "game", "csgo"));
        candidates.Add(Path.Combine(reported, "csgo"));
        candidates.Add(reported);

        return candidates
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static bool TryResolveCsgoRoot(string serverGameDirectory, out string csgoRoot)
    {
        try
        {
            csgoRoot = ResolveCsgoRoot(serverGameDirectory);
            return true;
        }
        catch (ArgumentException)
        {
            csgoRoot = "";
            return false;
        }
        catch (DirectoryNotFoundException)
        {
            csgoRoot = "";
            return false;
        }
    }

    public static string ActiveMatchPath(string csgoRoot) =>
        Path.Combine(csgoRoot, ".csbip", "match-active.json");
}
