[CmdletBinding()]
param(
    [string]$DotNet = "dotnet",
    [string]$Cargo = "cargo",
    [string]$Rustc = "rustc",
    [string]$RustToolchain,
    [string]$LlvmBin,
    [string]$XwinCache,
    [string]$OutputDirectory,
    [switch]$SkipBuild,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot "dependencies.json") -Raw | ConvertFrom-Json
. (Join-Path $PSScriptRoot "VpkTools.ps1")
$cache = Join-Path $repo ".cache\package"
$stage = Join-Path $cache "stage"
$extract = Join-Path $cache "extract"
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repo "artifacts" }

function Get-VerifiedAsset {
    param($Asset)
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $path = Join-Path $cache $Asset.name
    if (-not (Test-Path -LiteralPath $path)) {
        Invoke-WebRequest -Uri $Asset.url -OutFile $path
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Asset.sha256.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $($Asset.name): $actual"
    }
    return $path
}

function Copy-Tree {
    param([string]$Source, [string]$Destination)
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Expand-TarGz {
    param([string]$Archive, [string]$Destination)
    $tar = (Get-Command tar.exe -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    & $tar -xzf $Archive -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "Failed to extract $Archive" }
}

function Assert-ChildPath {
    param([string]$Parent, [string]$Child)
    $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $childPath = [IO.Path]::GetFullPath($Child)
    if (-not $childPath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the package cache: $childPath"
    }
}

if (-not $SkipBuild) {
    $buildArguments = @{
        DotNet = $DotNet
        Cargo = $Cargo
        Rustc = $Rustc
        SkipNpmInstall = $SkipNpmInstall
    }
    if ($RustToolchain) { $buildArguments.RustToolchain = $RustToolchain }
    if ($LlvmBin) { $buildArguments.LlvmBin = $LlvmBin }
    if ($XwinCache) { $buildArguments.XwinCache = $XwinCache }
    & (Join-Path $PSScriptRoot "build.ps1") @buildArguments
    if ($LASTEXITCODE -ne 0) { throw "Build failed." }
}

$upstreamZip = Get-VerifiedAsset $manifest.upstream.windowsAsset
$metamodZip = Get-VerifiedAsset $manifest.metamod.windowsAsset
$counterStrikeSharpZip = Get-VerifiedAsset $manifest.counterStrikeSharp.windowsAsset
$rayTraceCssArchive = Get-VerifiedAsset $manifest.rayTrace.cssAsset
$rayTraceWindowsArchive = Get-VerifiedAsset $manifest.rayTrace.windowsAsset
$botHiderZip = Get-VerifiedAsset $manifest.botHider.windowsAsset

Assert-ChildPath $cache $stage
Assert-ChildPath $cache $extract
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
New-Item -ItemType Directory -Path $stage,$extract -Force | Out-Null

$upstreamExtract = Join-Path $extract "upstream"
$metamodExtract = Join-Path $extract "metamod"
$counterStrikeSharpExtract = Join-Path $extract "counterstrikesharp"
$rayTraceCssExtract = Join-Path $extract "raytrace-css"
$rayTraceWindowsExtract = Join-Path $extract "raytrace-windows"
$botHiderExtract = Join-Path $extract "bothider"
Expand-Archive -LiteralPath $upstreamZip -DestinationPath $upstreamExtract
Expand-Archive -LiteralPath $metamodZip -DestinationPath $metamodExtract
Expand-Archive -LiteralPath $counterStrikeSharpZip -DestinationPath $counterStrikeSharpExtract
Expand-TarGz $rayTraceCssArchive $rayTraceCssExtract
Expand-TarGz $rayTraceWindowsArchive $rayTraceWindowsExtract
Expand-Archive -LiteralPath $botHiderZip -DestinationPath $botHiderExtract

$payloadCandidates = @((Get-Item -LiteralPath $upstreamExtract)) +
    @(Get-ChildItem -LiteralPath $upstreamExtract -Directory -Recurse)
$upstreamPayload = $payloadCandidates |
    Where-Object { (Test-Path (Join-Path $_.FullName "addons")) -and (Test-Path (Join-Path $_.FullName "cfg")) } |
    Select-Object -First 1
if (-not $upstreamPayload) { throw "Could not locate the upstream game/csgo payload." }

$releaseRoot = Join-Path $stage "CS2BotImproverPlus-v1.4.2-windows"
$payload = $releaseRoot
Copy-Tree $upstreamPayload.FullName $releaseRoot
Get-ChildItem -LiteralPath $releaseRoot -Filter "Panel*.exe" -File | Remove-Item -Force

# Never distribute gameinfo.gi from an older upstream release, including the
# manual Online/WithBots backups. The Plus Panel derives both variants from the
# installed game's current Steam-verified file when the user switches mode.
Get-ChildItem -LiteralPath $releaseRoot -Recurse -Filter "gameinfo.gi" -File |
    ForEach-Object {
        Assert-ChildPath $releaseRoot $_.FullName
        Remove-Item -LiteralPath $_.FullName -Force
    }

# Upstream botprofile VPKs also contain stale localization files. Current CS2
# loads those files ahead of its own resources, breaking player-name formatting.
# Keep only BotProfile.db; difficulty behavior remains byte-for-byte unchanged.
$botProfileVpks = @(Get-ChildItem -LiteralPath (Join-Path $payload "overrides") `
    -Filter "botprofile.vpk" -File -Recurse)
if ($botProfileVpks.Count -eq 0) {
    throw "The upstream payload contains no botprofile VPKs."
}
foreach ($botProfileVpk in $botProfileVpks) {
    ConvertTo-BotProfileOnlyVpk $botProfileVpk.FullName
}

$metamodAddons = Join-Path $metamodExtract "addons"
if (-not (Test-Path -LiteralPath $metamodAddons)) { throw "Metamod archive has no addons payload." }
Copy-Tree $metamodAddons (Join-Path $payload "addons")

$counterStrikeSharpAddons = Join-Path $counterStrikeSharpExtract "addons"
if (-not (Test-Path -LiteralPath $counterStrikeSharpAddons)) { throw "CounterStrikeSharp archive has no addons payload." }
Copy-Tree $counterStrikeSharpAddons (Join-Path $payload "addons")

$rayTraceCssRoot = Get-ChildItem -LiteralPath $rayTraceCssExtract -Directory -Recurse |
    Where-Object { Test-Path (Join-Path $_.FullName "counterstrikesharp\plugins\RayTraceImpl") } |
    Select-Object -First 1
if (-not $rayTraceCssRoot) { throw "Could not locate the RayTrace CounterStrikeSharp payload." }
Copy-Tree (Join-Path $rayTraceCssRoot.FullName "counterstrikesharp") (Join-Path $payload "addons\counterstrikesharp")

$rayTraceNativeCandidates = @((Get-Item -LiteralPath $rayTraceWindowsExtract)) +
    @(Get-ChildItem -LiteralPath $rayTraceWindowsExtract -Directory -Recurse)
$rayTraceNativeRoot = $rayTraceNativeCandidates |
    Where-Object { (Test-Path (Join-Path $_.FullName "RayTrace\bin\win64\RayTrace.dll")) -and
        (Test-Path (Join-Path $_.FullName "metamod\RayTrace.vdf")) } |
    Select-Object -First 1
if (-not $rayTraceNativeRoot) { throw "Could not locate the native RayTrace payload." }
Copy-Tree (Join-Path $rayTraceNativeRoot.FullName "RayTrace") (Join-Path $payload "addons\RayTrace")
Copy-Item -LiteralPath (Join-Path $rayTraceNativeRoot.FullName "metamod\RayTrace.vdf") `
    -Destination (Join-Path $payload "addons\metamod\RayTrace.vdf") -Force

$botHiderAddons = Get-ChildItem -LiteralPath $botHiderExtract -Directory -Recurse |
    Where-Object { $_.Name -eq "addons" -and (Test-Path (Join-Path $_.FullName "BotHider")) } |
    Select-Object -First 1
if (-not $botHiderAddons) { throw "Could not locate BotHider addons payload." }
Copy-Tree $botHiderAddons.FullName (Join-Path $payload "addons")
$linuxBotHiderVdf = Join-Path $payload "addons\metamod\BotHider.linux.vdf"
if (Test-Path -LiteralPath $linuxBotHiderVdf) {
    Remove-Item -LiteralPath $linuxBotHiderVdf -Force
}

# Plus configuration overlays. Source files are deliberately not copied into the release payload.
Copy-Item -LiteralPath (Join-Path $repo "addons\BotHider\bot_info.json") -Destination (Join-Path $payload "addons\BotHider\bot_info.json") -Force
Copy-Item -LiteralPath (Join-Path $repo "addons\BotHider\gamedata.json") -Destination (Join-Path $payload "addons\BotHider\gamedata.json") -Force
Copy-Item -LiteralPath (Join-Path $repo "addons\BotHider\map_whitelist.json") -Destination (Join-Path $payload "addons\BotHider\map_whitelist.json") -Force
Copy-Item -LiteralPath (Join-Path $repo "addons\metamod\BotHider.vdf") -Destination (Join-Path $payload "addons\metamod\BotHider.vdf") -Force
Copy-Item -LiteralPath (Join-Path $repo "cfg\my_bot_ffa_config.cfg") -Destination (Join-Path $payload "cfg\my_bot_ffa_config.cfg") -Force
Copy-Item -LiteralPath (Join-Path $repo "cfg\my_bot_normal_config.cfg") -Destination (Join-Path $payload "cfg\my_bot_normal_config.cfg") -Force

$pluginBuild = Join-Path $repo "addons\counterstrikesharp\plugins\PlayerKnifeCustomizer\bin\Release\net10.0"
$botImplBuild = Join-Path $repo "addons\counterstrikesharp\plugins\BotHiderImpl\bin\Release\net10.0"
$botApiBuild = Join-Path $repo "addons\counterstrikesharp\shared\BotHiderApi\bin\Release\net10.0"
$upstreamPluginBuilds = @(
    @{ Name = "BotAI"; Framework = "net8.0" },
    @{ Name = "BotAimImprover"; Framework = "net10.0" },
    @{ Name = "BotBuy"; Framework = "net8.0" },
    @{ Name = "NadeSystem"; Framework = "net10.0" }
)
foreach ($plugin in $upstreamPluginBuilds) {
    $build = Join-Path $repo "addons\counterstrikesharp\plugins\$($plugin.Name)\bin\Release\$($plugin.Framework)"
    if (-not (Test-Path -LiteralPath (Join-Path $build "$($plugin.Name).dll"))) {
        throw "Expected upstream plugin build output was not produced: $build"
    }
    Copy-Tree $build (Join-Path $payload "addons\counterstrikesharp\plugins\$($plugin.Name)")
}
Copy-Tree $pluginBuild (Join-Path $payload "addons\counterstrikesharp\plugins\PlayerKnifeCustomizer")
Copy-Tree $botImplBuild (Join-Path $payload "addons\counterstrikesharp\plugins\BotHiderImpl")
Copy-Tree $botApiBuild (Join-Path $payload "addons\counterstrikesharp\shared\BotHiderApi")

# BotHiderImpl resolves Harmony from CounterStrikeSharp's shared library directory.
# The build target stages it below the plugin output so packaging can remain
# independent of the machine-wide NuGet cache.
$harmonyBuild = Join-Path $botImplBuild "shared\0Harmony\0Harmony.dll"
if (-not (Test-Path -LiteralPath $harmonyBuild)) {
    throw "Expected Harmony build output was not produced: $harmonyBuild"
}
$sharedHarmony = Join-Path $payload "addons\counterstrikesharp\shared\0Harmony"
New-Item -ItemType Directory -Path $sharedHarmony -Force | Out-Null
Copy-Item -LiteralPath $harmonyBuild -Destination (Join-Path $sharedHarmony "0Harmony.dll") -Force
$nestedShared = Join-Path $payload "addons\counterstrikesharp\plugins\BotHiderImpl\shared"
if (Test-Path -LiteralPath $nestedShared) {
    Assert-ChildPath $payload $nestedShared
    Remove-Item -LiteralPath $nestedShared -Recurse -Force
}

$nativeDll = Join-Path $payload "addons\BotHider\bin\win64\BotHider.dll"
$nativeHash = (Get-FileHash -LiteralPath $nativeDll -Algorithm SHA256).Hash.ToLowerInvariant()
if ($nativeHash -ne $manifest.botHider.windowsDllSha256.ToLowerInvariant()) {
    throw "Unexpected BotHider.dll SHA-256: $nativeHash"
}

$panelExe = Join-Path $repo "Panel\src-tauri\target\release\cs2-bot-improver-plus-panel.exe"
Copy-Item -LiteralPath $panelExe -Destination (Join-Path $releaseRoot "CS2BotImproverPlus v1.4.2.exe") -Force
$webViewLoader = Join-Path $repo "Panel\src-tauri\target\release\WebView2Loader.dll"
if (Test-Path -LiteralPath $webViewLoader) {
    Copy-Item -LiteralPath $webViewLoader -Destination (Join-Path $releaseRoot "WebView2Loader.dll") -Force
}
Copy-Item -LiteralPath (Join-Path $repo "README.md") -Destination (Join-Path $releaseRoot "README.md") -Force
Copy-Item -LiteralPath (Join-Path $repo "README.zh-CN.md") -Destination (Join-Path $releaseRoot "README.zh-CN.md") -Force
Copy-Item -LiteralPath (Join-Path $repo "LICENSE") -Destination (Join-Path $releaseRoot "LICENSE") -Force

& (Join-Path $PSScriptRoot "verify-workspace.ps1") -PackageRoot $releaseRoot
if ($LASTEXITCODE -ne 0) { throw "Package verification failed." }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$zip = Join-Path $OutputDirectory "CS2BotImproverPlus-v1.4.2-windows.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $releaseRoot -DestinationPath $zip -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$sums = Join-Path $OutputDirectory "SHA256SUMS.txt"
Set-Content -LiteralPath $sums -Value "$hash  $([IO.Path]::GetFileName($zip))" -Encoding ascii

Write-Host "Package complete: $zip"
Write-Host "SHA-256: $hash"
