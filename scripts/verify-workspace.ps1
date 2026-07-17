[CmdletBinding()]
param(
    [string]$PackageRoot
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $PSScriptRoot "dependencies.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
. (Join-Path $PSScriptRoot "VpkTools.ps1")
$failures = [Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) {
    $failures.Add($Message)
}

function Assert-File([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Add-Failure "Missing $Label`: $Path"
    }
}

function Get-JsonCount([string]$RelativePath) {
    $path = Join-Path $repo $RelativePath
    try {
        $document = [System.Text.Json.JsonDocument]::Parse([IO.File]::ReadAllText($path))
        try {
            if ($document.RootElement.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
                return $document.RootElement.GetArrayLength()
            }
            if ($document.RootElement.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
                $count = 0
                foreach ($property in $document.RootElement.EnumerateObject()) { $count++ }
                return $count
            }
            return 1
        }
        finally {
            $document.Dispose()
        }
    }
    catch {
        Add-Failure "Invalid JSON $RelativePath`: $($_.Exception.Message)"
        return -1
    }
}

$base = $manifest.upstream.baseCommit
& git -C $repo cat-file -e "$base^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
    Add-Failure "Pinned upstream commit is unavailable: $base"
}
else {
    $upstreamModules = @(
        "addons/counterstrikesharp/plugins/BotAI",
        "addons/counterstrikesharp/plugins/BotBuy",
        "addons/counterstrikesharp/plugins/BotRandomizer",
        "addons/counterstrikesharp/plugins/BotState",
        "addons/counterstrikesharp/plugins/RoundDamageRecap",
        "overrides"
    )
    $changed = @(
        foreach ($module in $upstreamModules) {
            & git -C $repo diff --ignore-space-at-eol --quiet $base -- $module
            if ($LASTEXITCODE -eq 1) {
                & git -C $repo diff --ignore-space-at-eol --name-only $base -- $module
            }
            elseif ($LASTEXITCODE -ne 0) {
                Add-Failure "Unable to compare upstream enhanced-bot module: $module"
            }
        }
    )
    $allowedUpstreamChanges = @(
        "addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.cs",
        "addons/counterstrikesharp/plugins/BotRandomizer/bot_randomizer_options.json"
    )
    $unexpectedChanges = @($changed | Where-Object { $_ -notin $allowedUpstreamChanges })
    if ($unexpectedChanges.Count -gt 0) {
        Add-Failure "Upstream enhanced-bot modules were modified: $($unexpectedChanges -join ', ')"
    }
}

$botAiProject = Get-Content -LiteralPath (Join-Path $repo "addons/counterstrikesharp/plugins/BotAI/BotAI.csproj") -Raw
if ($botAiProject -match 'Tmp\\ArchiveV02\\Common') {
    Add-Failure "BotAI still references the machine-specific Common.dll path."
}

$requiredSources = @(
    "Panel/src-tauri/src/lib.rs",
    "Panel/src/panels/KnifePresetModal.tsx",
    "Panel/src/panels/GlovePresetModal.tsx",
    "Panel/src/panels/WeaponPresetModal.tsx",
    "Panel/src/panels/MusicKitPresetModal.tsx",
    "addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.cs",
    "addons/counterstrikesharp/plugins/BotRandomizer/bot_randomizer_options.json",
    "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/PlayerKnifeCustomizer.cs",
    "addons/counterstrikesharp/plugins/BotHiderImpl/BotHiderImplPlugin.cs"
)
foreach ($relative in $requiredSources) {
    Assert-File (Join-Path $repo $relative) $relative
}

$playerCosmetics = Get-Content -LiteralPath (Join-Path $repo "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/PlayerKnifeCustomizer.cs") -Raw
$giveHookStart = $playerCosmetics.IndexOf("private HookResult OnGiveNamedItemPost", [StringComparison]::Ordinal)
$nextMethodStart = $playerCosmetics.IndexOf("private static CCSPlayerController? GetPlayerFromItemServices", [StringComparison]::Ordinal)
if ($giveHookStart -lt 0 -or $nextMethodStart -le $giveHookStart) {
    Add-Failure "PlayerCosmetics purchased-weapon lifecycle guard is missing."
}
else {
    $giveHook = $playerCosmetics.Substring($giveHookStart, $nextMethodStart - $giveHookStart)
    if ($giveHook -match "AttributeManager|\bApplyPreset(?:ForCurrentDefinition)?\(|AcceptInput" -or
        $giveHook -notmatch "ScheduleApplyPipeline\(player!\.Handle, CosmeticApplyPhase\.Guns\)") {
        Add-Failure "PlayerCosmetics must not invoke native econ setters inside GiveNamedItem post-hook."
    }
}
if ($playerCosmetics -notmatch "Server\.NextFrame\(\(\) => RunApplyPipeline\(playerHandle, generation, false\)\)" -or
    $playerCosmetics -notmatch "RetryDelays = \[0\.10f, 0\.25f, 0\.50f, 0\.90f\]" -or
    $playerCosmetics -notmatch "finalAttempt = index == ApplyPipelineContext\.RetryDelays\.Length - 1" -or
    $playerCosmetics -notmatch "player\.PawnIsAlive" -or
    $playerCosmetics -notmatch "TryBindContext\(playerHandle, generation, readyPawn\.Handle, \(int\)readyTeam\)") {
    Add-Failure "PlayerCosmetics generation pipeline no longer has bounded retries and Pawn/team context validation."
}
if ($playerCosmetics -notmatch "private static bool HasReadyAttributeLists\(CEconItemView item\)" -or
    ([regex]::Matches($playerCosmetics, "HasReadyAttributeLists\(item\)").Count -lt 3)) {
    Add-Failure "PlayerCosmetics native attribute handles are not validated at every write entry point."
}
if ($playerCosmetics -match "RegisterListener<Listeners\.OnEntitySpawned>" -or
    $playerCosmetics -match "TryApplyDroppedKnife" -or
    $playerCosmetics -match "Server\.NextWorldUpdate") {
    Add-Failure "PlayerCosmetics must not retain raw entity pointers across world updates for dropped knives."
}

$jsonFiles = @(
    "addons/BotHider/bot_info.json",
    "addons/BotHider/gamedata.json",
    "addons/BotHider/map_whitelist.json",
    "Panel/src/data/gloveSkins.json",
    "Panel/src/data/musicKits.json",
    "Panel/src/data/skinImages.json",
    "Panel/src/data/skinNames.json",
    "Panel/src/data/weaponSkins.json",
    "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/player_gun_presets.json",
    "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/player_knife_presets.json",
    "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/skins_en.json",
    "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/weapon_skins.json"
)
$counts = @{}
foreach ($relative in $jsonFiles) {
    $counts[$relative] = Get-JsonCount $relative
}

$catalogA = Join-Path $repo "Panel/src/data/weaponSkins.json"
$catalogB = Join-Path $repo "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/weapon_skins.json"
if ((Get-FileHash -LiteralPath $catalogA -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $catalogB -Algorithm SHA256).Hash) {
    Add-Failure "Panel and plugin weapon catalogs are not identical."
}

$botHiderImpl = Get-Content -LiteralPath (Join-Path $repo "addons/counterstrikesharp/plugins/BotHiderImpl/BotHiderImplPlugin.cs") -Raw
if ($botHiderImpl -notmatch "foreach \(int slot in managedSlots\)" -or
    $botHiderImpl -notmatch "player\.PlayerName = name" -or
    $botHiderImpl -notmatch 'ModuleVersion => "0\.3\.0"' -or
    $botHiderImpl -notmatch "EnsureBotInfoNameSource\(\)") {
    Add-Failure "BotHiderImpl no longer preserves the v0.3.1 managed-name integration."
}
$botHiderGameData = Get-Content -LiteralPath (Join-Path $repo "addons/BotHider/gamedata.json") -Raw
if ($botHiderGameData -notmatch '"CServerSideClient::SetName"' -or
    $botHiderGameData -notmatch '"CNetworkGameServer::PackEntities"') {
    Add-Failure "BotHider gamedata no longer contains the v0.3.1 name and identity targets."
}

$trackedGenerated = @(& git -C $repo ls-files | Where-Object {
    $_ -match '(^|/)(bin|obj|node_modules|dist|target|artifacts|\.cache)/'
})
if ($trackedGenerated.Count -gt 0) {
    Add-Failure "Generated paths are tracked: $($trackedGenerated -join ', ')"
}

if ($PackageRoot) {
    $package = [IO.Path]::GetFullPath($PackageRoot)
    $requiredPackageFiles = @(
        "addons/BotHider/bin/win64/BotHider.dll",
        "addons/metamod/bin/win64/server.dll",
        "addons/counterstrikesharp/bin/win64/counterstrikesharp.dll",
        "addons/RayTrace/bin/win64/RayTrace.dll",
        "addons/counterstrikesharp/plugins/RayTraceImpl/RayTraceImpl.dll",
        "addons/counterstrikesharp/plugins/BotAI/BotAI.dll",
        "addons/counterstrikesharp/plugins/BotAimImprover/BotAimImprover.dll",
        "addons/counterstrikesharp/plugins/BotBuy/BotBuy.dll",
        "addons/counterstrikesharp/plugins/BotHiderImpl/BotHiderImpl.dll",
        "addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.dll",
        "addons/counterstrikesharp/plugins/BotState/BotState.dll",
        "addons/counterstrikesharp/plugins/NadeSystem/NadeSystem.dll",
        "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/PlayerKnifeCustomizer.dll",
        "addons/counterstrikesharp/plugins/RoundDamageRecap/RoundDamageRecap.dll",
        "addons/counterstrikesharp/shared/0Harmony/0Harmony.dll",
        "addons/counterstrikesharp/shared/BotHiderApi/BotHiderApi.dll",
        "plus-payload-manifest.json",
        "CS2BotImproverPlus.exe",
        "README.md",
        "README.zh-CN.md",
        "LICENSE"
    )
    foreach ($relative in $requiredPackageFiles) {
        Assert-File (Join-Path $package $relative) "package file $relative"
    }
    $packagedPanel = Join-Path $package "CS2BotImproverPlus.exe"
    $builtPanel = Join-Path $repo "Panel/src-tauri/target/release/cs2-bot-improver-plus-panel.exe"
    if ((Test-Path -LiteralPath $packagedPanel) -and (Test-Path -LiteralPath $builtPanel) -and
        ((Get-FileHash -LiteralPath $packagedPanel -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $builtPanel -Algorithm SHA256).Hash)) {
        Add-Failure "Packaged Panel is not the current production Release build."
    }
    $nestedShared = Join-Path $package "addons/counterstrikesharp/plugins/BotHiderImpl/shared"
    if (Test-Path -LiteralPath $nestedShared) {
        Add-Failure "Package contains an invalid nested BotHiderImpl/shared directory."
    }
    $linuxBotHiderVdf = Join-Path $package "addons/metamod/BotHider.linux.vdf"
    if (Test-Path -LiteralPath $linuxBotHiderVdf) {
        Add-Failure "Windows package contains the Linux BotHider loader."
    }
    $packagedGameInfo = @(Get-ChildItem -LiteralPath $package -Recurse -Filter "gameinfo.gi" -File)
    if ($packagedGameInfo.Count -gt 0) {
        Add-Failure "Package must not contain stale gameinfo.gi files: $($packagedGameInfo.FullName -join ', ')"
    }

    $payloadManifestPath = Join-Path $package "plus-payload-manifest.json"
    if (Test-Path -LiteralPath $payloadManifestPath) {
        try {
            $payloadManifest = Get-Content -LiteralPath $payloadManifestPath -Raw | ConvertFrom-Json
            if ($payloadManifest.schema_version -ne 1 -or $payloadManifest.package_version -ne "1.4.2.4") {
                Add-Failure "Package payload manifest has an unexpected schema or version."
            }
            $manifestPaths = @{}
            $manifestPolicies = @{}
            foreach ($entry in $payloadManifest.entries) {
                $relative = [string]$entry.path
                if ($manifestPaths.ContainsKey($relative)) {
                    Add-Failure "Package payload manifest contains a duplicate path: $relative"
                    continue
                }
                $manifestPaths[$relative] = $true
                $manifestPolicies[$relative] = [string]$entry.restore_policy
                if ($relative -notmatch '^(addons|cfg|overrides)/' -or $relative -match '(^|/)\.\.(/|$)') {
                    Add-Failure "Package payload manifest contains an unsafe path: $relative"
                    continue
                }
                $file = Join-Path $package $relative
                if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
                    Add-Failure "Package payload manifest references a missing file: $relative"
                    continue
                }
                $actualSize = (Get-Item -LiteralPath $file).Length
                $actualHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($actualSize -ne [long]$entry.size -or $actualHash -ne ([string]$entry.sha256).ToLowerInvariant()) {
                    Add-Failure "Package payload manifest verification failed: $relative"
                }
            }
            $payloadFiles = foreach ($topLevel in @("addons", "cfg", "overrides")) {
                $root = Join-Path $package $topLevel
                if (Test-Path -LiteralPath $root) {
                    Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object {
                        [IO.Path]::GetRelativePath($package, $_.FullName).Replace("\", "/")
                    }
                }
            }
            foreach ($relative in $payloadFiles) {
                if (-not $manifestPaths.ContainsKey($relative)) {
                    Add-Failure "Package payload file is not tracked by the manifest: $relative"
                }
            }
            $expectedPreserveConfigs = @(
                "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/player_knife_presets.json",
                "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/player_gun_presets.json",
                "addons/counterstrikesharp/plugins/BotRandomizer/bot_randomizer_options.json",
                "cfg/my_bot_ffa_config.cfg",
                "cfg/my_bot_normal_config.cfg",
                "overrides/botprofile.vpk"
            )
            foreach ($relative in $expectedPreserveConfigs) {
                if ($manifestPolicies[$relative] -ne "preserve-config") {
                    Add-Failure "Mutable player configuration is not protected by preserve-config: $relative"
                }
            }
        }
        catch {
            Add-Failure "Package payload manifest is invalid: $($_.Exception.Message)"
        }
    }

    $botProfileVpks = @(
        "overrides/botprofile.vpk",
        "overrides/Low/botprofile.vpk",
        "overrides/Medium/botprofile.vpk",
        "overrides/High/botprofile.vpk"
    )
    foreach ($relative in $botProfileVpks) {
        $vpk = Join-Path $package $relative
        Assert-File $vpk "package file $relative"
        if (Test-Path -LiteralPath $vpk) {
            try {
                $entries = @(Get-VpkEntryPaths $vpk)
                if ($entries.Count -ne 1 -or $entries[0] -ne "botprofile.db") {
                    Add-Failure "Package $relative must contain only botprofile.db; found: $($entries -join ', ')"
                }
            }
            catch {
                Add-Failure "Invalid package VPK $relative`: $($_.Exception.Message)"
            }
        }
    }

    $native = Join-Path $package "addons/BotHider/bin/win64/BotHider.dll"
    if (Test-Path -LiteralPath $native) {
        $nativeHash = (Get-FileHash -LiteralPath $native -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($nativeHash -ne $manifest.botHider.windowsDllSha256.ToLowerInvariant()) {
            Add-Failure "Package BotHider.dll is not the verified v0.3.1 build: $nativeHash"
        }
    }

    $pinnedRuntimeFiles = @(
        @{ Relative = "addons/metamod/bin/win64/server.dll"; Hash = $manifest.metamod.windowsLoaderSha256; Label = "Metamod" },
        @{ Relative = "addons/counterstrikesharp/bin/win64/counterstrikesharp.dll"; Hash = $manifest.counterStrikeSharp.windowsCoreSha256; Label = "CounterStrikeSharp" },
        @{ Relative = "addons/RayTrace/bin/win64/RayTrace.dll"; Hash = $manifest.rayTrace.windowsDllSha256; Label = "RayTrace native" },
        @{ Relative = "addons/counterstrikesharp/plugins/RayTraceImpl/RayTraceImpl.dll"; Hash = $manifest.rayTrace.cssImplSha256; Label = "RayTrace CSS" }
    )
    foreach ($runtime in $pinnedRuntimeFiles) {
        $runtimePath = Join-Path $package $runtime.Relative
        if (Test-Path -LiteralPath $runtimePath) {
            $runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($runtimeHash -ne $runtime.Hash.ToLowerInvariant()) {
                Add-Failure "$($runtime.Label) does not match the pinned engine-26 runtime: $runtimeHash"
            }
        }
    }

    $builtPlugins = @(
        @{ Name = "BotAI"; Framework = "net10.0" },
        @{ Name = "BotAimImprover"; Framework = "net10.0" },
        @{ Name = "BotBuy"; Framework = "net8.0" },
        @{ Name = "BotRandomizer"; Framework = "net10.0" },
        @{ Name = "NadeSystem"; Framework = "net10.0" },
        @{ Name = "RoundDamageRecap"; Framework = "net8.0" }
    )
    foreach ($plugin in $builtPlugins) {
        $packageDll = Join-Path $package "addons/counterstrikesharp/plugins/$($plugin.Name)/$($plugin.Name).dll"
        $buildDll = Join-Path $repo "addons/counterstrikesharp/plugins/$($plugin.Name)/bin/Release/$($plugin.Framework)/$($plugin.Name).dll"
        if ((Test-Path -LiteralPath $packageDll) -and (Test-Path -LiteralPath $buildDll) -and
            ((Get-FileHash -LiteralPath $packageDll -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $buildDll -Algorithm SHA256).Hash)) {
            Add-Failure "Package $($plugin.Name) is not the current source build."
        }
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

Write-Host "Workspace verification passed."
Write-Host "Bot identities: $($counts['addons/BotHider/bot_info.json'])"
Write-Host "Weapon skins: $($counts['Panel/src/data/weaponSkins.json'])"
Write-Host "Glove skins: $($counts['Panel/src/data/gloveSkins.json'])"
Write-Host "Music kits: $($counts['Panel/src/data/musicKits.json'])"
if ($PackageRoot) { Write-Host "Package layout verified: $([IO.Path]::GetFullPath($PackageRoot))" }
