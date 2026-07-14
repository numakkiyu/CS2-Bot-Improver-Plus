# Contributing to CS2BotImproverPlus

## Scope

CS2BotImproverPlus follows `ed0ard/CS2-Bot-Improver` as its upstream. Keep changes focused on the Plus feature set or
on compatibility with a current CS2 release. Avoid unrelated rewrites that make upstream synchronization harder.

## Development Rules

1. Do not commit `bin`, `obj`, `node_modules`, `dist`, `target`, downloaded release archives, or third-party native
   DLLs.
2. Add every visible Panel string to `Panel/src/i18n/keys.ts`. Add locale overrides in
   `Panel/src/i18n/dictionary.ts`; never hardcode a new UI sentence in a component.
3. Keep saved cosmetic data language-independent. Persist numeric item definition indexes, paint kits, seeds, wear,
   and flags, not translated display names.
4. Keep normal matchmaking isolated from Metamod and player cosmetics. Changes to mode switching require Rust tests.
5. Preserve the package's upstream-compatible `game/csgo` copy layout.

## Verification

```powershell
npm --prefix Panel ci
npm --prefix Panel run build
D:\dotnet-sdk-10\dotnet.exe build addons\counterstrikesharp\plugins\PlayerKnifeCustomizer\PlayerKnifeCustomizer.csproj -c Release
D:\dotnet-sdk-10\dotnet.exe build addons\counterstrikesharp\plugins\BotHiderImpl\BotHiderImpl.csproj -c Release
.\scripts\build.ps1 -DotNet D:\dotnet-sdk-10\dotnet.exe
.\scripts\verify-workspace.ps1
```

The Panel native build uses the Rust MSVC target through `cargo-xwin` and portable LLVM/Clang. `build.ps1` accepts
explicit `-Cargo`, `-Rustc`, `-LlvmBin`, and `-XwinCache` paths and keeps npm, NuGet, Cargo, xwin, and target caches
under the repository's ignored `.cache` or `Panel/src-tauri/target-msvc` directories. Visual Studio is not required.

Before publishing, run `scripts/package.ps1`, inspect the ZIP file list, verify `SHA256SUMS.txt`, and smoke-test both
Enhanced Bots and Online Mode on a disposable CS2 installation copy.
