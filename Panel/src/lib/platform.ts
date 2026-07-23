import { listen as tauriListen } from "@tauri-apps/api/event";
import { writeText as tauriWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { open as tauriOpen, save as tauriSave } from "@tauri-apps/plugin-dialog";
import { openPath as tauriOpenPath, openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { isPanelTauriRuntime } from "./runtime";

export const BROWSER_DEMO_CSGO_PATH = "C:\\CS2 Browser Demo\\game\\csgo";

export async function openDialog(options: Parameters<typeof tauriOpen>[0]) {
  if (isPanelTauriRuntime) return tauriOpen(options);
  if (options?.directory) return BROWSER_DEMO_CSGO_PATH;
  return "C:\\CS2 Browser Demo\\cs2bip-cosmetics-preset.json";
}

export async function saveDialog(options: Parameters<typeof tauriSave>[0]) {
  if (isPanelTauriRuntime) return tauriSave(options);
  const name = options?.defaultPath?.split(/[\\/]/).pop() || "cs2bip-preview.json";
  return `C:\\CS2 Browser Demo\\${name}`;
}

export async function writeClipboard(text: string) {
  if (isPanelTauriRuntime) return tauriWriteText(text);
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export async function openExternalUrl(url: string) {
  if (isPanelTauriRuntime) return tauriOpenUrl(url);
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openExternalPath(path: string) {
  if (isPanelTauriRuntime) return tauriOpenPath(path);
  console.info(`[browser-demo] open path: ${path}`);
}

export function listenAppEvent<T>(name: string, handler: (event: { payload: T }) => void) {
  if (isPanelTauriRuntime) {
    return tauriListen<T>(name, (event) => handler({ payload: event.payload }));
  }
  const eventName = `cs2bi:${name}`;
  const listener = (event: Event) => handler({ payload: (event as CustomEvent<T>).detail });
  window.addEventListener(eventName, listener);
  return Promise.resolve(() => window.removeEventListener(eventName, listener));
}

export function dispatchBrowserEvent<T>(name: string, payload: T) {
  if (!isPanelTauriRuntime) {
    window.dispatchEvent(new CustomEvent(`cs2bi:${name}`, { detail: payload }));
  }
}
