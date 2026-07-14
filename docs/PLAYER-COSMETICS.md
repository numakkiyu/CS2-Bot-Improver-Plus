# Player Cosmetics

## Supported Presets

- Knife type and paint kit
- Glove type and paint kit
- Gun paint kits for catalogued purchasable weapons
- Wear and pattern seed
- Name tag
- StatTrak enablement and initial/current count where supported
- Souvenir state where supported
- Music kit

The Panel filters choices by weapon defindex and catalog compatibility. Doppler and Gamma Doppler variants remain
separate paint-kit entries, so phase-specific variants are not collapsed into a generic label.

## Runtime Model

The Panel writes JSON under the installed `PlayerKnifeCustomizer` plugin directory. The assembly/folder name is kept
for copy-over upgrade compatibility; the module is displayed as `PlayerCosmetics` in CounterStrikeSharp.

The plugin applies presets at bounded game events:

- human player spawn;
- `GiveNamedItem` completion for purchases and grants;
- item pickup;
- dropped knife entity creation;
- round MVP for the configured music kit.

There is no periodic held-weapon listener and no always-on-top in-game overlay.

## Language Independence

Configuration stores defindexes, paint kits, floats, integers, booleans, and name-tag text. Localized names are only
used by the Panel search and display layer. Switching Steam accounts or Panel languages does not invalidate a preset;
the same local practice installation applies it to eligible human players.

## Matchmaking Isolation

When Online Mode is selected, the backend records whether player cosmetics were enabled, disables them, verifies that
the online `gameinfo.gi` does not load Metamod, and launches without `-insecure` or bot arguments. Returning to
Enhanced Bots restores the previous enablement state and leaves all preset values intact.

This is a defense-in-depth workflow, not a promise about Valve policy. Do not load unsigned server modifications in a
VAC-secured session.
