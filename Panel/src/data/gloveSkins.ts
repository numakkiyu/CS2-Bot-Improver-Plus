export type GloveSkin = {
  defindex: number;
  model: string;
  paint: number;
  name: string;
  image: string;
  minWear: number;
  maxWear: number;
};

const GLOVE_MODEL_NAMES: Record<number, { english: string; schinese: string; tchinese: string }> = {
  4725: { english: "Broken Fang Gloves", schinese: "狂牙手套", tchinese: "狂牙手套" },
  5027: { english: "Bloodhound Gloves", schinese: "血猎手套", tchinese: "血獵手套" },
  5030: { english: "Sport Gloves", schinese: "运动手套", tchinese: "運動手套" },
  5031: { english: "Driver Gloves", schinese: "驾驶手套", tchinese: "駕駛手套" },
  5032: { english: "Hand Wraps", schinese: "裹手", tchinese: "裹手" },
  5033: { english: "Moto Gloves", schinese: "摩托手套", tchinese: "摩托手套" },
  5034: { english: "Specialist Gloves", schinese: "专业手套", tchinese: "專業手套" },
  5035: { english: "Hydra Gloves", schinese: "九头蛇手套", tchinese: "九頭蛇手套" },
};

export function gloveModelName(language: string | null | undefined, defindex: number): string {
  const names = GLOVE_MODEL_NAMES[defindex];
  if (!names) return `#${defindex}`;
  return language === "schinese" ? names.schinese : language === "tchinese" ? names.tchinese : names.english;
}

export { default } from "./gloveSkins.json";
