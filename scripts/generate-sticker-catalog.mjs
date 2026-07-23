import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const commit = "342d49698a77ca5d2da69c4ecd236358c866a364";
const base = `https://raw.githubusercontent.com/ByMykel/CSGO-API/${commit}/public/api`;
const mirrorBase = `https://cdn.jsdelivr.net/gh/ByMykel/CSGO-API@${commit}/public/api`;
const gameTrackingCommit = "88d56841a2a4effc0aa7478cccb8981e56a3f006";
const itemsGameUrl = `https://raw.githubusercontent.com/SteamTracking/GameTracking-CS2/${gameTrackingCommit}/game/csgo/pak01_dir/scripts/items/items_game.txt`;
const itemsGameMirrorUrl = `https://cdn.jsdelivr.net/gh/SteamTracking/GameTracking-CS2@${gameTrackingCommit}/game/csgo/pak01_dir/scripts/items/items_game.txt`;
const supportedWeaponIds = [1, 2, 3, 4, 7, 8, 9, 10, 11, 13, 14, 16, 17, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 60, 61, 63, 64];

async function fetchBytes(urls, label) {
  let lastError;
  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        lastError = new Error(`${url}: ${error?.message ?? error}`);
        if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1000));
      }
    }
  }
  throw new Error(`Failed to fetch ${label}: ${lastError?.message ?? lastError}`);
}

async function fetchJson(language) {
  const bytes = await fetchBytes(
    [`${base}/${language}/stickers.json`, `${mirrorBase}/${language}/stickers.json`],
    `${language} sticker catalog`,
  );
  return { rows: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) };
}

async function fetchItemsGame() {
  const bytes = await fetchBytes([itemsGameUrl, itemsGameMirrorUrl], "GameTracking items_game.txt");
  const text = bytes.toString("utf8");
  const capability = text.indexOf('"weapon_supports_stickers"');
  if (capability < 0 || !text.slice(capability, capability + 600).includes('"can_sticker"') ||
      !text.slice(capability, capability + 600).includes('"stickers"\t\t"weapon"'))
    throw new Error("GameTracking no longer declares the expected sticker capability prefab");
  for (const prefab of ["secondary", "primary", "weapon_taser_prefab"]) {
    const match = new RegExp(`"${prefab}"\\s*\\{[\\s\\S]{0,1800}?"prefab"\\s*"[^"]*weapon_supports_stickers`).exec(text);
    if (!match) throw new Error(`GameTracking ${prefab} no longer inherits weapon_supports_stickers`);
  }
  return { sha256: sha256(bytes) };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const [english, chinese, itemsGame] = await Promise.all([fetchJson("en"), fetchJson("zh-CN"), fetchItemsGame()]);
const chineseById = new Map(chinese.rows.map((row) => [Number(row.def_index), row]));
const seen = new Set();
const catalog = english.rows
  .map((row) => {
    const id = Number(row.def_index);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return null;
    seen.add(id);
    const localized = chineseById.get(id);
    return {
      id,
      name_en: row.name || `Sticker ${id}`,
      name_zh_cn: localized?.name || row.name || `Sticker ${id}`,
      image: row.image || "",
      effect: row.effect || "Other",
      rarity_color: row.rarity?.color || "#ded6cc",
    };
  })
  .filter(Boolean)
  .sort((left, right) => left.id - right.id);

if (catalog.length < 1000) throw new Error(`Sticker catalog is unexpectedly small: ${catalog.length}`);

const panelBytes = Buffer.from(`${JSON.stringify(catalog)}\n`, "utf8");
const idsBytes = Buffer.from(`${JSON.stringify(catalog.map(({ id }) => ({ id })))}\n`, "utf8");
const weaponIdsBytes = Buffer.from(`${JSON.stringify(supportedWeaponIds.map((id) => ({ id })))}\n`, "utf8");
const source = {
  schema_version: 1,
  repository: "ByMykel/CSGO-API",
  commit,
  capabilities: {
    repository: "SteamTracking/GameTracking-CS2",
    commit: gameTrackingCommit,
    items_game_sha256: itemsGame.sha256,
    supported_weapon_count: supportedWeaponIds.length,
  },
  inputs: {
    en_sha256: english.sha256,
    zh_cn_sha256: chinese.sha256,
  },
  outputs: {
    count: catalog.length,
    panel_sha256: sha256(panelBytes),
    plugin_ids_sha256: sha256(idsBytes),
    weapon_ids_sha256: sha256(weaponIdsBytes),
  },
};

await Promise.all([
  writeFile(resolve("Panel/src/data/stickerCatalog.json"), panelBytes),
  writeFile(resolve("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/sticker_ids.json"), idsBytes),
  writeFile(resolve("Panel/src/data/stickerWeaponIds.json"), weaponIdsBytes),
  writeFile(resolve("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/sticker_weapon_ids.json"), weaponIdsBytes),
  writeFile(resolve("Panel/src/data/stickerCatalog.source.json"), `${JSON.stringify(source, null, 2)}\n`, "utf8"),
]);

console.log(`Generated ${catalog.length} stickers from ${commit}.`);
