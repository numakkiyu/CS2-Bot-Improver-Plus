import namesByLanguage from "./skinNames.json";

type SkinNameTable = Record<string, Record<string, string>>;

const names = namesByLanguage as SkinNameTable;

export function localizedSkinName(
  language: string | null | undefined,
  weaponDefIndex: number,
  paint: number,
  fallback?: string
): string {
  const key = `${weaponDefIndex}:${paint}`;
  return names[language ?? "english"]?.[key]
    ?? names.english?.[key]
    ?? fallback
    ?? `Paint Kit ${paint}`;
}

export function finishName(fullName: string): string {
  const separator = fullName.indexOf("|");
  return separator >= 0 ? fullName.slice(separator + 1).trim() : fullName.trim();
}

export function itemName(fullName: string): string {
  const separator = fullName.indexOf("|");
  return separator >= 0 ? fullName.slice(0, separator).trim() : fullName.trim();
}
