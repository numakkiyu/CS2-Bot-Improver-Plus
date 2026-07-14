import rows from "./musicKits.json";

export type MusicKit = {
  def_index: number;
  name_en: string;
  name_zh: string;
  image: string;
};

export const MUSIC_KITS = rows as MusicKit[];

export function musicKitName(kit: MusicKit, language?: string | null) {
  return language === "schinese" || language === "tchinese" ? kit.name_zh : kit.name_en;
}
