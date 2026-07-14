using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Memory.DynamicFunctions;
using CounterStrikeSharp.API.Modules.Timers;
using Microsoft.Extensions.Logging;

namespace PlayerKnifeCustomizer;

public sealed class PlayerKnifeCustomizerPlugin : BasePlugin
{
    public override string ModuleName => "PlayerCosmetics";
    public override string ModuleVersion => "0.3.1";
    public override string ModuleAuthor => "CS2BotImproverPlus contributors";
    public override string ModuleDescription => "Applies Panel-defined player cosmetic presets";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    private readonly Dictionary<ushort, HashSet<int>> _validPaints = new();
    private readonly Dictionary<ushort, List<WeaponSkinEntry>> _skinCatalog = new();
    private readonly HashSet<(ushort DefIndex, int Paint)> _legacyPaints = new();
    private KnifeConfig _config = new();
    private MemoryFunctionVoid<nint, string, float>? _setAttrByName;
    private ulong _nextItemId = 0xC5200000;
    private bool _applyErrorLogged;
    private DateTime _configWriteUtc;
    private DateTime _gunConfigWriteUtc;

    private string ConfigPath => Path.Combine(ModuleDirectory, "player_knife_presets.json");
    private string GunConfigPath => Path.Combine(ModuleDirectory, "player_gun_presets.json");
    private string CatalogPath => Path.Combine(ModuleDirectory, "weapon_skins.json");

    public override void Load(bool hotReload)
    {
        LoadCatalog();
        LoadConfig();

        AddCommand("css_cs2bi_knives_reload", "Reload player knife presets", OnReloadCommand);
        AddCommand("css_cs2bi_knives_status", "Show player knife preset status", OnStatusCommand);

        try
        {
            _setAttrByName = new MemoryFunctionVoid<nint, string, float>(
                RuntimeInformation.IsOSPlatform(OSPlatform.Linux)
                    ? "55 48 89 E5 41 57 41 56 49 89 FE 41 55 41 54 53 48 89 F3 48 83 EC ? F3 0F 11 85"
                    : "40 53 55 41 56 48 81 EC 90 00 00 00");
        }
        catch (Exception ex)
        {
            Logger.LogError("[PlayerKnifeCustomizer] Attribute signature unavailable: {Message}", ex.Message);
            _setAttrByName = null;
        }

        RegisterEventHandler<EventPlayerSpawn>(OnPlayerSpawn);
        RegisterEventHandler<EventRoundMvp>(OnRoundMvp, HookMode.Pre);
        RegisterEventHandler<EventItemPickup>(OnItemPickup);
        RegisterEventHandler<EventPlayerDeath>(OnPlayerDeath);
        VirtualFunctions.GiveNamedItemFunc.Hook(OnGiveNamedItemPost, HookMode.Post);
    }

    public override void Unload(bool hotReload)
    {
        VirtualFunctions.GiveNamedItemFunc.Unhook(OnGiveNamedItemPost, HookMode.Post);
    }

    private HookResult OnGiveNamedItemPost(DynamicHook hook)
    {
        if (_setAttrByName == null || !_config.Enabled) return HookResult.Continue;
        try
        {
            var itemServices = hook.GetParam<CCSPlayer_ItemServices>(0);
            var weapon = hook.GetReturn<CBasePlayerWeapon>();
            var player = GetPlayerFromItemServices(itemServices);
            if (!CanApplyToPlayer(player) || weapon == null || !weapon.IsValid)
                return HookResult.Continue;

            ushort defIndex = weapon.AttributeManager?.Item?.ItemDefinitionIndex ?? 0;
            if (defIndex == 0 || IsKnifeDefIndex(defIndex) || !_config.GunPresets.ContainsKey(defIndex))
                return HookResult.Continue;

            // A GiveNamedItem post-hook can expose an entity before both econ
            // attribute lists are initialized. Calling the native setter here
            // caused repeatable CoreCLR access violations. Resolve the entity
            // from its handle on the next frame, after engine initialization.
            nint handle = weapon.Handle;
            if (handle != nint.Zero)
                Server.NextFrame(() => TryApplyPurchasedWeapon(handle, defIndex));
        }
        catch (Exception ex)
        {
            LogApplyError("purchased weapon", ex);
        }
        return HookResult.Continue;
    }

    private void TryApplyPurchasedWeapon(nint handle, ushort expectedDefIndex)
    {
        try
        {
            if (handle == nint.Zero) return;

            var weapon = new CBasePlayerWeapon(handle);
            if (!weapon.IsValid || !HasEligibleHumanOwner(weapon)) return;

            var item = weapon.AttributeManager?.Item;
            if (item == null || !HasReadyAttributeLists(item) ||
                item.ItemDefinitionIndex != expectedDefIndex)
                return;

            ApplyPresetForCurrentDefinition(weapon);
        }
        catch (Exception ex)
        {
            LogApplyError("deferred purchased weapon", ex);
        }
    }

    private static CCSPlayerController? GetPlayerFromItemServices(CCSPlayer_ItemServices itemServices)
    {
        var pawn = itemServices.Pawn.Value;
        if (pawn == null || !pawn.IsValid || pawn.Controller.Value == null || !pawn.Controller.IsValid)
            return null;
        var player = new CCSPlayerController(pawn.Controller.Value.Handle);
        return player.IsValid ? player : null;
    }

    [GameEventHandler]
    public HookResult OnPlayerSpawn(EventPlayerSpawn @event, GameEventInfo _)
    {
        var player = @event.Userid;
        if (!CanApplyToPlayer(player)) return HookResult.Continue;

        ApplyDefaultKnifeDeferred(player!, 0.0f);
        ApplyDefaultKnifeDeferred(player!, 0.10f);
        ApplyDefaultKnifeDeferred(player!, 0.25f);
        ApplyGloveDeferred(player!, 0.0f);
        ApplyGloveDeferred(player!, 0.10f);
        ApplyGloveDeferred(player!, 0.25f);
        ApplyGunPresetsDeferred(player!, 0.10f);
        ApplyGunPresetsDeferred(player!, 0.25f);
        ApplyMusicKit(player!);
        return HookResult.Continue;
    }

    [GameEventHandler(HookMode.Pre)]
    public HookResult OnRoundMvp(EventRoundMvp @event, GameEventInfo _)
    {
        var player = @event.Userid;
        if (!CanApplyToPlayer(player) || _config.MusicKitId <= 0)
            return HookResult.Continue;

        ApplyMusicKit(player!);
        @event.Musickitid = _config.MusicKitId;
        @event.Nomusic = 0;
        return HookResult.Continue;
    }

    private void ApplyMusicKit(CCSPlayerController player)
    {
        if (!CanApplyToPlayer(player) || _config.MusicKitId <= 0)
            return;

        player.MusicKitID = _config.MusicKitId;
        Utilities.SetStateChanged(player, "CCSPlayerController", "m_iMusicKitID");
    }

    [GameEventHandler]
    public HookResult OnItemPickup(EventItemPickup @event, GameEventInfo _)
    {
        var player = @event.Userid;
        if (!_config.ApplyOnPickup || !CanApplyToPlayer(player))
            return HookResult.Continue;

        Server.NextFrame(() => ApplyPresetsToInventory(player!));
        AddTimer(0.10f, () => ApplyPresetsToInventory(player!), TimerFlags.STOP_ON_MAPCHANGE);
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnPlayerDeath(EventPlayerDeath @event, GameEventInfo _)
    {
        var attacker = @event.Attacker;
        var victim = @event.Userid;
        if (!CanApplyToPlayer(attacker) || victim == null || !victim.IsValid || attacker == victim)
            return HookResult.Continue;

        var weapon = attacker!.PlayerPawn.Value?.WeaponServices?.ActiveWeapon.Value;
        if (weapon == null || !weapon.IsValid)
            return HookResult.Continue;

        ushort defIndex = weapon.AttributeManager?.Item?.ItemDefinitionIndex ?? 0;
        if (!TryGetPreset(defIndex, out var preset) || !preset.StatTrakEnabled)
            return HookResult.Continue;

        preset.StatTrakCount++;
        ApplyStatTrak(weapon, preset);
        SaveConfig();
        return HookResult.Continue;
    }

    private void ApplyDefaultKnifeDeferred(CCSPlayerController player, float delay)
    {
        void Apply()
        {
            if (!CanApplyToPlayer(player)) return;
            var pawn = player.PlayerPawn.Value;
            if (pawn == null || !pawn.IsValid) return;

            var weapons = pawn.WeaponServices?.MyWeapons;
            if (weapons == null) return;
            foreach (var handle in weapons)
            {
                var weapon = handle.Value;
                if (weapon == null || !weapon.IsValid || !IsKnifeName(weapon.DesignerName)) continue;

                ushort target = _config.DefaultKnifeDefIndex;
                if (target > 0 && _config.Presets.ContainsKey(target))
                {
                    weapon.AcceptInput("ChangeSubclass", value: target.ToString());
                    var item = weapon.AttributeManager?.Item;
                    if (item != null) item.ItemDefinitionIndex = target;
                    ApplyPreset(weapon, target, _config.Presets[target]);
                }
                else
                {
                    ApplyPresetForCurrentDefinition(weapon);
                }
                break;
            }
        }

        if (delay <= 0) Server.NextFrame(Apply);
        else AddTimer(delay, Apply, TimerFlags.STOP_ON_MAPCHANGE);
    }

    private void ApplyPresetsToInventory(CCSPlayerController player)
    {
        if (!CanApplyToPlayer(player)) return;
        var pawn = player.PlayerPawn.Value;
        if (pawn == null || !pawn.IsValid) return;

        var weapons = pawn.WeaponServices?.MyWeapons;
        if (weapons == null) return;
        foreach (var handle in weapons)
        {
            var weapon = handle.Value;
            if (weapon == null || !weapon.IsValid) continue;
            ApplyPresetForCurrentDefinition(weapon);
        }
    }

    private void ApplyGunPresetsDeferred(CCSPlayerController player, float delay)
    {
        AddTimer(delay, () => ApplyPresetsToInventory(player), TimerFlags.STOP_ON_MAPCHANGE);
    }

    private bool ApplyPresetForCurrentDefinition(CBasePlayerWeapon weapon)
    {
        ushort defIndex = weapon.AttributeManager?.Item?.ItemDefinitionIndex ?? 0;
        if (defIndex == 0 || !TryGetPreset(defIndex, out var preset)) return false;
        return ApplyPreset(weapon, defIndex, preset);
    }

    private bool TryGetPreset(ushort defIndex, out KnifePreset preset)
    {
        Dictionary<ushort, KnifePreset> presets = IsKnifeDefIndex(defIndex)
            ? _config.Presets
            : _config.GunPresets;
        return presets.TryGetValue(defIndex, out preset!);
    }

    private bool ApplyPreset(CBasePlayerWeapon weapon, ushort defIndex, KnifePreset preset)
    {
        if (_setAttrByName == null || !weapon.IsValid || !ValidatePreset(defIndex, preset)) return false;

        try
        {
            var item = weapon.AttributeManager?.Item;
            if (item == null || !HasReadyAttributeLists(item)) return false;

            item.ItemDefinitionIndex = defIndex;
            item.EntityQuality = preset.SouvenirEnabled ? (byte)12
                : preset.StatTrakEnabled ? (byte)9 : (byte)3;
            item.CustomName = preset.NameTag ?? string.Empty;
            item.AttributeList.Attributes.RemoveAll();
            item.NetworkedDynamicAttributes.Attributes.RemoveAll();
            AssignItemId(item);

            weapon.FallbackPaintKit = preset.Paint;
            weapon.FallbackSeed = preset.Seed;
            weapon.FallbackWear = preset.Wear;

            SetTextureAttributes(item.NetworkedDynamicAttributes.Handle, preset);
            SetTextureAttributes(item.AttributeList.Handle, preset);
            if (preset.StatTrakEnabled && !preset.SouvenirEnabled) ApplyStatTrak(weapon, preset);

            Utilities.SetStateChanged(weapon, "CEconEntity", "m_AttributeManager");
            bool legacyModel = _legacyPaints.Contains((defIndex, preset.Paint));
            weapon.AcceptInput("SetBodygroup", value: $"body,{(legacyModel ? 1 : 0)}");
            return true;
        }
        catch (Exception ex)
        {
            LogApplyError($"defindex {defIndex}", ex);
            return false;
        }
    }

    private void ApplyGloveDeferred(CCSPlayerController player, float delay)
    {
        if (!_config.Glove.Enabled) return;

        void Apply()
        {
            if (!CanApplyToPlayer(player)) return;
            var pawn = player.PlayerPawn.Value;
            if (pawn == null || !pawn.IsValid) return;
            ApplyGlove(pawn, _config.Glove);
        }

        if (delay <= 0) Server.NextFrame(Apply);
        else AddTimer(delay, Apply, TimerFlags.STOP_ON_MAPCHANGE);
    }

    private void ApplyGlove(CCSPlayerPawn pawn, GlovePreset preset)
    {
        if (_setAttrByName == null || !preset.Enabled || preset.DefIndex == 0 || preset.Paint <= 0) return;

        try
        {
            var item = pawn.EconGloves;
            if (!HasReadyAttributeLists(item)) return;
            item.NetworkedDynamicAttributes.Attributes.RemoveAll();
            item.AttributeList.Attributes.RemoveAll();
            item.ItemDefinitionIndex = preset.DefIndex;
            AssignItemId(item);

            SetTextureAttributes(item.NetworkedDynamicAttributes.Handle, preset.Paint, preset.Seed, preset.Wear);
            SetTextureAttributes(item.AttributeList.Handle, preset.Paint, preset.Seed, preset.Wear);
            item.Initialized = true;

            pawn.AcceptInput("SetBodygroup", value: "first_or_third_person,0");
            AddTimer(0.20f, () =>
            {
                if (pawn.IsValid)
                    pawn.AcceptInput("SetBodygroup", value: "first_or_third_person,1");
            }, TimerFlags.STOP_ON_MAPCHANGE);
        }
        catch (Exception ex)
        {
            LogApplyError("gloves", ex);
        }
    }

    private void SetTextureAttributes(nint handle, KnifePreset preset)
    {
        SetTextureAttributes(handle, preset.Paint, preset.Seed, preset.Wear);
    }

    private void SetTextureAttributes(nint handle, int paint, int seed, float wear)
    {
        if (handle == nint.Zero) return;
        _setAttrByName!.Invoke(handle, "set item texture prefab", paint);
        _setAttrByName.Invoke(handle, "set item texture seed", seed);
        _setAttrByName.Invoke(handle, "set item texture wear", wear);
    }

    private void ApplyStatTrak(CBasePlayerWeapon weapon, KnifePreset preset)
    {
        if (_setAttrByName == null) return;
        var item = weapon.AttributeManager?.Item;
        if (item == null) return;

        nint networkedHandle = item.NetworkedDynamicAttributes.Handle;
        nint attributeHandle = item.AttributeList.Handle;
        if (networkedHandle == nint.Zero || attributeHandle == nint.Zero) return;

        float count = BitConverter.Int32BitsToSingle(preset.StatTrakCount);
        _setAttrByName.Invoke(networkedHandle, "kill eater", count);
        _setAttrByName.Invoke(networkedHandle, "kill eater score type", 0);
        _setAttrByName.Invoke(attributeHandle, "kill eater", count);
        _setAttrByName.Invoke(attributeHandle, "kill eater score type", 0);
        Utilities.SetStateChanged(weapon, "CEconEntity", "m_AttributeManager");
    }

    private bool ValidatePreset(ushort defIndex, KnifePreset preset)
    {
        if (preset.Paint <= 0 || preset.Seed is < 0 or > 1000 || preset.Wear is < 0 or > 1)
            return false;
        if (_validPaints.TryGetValue(defIndex, out var paints) && !paints.Contains(preset.Paint))
            return false;
        if (preset.StatTrakEnabled && preset.SouvenirEnabled)
            return false;
        WeaponSkinEntry? skin = FindSkin(defIndex, preset.Paint);
        if (skin == null) return IsKnifeDefIndex(defIndex);
        return (!preset.StatTrakEnabled || skin.StatTrak) &&
               (!preset.SouvenirEnabled || skin.Souvenir) &&
               preset.Wear >= skin.MinWear && preset.Wear <= skin.MaxWear;
    }

    private bool CanApplyToPlayer(CCSPlayerController? player) =>
        _config.Enabled && _config.ApplyToHumanPlayers && player is { IsValid: true, IsBot: false, IsHLTV: false };

    private static bool IsKnifeName(string? name) =>
        !string.IsNullOrWhiteSpace(name) && (name.Contains("knife", StringComparison.OrdinalIgnoreCase)
                                             || name.Contains("bayonet", StringComparison.OrdinalIgnoreCase));

    private static bool IsKnifeDefIndex(ushort defIndex) => defIndex is >= 500 and <= 526;

    private bool HasEligibleHumanOwner(CBasePlayerWeapon weapon)
    {
        try
        {
            var owner = weapon.OwnerEntity.Value;
            if (owner == null || !owner.IsValid) return false;
            var pawn = new CCSPlayerPawn(owner.Handle);
            var controller = pawn.Controller.Value;
            if (controller == null || !controller.IsValid) return false;
            return CanApplyToPlayer(new CCSPlayerController(controller.Handle));
        }
        catch
        {
            return false;
        }
    }

    private static bool HasReadyAttributeLists(CEconItemView item) =>
        item.AttributeList.Handle != nint.Zero &&
        item.NetworkedDynamicAttributes.Handle != nint.Zero;

    private void AssignItemId(CEconItemView item)
    {
        ulong id = unchecked(_nextItemId++);
        item.ItemID = id;
        item.ItemIDLow = (uint)(id & 0xFFFFFFFF);
        item.ItemIDHigh = (uint)(id >> 32);
    }

    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(ConfigPath))
            {
                _config = new KnifeConfig();
                LoadGunConfig();
                SaveConfig();
                return;
            }

            _config = JsonSerializer.Deserialize<KnifeConfig>(File.ReadAllText(ConfigPath), JsonOptions)
                      ?? new KnifeConfig();
            _config.Normalize();
            LoadGunConfig();
            _configWriteUtc = File.GetLastWriteTimeUtc(ConfigPath);
            _applyErrorLogged = false;
        }
        catch (Exception ex)
        {
            _config = new KnifeConfig();
            LoadGunConfig();
            Logger.LogError("[PlayerKnifeCustomizer] Config load failed: {Message}", ex.Message);
        }
    }

    private void SaveConfig()
    {
        string temp = ConfigPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(_config, JsonOptions));
        File.Move(temp, ConfigPath, true);
        SaveGunConfig();
    }

    private void LoadGunConfig()
    {
        if (!File.Exists(GunConfigPath))
        {
            if (_config.GunPresets.Count > 0) SaveGunConfig();
            return;
        }
        try
        {
            _config.GunPresets = JsonSerializer.Deserialize<Dictionary<ushort, KnifePreset>>(
                File.ReadAllText(GunConfigPath), JsonOptions) ?? new Dictionary<ushort, KnifePreset>();
            _config.Normalize();
            _gunConfigWriteUtc = File.GetLastWriteTimeUtc(GunConfigPath);
        }
        catch (Exception ex)
        {
            Logger.LogError("[PlayerKnifeCustomizer] Gun preset config load failed: {Message}", ex.Message);
        }
    }

    private void SaveGunConfig()
    {
        string temp = GunConfigPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(_config.GunPresets, JsonOptions));
        File.Move(temp, GunConfigPath, true);
        _gunConfigWriteUtc = File.GetLastWriteTimeUtc(GunConfigPath);
    }

    private void LoadCatalog()
    {
        _validPaints.Clear();
        _skinCatalog.Clear();
        _legacyPaints.Clear();
        if (!File.Exists(CatalogPath)) return;

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(CatalogPath));
            foreach (var entry in document.RootElement.EnumerateArray())
            {
                ushort defIndex = (ushort)ReadInt(entry.GetProperty("weapon_defindex"));
                int paint = ReadInt(entry.GetProperty("paint"));
                if (defIndex == 0 || paint <= 0) continue;
                var skin = new WeaponSkinEntry
                {
                    WeaponDefIndex = defIndex,
                    Paint = paint,
                    Name = entry.TryGetProperty("name", out var name) ? name.GetString() ?? $"Paint Kit {paint}" : $"Paint Kit {paint}",
                    MinWear = entry.TryGetProperty("min_wear", out var minWear) ? minWear.GetSingle() : 0f,
                    MaxWear = entry.TryGetProperty("max_wear", out var maxWear) ? maxWear.GetSingle() : 1f,
                    StatTrak = entry.TryGetProperty("stattrak", out var statTrak) && statTrak.GetBoolean(),
                    Souvenir = entry.TryGetProperty("souvenir", out var souvenir) && souvenir.GetBoolean(),
                };
                if (entry.TryGetProperty("legacy_model", out var legacy) && legacy.GetBoolean())
                    _legacyPaints.Add((defIndex, paint));
                if (!_validPaints.TryGetValue(defIndex, out var paints))
                    _validPaints[defIndex] = paints = new HashSet<int>();
                paints.Add(paint);
                if (!_skinCatalog.TryGetValue(defIndex, out var skins))
                    _skinCatalog[defIndex] = skins = new List<WeaponSkinEntry>();
                skins.Add(skin);
            }
            foreach (var skins in _skinCatalog.Values)
                skins.Sort((left, right) => string.Compare(left.Name, right.Name, StringComparison.CurrentCulture));
        }
        catch (Exception ex)
        {
            Logger.LogError("[PlayerKnifeCustomizer] Skin catalog load failed: {Message}", ex.Message);
        }

        static int ReadInt(JsonElement element) => element.ValueKind == JsonValueKind.Number
            ? element.GetInt32()
            : int.TryParse(element.GetString(), out int value) ? value : 0;
    }

    private WeaponSkinEntry? FindSkin(ushort defIndex, int paint) =>
        _skinCatalog.TryGetValue(defIndex, out var skins)
            ? skins.FirstOrDefault(skin => skin.Paint == paint)
            : null;

    private void OnReloadCommand(CCSPlayerController? player, CommandInfo command)
    {
        LoadCatalog();
        LoadConfig();
        string restart = _config.Enabled && _setAttrByName == null ? "; restart CS2 to initialize runtime hooks" : string.Empty;
        command.ReplyToCommand($"[PlayerKnifeCustomizer] reloaded; enabled={_config.Enabled}, knives={_config.Presets.Count}, guns={_config.GunPresets.Count}, music={_config.MusicKitId}{restart}");
    }

    private void OnStatusCommand(CCSPlayerController? player, CommandInfo command)
    {
        command.ReplyToCommand($"[PlayerKnifeCustomizer] enabled={_config.Enabled}, signature={(_setAttrByName == null ? "missing" : "loaded")}, knives={_config.Presets.Count}, guns={_config.GunPresets.Count}, music={_config.MusicKitId}, catalog={_skinCatalog.Values.Sum(skins => skins.Count)}");
    }

    private void LogApplyError(string operation, Exception ex)
    {
        if (_applyErrorLogged) return;
        _applyErrorLogged = true;
        Logger.LogError("[PlayerKnifeCustomizer] Apply failed during {Operation}: {Message}", operation, ex.Message);
    }
}

public sealed class KnifeConfig
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("apply_to_human_players")]
    public bool ApplyToHumanPlayers { get; set; } = true;

    [JsonPropertyName("apply_on_pickup")]
    public bool ApplyOnPickup { get; set; } = true;

    [JsonPropertyName("default_knife_defindex")]
    public ushort DefaultKnifeDefIndex { get; set; }

    [JsonPropertyName("presets")]
    public Dictionary<ushort, KnifePreset> Presets { get; set; } = new();

    [JsonPropertyName("gun_presets")]
    public Dictionary<ushort, KnifePreset> GunPresets { get; set; } = new();

    [JsonPropertyName("music_kit_id")]
    public int MusicKitId { get; set; }

    [JsonPropertyName("glove")]
    public GlovePreset Glove { get; set; } = new();

    public void Normalize()
    {
        Presets ??= new Dictionary<ushort, KnifePreset>();
        GunPresets ??= new Dictionary<ushort, KnifePreset>();
        Glove ??= new GlovePreset();
        MusicKitId = Math.Clamp(MusicKitId, 0, ushort.MaxValue);
        foreach (var preset in Presets.Values.Concat(GunPresets.Values))
        {
            preset.Seed = Math.Clamp(preset.Seed, 0, 1000);
            preset.Wear = Math.Clamp(preset.Wear, 0f, 1f);
            preset.StatTrakCount = Math.Max(0, preset.StatTrakCount);
            if (preset.SouvenirEnabled) preset.StatTrakEnabled = false;
            if (preset.NameTag?.Length > 20) preset.NameTag = preset.NameTag[..20];
        }
        Glove.Seed = Math.Clamp(Glove.Seed, 0, 1000);
        Glove.Wear = Math.Clamp(Glove.Wear, 0f, 1f);
    }
}

public sealed class GlovePreset
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("defindex")]
    public ushort DefIndex { get; set; }

    [JsonPropertyName("paint")]
    public int Paint { get; set; }

    [JsonPropertyName("seed")]
    public int Seed { get; set; }

    [JsonPropertyName("wear")]
    public float Wear { get; set; } = 0.01f;
}

public sealed class KnifePreset
{
    [JsonPropertyName("paint")]
    public int Paint { get; set; }

    [JsonPropertyName("seed")]
    public int Seed { get; set; }

    [JsonPropertyName("wear")]
    public float Wear { get; set; } = 0.01f;

    [JsonPropertyName("name_tag")]
    public string? NameTag { get; set; } = string.Empty;

    [JsonPropertyName("stattrak_enabled")]
    public bool StatTrakEnabled { get; set; }

    [JsonPropertyName("stattrak_count")]
    public int StatTrakCount { get; set; }

    [JsonPropertyName("souvenir_enabled")]
    public bool SouvenirEnabled { get; set; }
}

public sealed class WeaponSkinEntry
{
    public ushort WeaponDefIndex { get; init; }
    public int Paint { get; init; }
    public string Name { get; init; } = string.Empty;
    public float MinWear { get; init; }
    public float MaxWear { get; init; } = 1f;
    public bool StatTrak { get; init; }
    public bool Souvenir { get; init; }
}
