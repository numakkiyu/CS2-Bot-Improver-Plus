import rows from "./stickerCatalog.json";

export type StickerCatalogEntry = {
  id: number;
  name_en: string;
  name_zh_cn: string;
  image: string;
  effect: string;
  rarity_color: string;
};

export const STICKERS = rows as StickerCatalogEntry[];

export function stickerName(entry: StickerCatalogEntry, language?: string | null) {
  return language === "schinese" ? entry.name_zh_cn : entry.name_en;
}
