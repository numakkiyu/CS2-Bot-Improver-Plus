[CmdletBinding()]
param(
    [string]$DotNet = "dotnet",
    [string]$Cargo = "cargo",
    [string]$Rustc = "rustc",
    [string]$RustToolchain = "stable-x86_64-pc-windows-msvc",
    [string]$LlvmBin,
    [string]$XwinCache,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$panel = Join-Path $repo "Panel"
$cache = Join-Path $repo ".cache"
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot "dependencies.json") -Raw | ConvertFrom-Json

function Invoke-Checked {
    param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory = $repo)
    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-VerifiedAsset {
    param($Asset, [string]$DestinationDirectory)
    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    $path = Join-Path $DestinationDirectory $Asset.name
    if (-not (Test-Path -LiteralPath $path)) {
        Invoke-WebRequest -Uri $Asset.url -OutFile $path
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Asset.sha256.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $($Asset.name): $actual"
    }
    return $path
}

function Get-RayTraceApi {
    $inputs = Join-Path $cache "build-inputs\raytrace-$($manifest.rayTrace.release)"
    $archive = Get-VerifiedAsset $manifest.rayTrace.cssAsset $inputs
    $extract = Join-Path $inputs "extract"
    $dll = Get-ChildItem -LiteralPath $extract -Filter "RayTraceApi.dll" -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '[\\/]shared[\\/]RayTraceApi[\\/]' } |
        Select-Object -First 1
    if (-not $dll) {
        if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
        New-Item -ItemType Directory -Path $extract -Force | Out-Null
        $tar = (Get-Command tar.exe -ErrorAction Stop).Source
        & $tar -xzf $archive -C $extract
        if ($LASTEXITCODE -ne 0) { throw "Failed to extract $archive" }
        $dll = Get-ChildItem -LiteralPath $extract -Filter "RayTraceApi.dll" -File -Recurse |
            Where-Object { $_.FullName -match '[\\/]shared[\\/]RayTraceApi[\\/]' } |
            Select-Object -First 1
    }
    if (-not $dll) { throw "Pinned RayTraceApi.dll was not found in $archive" }
    return $dll.FullName
}

$cargo = (Get-Command $Cargo -ErrorAction Stop).Source
$rustc = (Get-Command $Rustc -ErrorAction Stop).Source

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)?.Source
if (-not $npm) { $npm = (Get-Command npm -ErrorAction Stop).Source }

$environmentNames = @(
    "CARGO_HOME",
    "CARGO_TARGET_DIR",
    "DOTNET_CLI_HOME",
    "NUGET_HTTP_CACHE_PATH",
    "NUGET_PACKAGES",
    "npm_config_cache",
    "PATH",
    "RC",
    "RUSTC",
    "RUSTUP_TOOLCHAIN",
    "XWIN_CACHE_DIR"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $env:CARGO_HOME = Join-Path $cache "cargo-home"
    $env:CARGO_TARGET_DIR = Join-Path $panel "src-tauri\target"
    $env:DOTNET_CLI_HOME = Join-Path $cache "dotnet-home"
    $env:NUGET_HTTP_CACHE_PATH = Join-Path $cache "nuget\http"
    $env:NUGET_PACKAGES = Join-Path $cache "nuget\packages"
    $env:npm_config_cache = Join-Path $cache "npm"
    $env:RUSTC = $rustc
    $env:RUSTUP_TOOLCHAIN = $RustToolchain

    if (-not $LlvmBin) { $LlvmBin = Join-Path $cache "toolchains\llvm\bin" }
    if (-not $XwinCache) { $XwinCache = Join-Path $cache "xwin" }
    $clang = Join-Path $LlvmBin "clang-cl.exe"
    $linker = Join-Path $LlvmBin "lld-link.exe"
    $resourceCompiler = Join-Path $LlvmBin "llvm-rc.exe"
    foreach ($tool in @($clang, $linker, $resourceCompiler)) {
        if (-not (Test-Path -LiteralPath $tool)) {
            throw "Portable LLVM tool not found: $tool"
        }
    }
    $cargoXwin = Join-Path $env:CARGO_HOME "bin\cargo-xwin.exe"
    if (-not (Test-Path -LiteralPath $cargoXwin)) {
        throw "cargo-xwin is not installed in the project cache: $cargoXwin"
    }

    $env:XWIN_CACHE_DIR = $XwinCache
    $env:RC = $resourceCompiler
    $rustTarget = "x86_64-pc-windows-msvc"
    $targetDirectory = Join-Path $panel "src-tauri\target-msvc"
    $env:CARGO_TARGET_DIR = $targetDirectory
    $toolPaths = @((Split-Path $cargo), (Split-Path $rustc), $LlvmBin, (Split-Path $cargoXwin)) | Select-Object -Unique
    $env:PATH = ($toolPaths -join ";") + ";" + $env:PATH

    if (-not $SkipNpmInstall) {
        Invoke-Checked $npm @("ci") $panel
    }
    Invoke-Checked $npm @("run", "build") $panel

    $rayTraceApi = Get-RayTraceApi
    $pluginProjects = @(
        @{ Path = "addons\counterstrikesharp\plugins\BotAI\BotAI.csproj"; Properties = @() },
        @{ Path = "addons\counterstrikesharp\plugins\BotAimImprover\BotAimImprover.csproj"; Properties = @("-p:RayTraceApiPath=$rayTraceApi") },
        @{ Path = "addons\counterstrikesharp\plugins\BotBuy\BotBuy.csproj"; Properties = @() },
        @{ Path = "addons\counterstrikesharp\plugins\NadeSystem\NadeSystem.csproj"; Properties = @("-p:RayTraceApiPath=$rayTraceApi") },
        @{ Path = "addons\counterstrikesharp\plugins\PlayerKnifeCustomizer\PlayerKnifeCustomizer.csproj"; Properties = @() },
        @{ Path = "addons\counterstrikesharp\plugins\BotHiderImpl\BotHiderImpl.csproj"; Properties = @() }
    )
    foreach ($project in $pluginProjects) {
        Invoke-Checked $DotNet (@("build", $project.Path, "-c", "Release", "--nologo") + $project.Properties)
    }
    Invoke-Checked $DotNet @(
        "run", "--project", "addons\counterstrikesharp\plugins\PlayerKnifeCustomizer.Tests\PlayerKnifeCustomizer.Tests.csproj",
        "-c", "Release", "--no-restore"
    )

    $tauriSource = Join-Path $panel "src-tauri"
    Invoke-Checked $cargo @(
        "xwin", "test", "--target", $rustTarget, "--locked", "--no-run",
        "--target-dir", $targetDirectory
    ) $tauriSource

    $testRoot = Join-Path $targetDirectory "$rustTarget\debug\deps"
    $testExecutables = @(Get-ChildItem -LiteralPath $testRoot -File -Filter "cs2_bot_improver_plus_panel*.exe")
    if ($testExecutables.Count -eq 0) {
        throw "No Panel test executables were produced under $testRoot"
    }
    foreach ($test in $testExecutables) {
        Invoke-Checked $test.FullName @("--nocapture") $tauriSource
    }

    Invoke-Checked $cargo @(
        "xwin", "build", "--target", $rustTarget, "--release", "--locked",
        "--features", "tauri/custom-protocol", "--target-dir", $targetDirectory
    ) $tauriSource

    $builtExe = Join-Path $targetDirectory "$rustTarget\release\cs2-bot-improver-plus-panel.exe"
    if (-not (Test-Path -LiteralPath $builtExe)) {
        throw "Expected MSVC Panel executable was not produced: $builtExe"
    }
    $releaseBuildRoot = Join-Path $targetDirectory "$rustTarget\release\build"
    $tauriBuildOutput = Get-ChildItem -LiteralPath $releaseBuildRoot -Directory |
        Where-Object { $_.Name -match '^tauri-[0-9a-f]+$' } |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName "output" } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if (-not $tauriBuildOutput -or
        -not (Get-Content -LiteralPath $tauriBuildOutput -Raw).Contains("cargo:dev=false")) {
        throw "Release Panel was not compiled with Tauri's production custom protocol."
    }
    $appBuildOutput = Get-ChildItem -LiteralPath $releaseBuildRoot -Directory |
        Where-Object { $_.Name -match '^cs2-bot-improver-plus-panel-[0-9a-f]+$' } |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName "output" } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if (-not $appBuildOutput -or
        (Get-Content -LiteralPath $appBuildOutput -Raw).Contains("cargo:rustc-cfg=dev")) {
        throw "Release Panel application still uses Tauri's development URL."
    }
    $canonicalRelease = Join-Path $panel "src-tauri\target\release"
    New-Item -ItemType Directory -Path $canonicalRelease -Force | Out-Null
    Copy-Item -LiteralPath $builtExe -Destination (Join-Path $canonicalRelease "cs2-bot-improver-plus-panel.exe") -Force
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}

$exe = Join-Path $panel "src-tauri\target\release\cs2-bot-improver-plus-panel.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Expected Panel executable was not produced: $exe"
}

Write-Host "Build complete: $exe"
