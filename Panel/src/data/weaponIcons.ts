import imageRows from "./skinImages.json";
import catalogRows from "./weaponSkins.json";

type ImageRow = {
  weapon_defindex: number;
  weapon_name: string;
  paint: number | string;
  image: string;
};

type CatalogRow = { weapon_defindex: number; paint: number };

export type WeaponIcon = {
  id: number;
  designerName: string;
  name: string;
  url: string;
  availability: "ct" | "t" | "shared";
};

const CT_ONLY = new Set([3, 8, 10, 16, 27, 32, 34, 38, 60, 61]);
const T_ONLY = new Set([4, 7, 11, 13, 17, 29, 30, 39]);

export function weaponAvailability(defindex: number): WeaponIcon["availability"] {
  return CT_ONLY.has(defindex) ? "ct" : T_ONLY.has(defindex) ? "t" : "shared";
}

const DISPLAY_NAMES: Record<number, string> = {
  1: "Desert Eagle", 2: "Dual Berettas", 3: "Five-SeveN", 4: "Glock-18",
  7: "AK-47", 8: "AUG", 9: "AWP", 10: "FAMAS", 11: "G3SG1",
  13: "Galil AR", 14: "M249", 16: "M4A4", 17: "MAC-10", 19: "P90",
  23: "MP5-SD", 24: "UMP-45", 25: "XM1014", 26: "PP-Bizon",
  27: "MAG-7", 28: "Negev", 29: "Sawed-Off", 30: "Tec-9", 32: "P2000",
  33: "MP7", 34: "MP9", 35: "Nova", 36: "P250", 38: "SCAR-20",
  39: "SG 553", 40: "SSG 08", 60: "M4A1-S", 61: "USP-S",
  63: "CZ75-Auto", 64: "R8 Revolver",
};

const supported = new Set(
  (catalogRows as CatalogRow[])
    .filter((row) => row.weapon_defindex > 0 && row.weapon_defindex < 500 && row.paint > 0)
    .map((row) => row.weapon_defindex)
);

export const WEAPON_ICONS: WeaponIcon[] = (imageRows as ImageRow[])
  .filter((row) => Number(row.paint) === 0 && row.weapon_defindex < 500)
  .filter((row) => supported.has(row.weapon_defindex) && !!row.image)
  .map((row) => ({
    id: row.weapon_defindex,
    designerName: row.weapon_name,
    name: DISPLAY_NAMES[row.weapon_defindex]
      ?? row.weapon_name.replace(/^weapon_/, "").replaceAll("_", " ").toUpperCase(),
    url: row.image,
    availability: weaponAvailability(row.weapon_defindex),
  }))
  .sort((left, right) => left.id - right.id);
