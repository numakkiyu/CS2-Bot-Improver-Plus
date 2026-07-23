import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  toAppError,
  type AppConfig,
  type AppError,
  type AimValue,
  type BotItemKey,
  type BotItemsState,
  type DifficultyInfo,
  type DifficultyLevel,
  type DirectoryInfo,
  type Cs2ProcessInfo,
  type DropKnivesState,
  type FilesReport,
  type GameMode,
  type ModeInfo,
  type NadesValue,
  type PresetsState,
  type InstallationInspection,
  type InstallPlan,
  type InstallTransactionResult,
  type RestoreResult,
  type DiagnosticReport,
} from "../lib/api";

type Store = {
  ready: boolean;
  config: AppConfig | null;
  directory: DirectoryInfo | null;
  process: Cs2ProcessInfo | null;
  installation: InstallationInspection | null;
  files: FilesReport | null;
  difficulty: DifficultyInfo | null;
  mode: ModeInfo | null;
  botItems: BotItemsState | null;
  presets: PresetsState | null;
  /** Per-section "changed while CS2 running, pending restart" flags. Persisted,
   *  so each yellow light survives a full close/reopen of the panel. */
  aimPending: boolean;
  nadesPending: boolean;
  modePending: boolean;
  difficultyPending: boolean;
  dropKnivesPending: boolean;
  /** Per Bot Item "changed while CS2 running, pending restart" flags — each
   *  toggle has its own yellow light; the panel's header light is yellow if any
   *  one of them is. */
  botItemsPending: Record<BotItemKey, boolean>;
  dropKnives: DropKnivesState | null;
  csgoPath: string | null;
  /** Last global error (for the error modal). */
  error: AppError | null;
  clearError: () => void;
  reportError: (e: unknown) => void;
  refreshDirectory: () => Promise<DirectoryInfo | null>;
  refreshFiles: () => Promise<void>;
  refreshDifficulty: () => Promise<void>;
  refreshAll: (silent?: boolean) => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<boolean>;
  chooseDirectory: (path: string) => Promise<void>;
  getInstallPlan: () => Promise<InstallPlan | null>;
  verifyInstallation: () => Promise<InstallationInspection | null>;
  installPayload: () => Promise<InstallTransactionResult | null>;
  repairPayload: () => Promise<InstallTransactionResult | null>;
  restorePayload: () => Promise<RestoreResult | null>;
  restorePristineCs2: () => Promise<RestoreResult | null>;
  exportDiagnostics: () => Promise<DiagnosticReport | null>;
  applyDifficulty: (level: DifficultyLevel) => Promise<DifficultyInfo | null>;
  applyMode: (mode: GameMode) => Promise<ModeInfo | null>;
  applyBotItem: (item: BotItemKey, on: boolean) => Promise<BotItemsState | null>;
  applyAim: (value: AimValue) => Promise<PresetsState | null>;
  applyNades: (value: NadesValue) => Promise<PresetsState | null>;
  applyDropKnives: (
    bindKey: string,
    selected: number[]
  ) => Promise<DropKnivesState | null>;
};

/** A boolean flag persisted in localStorage so it survives a full close/reopen
 *  of the panel (used for the per-section "changed while CS2 running" lights). */
function usePersistedFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => localStorage.getItem(key) === "1");
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* localStorage unavailable — fall back to in-memory only */
      }
    },
    [key]
  );
  return [value, set];
}

const BOT_ITEM_KEYS: BotItemKey[] = ["skins", "profiles", "agents", "music"];

function emptyBotItemFlags(): Record<BotItemKey, boolean> {
  return { skins: false, profiles: false, agents: false, music: false };
}

/** Like usePersistedFlag, but a per-key map (one yellow light per Bot Item)
 *  stored as a single JSON entry so all four survive a close/reopen together. */
function usePersistedFlagMap(
  key: string
): [
  Record<BotItemKey, boolean>,
  (item: BotItemKey, v: boolean) => void,
  () => void
] {
  const [map, setMap] = useState<Record<BotItemKey, boolean>>(() => {
    const base = emptyBotItemFlags();
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      for (const k of BOT_ITEM_KEYS) if (raw[k] === true) base[k] = true;
    } catch {
      /* missing or legacy value — start all-false */
    }
    return base;
  });
  const persist = useCallback(
    (next: Record<BotItemKey, boolean>) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* localStorage unavailable — in-memory only */
      }
    },
    [key]
  );
  const setOne = useCallback(
    (item: BotItemKey, v: boolean) =>
      setMap((prev) => {
        const next = { ...prev, [item]: v };
        persist(next);
        return next;
      }),
    [persist]
  );
  const clearAll = useCallback(() => {
    const next = emptyBotItemFlags();
    persist(next);
    setMap(next);
  }, [persist]);
  return [map, setOne, clearAll];
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used within AppStateProvider");
  return s;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [directory, setDirectory] = useState<DirectoryInfo | null>(null);
  const [process, setProcess] = useState<Cs2ProcessInfo | null>(null);
  const [installation, setInstallation] = useState<InstallationInspection | null>(null);
  const [files, setFiles] = useState<FilesReport | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyInfo | null>(null);
  const [mode, setMode] = useState<ModeInfo | null>(null);
  const [botItems, setBotItems] = useState<BotItemsState | null>(null);
  const [presets, setPresets] = useState<PresetsState | null>(null);
  // Per-section "changed while CS2 running, pending restart" flags. Persisted in
  // localStorage so each light survives a full close/reopen of the panel while
  // CS2 keeps running (the boot refreshAll clears them once CS2 is not running).
  const [aimPending, setAimPending] = usePersistedFlag("cs2bi.aimPending");
  const [nadesPending, setNadesPending] = usePersistedFlag("cs2bi.nadesPending");
  const [modePending, setModePending] = usePersistedFlag("cs2bi.modePending");
  const [difficultyPending, setDifficultyPending] = usePersistedFlag("cs2bi.difficultyPending");
  const [dropKnivesPending, setDropKnivesPending] =
    usePersistedFlag("cs2bi.dropKnivesPending");
  const [botItemsPending, setBotItemPending, clearBotItemsPending] =
    usePersistedFlagMap("cs2bi.botItemsPending");
  const [dropKnives, setDropKnives] = useState<DropKnivesState | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  configRef.current = config;

  const reportError = useCallback((e: unknown) => {
    const normalized = toAppError(e);
    setError(normalized);
    void api.recordPanelError(normalized, window.location.pathname).catch(() => {});
  }, []);
  const clearError = useCallback(() => setError(null), []);

  const refreshFiles = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) {
      setFiles(null);
      return;
    }
    try {
      setFiles(await api.validateFiles(csgo));
    } catch (e) {
      setFiles(null);
      reportError(e);
    }
  }, [directory, reportError]);

  const refreshDifficulty = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) {
      setDifficulty(null);
      return;
    }
    try {
      setDifficulty(await api.getDifficulty(csgo));
    } catch (e) {
      setDifficulty(null);
      reportError(e);
    }
  }, [directory, reportError]);

  const applyDifficulty = useCallback(
    async (level: DifficultyLevel) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setDifficulty(csgo, level);
        setDifficulty(info);
        setDifficultyPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyDropKnives = useCallback(
    async (bindKey: string, selected: number[]) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setDropKnives(csgo, bindKey, selected);
        setDropKnives(info);
        setDropKnivesPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyAim = useCallback(
    async (value: AimValue) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setAim(csgo, value);
        setPresets(info);
        // Yellow (pending restart) only if the change was made while running.
        setAimPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyNades = useCallback(
    async (value: NadesValue) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setNades(csgo, value);
        setPresets(info);
        setNadesPending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyBotItem = useCallback(
    async (item: BotItemKey, on: boolean) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setBotItem(csgo, item, on);
        setBotItems(info);
        // Only this item's light goes yellow, and only if changed while running.
        setBotItemPending(item, info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const applyMode = useCallback(
    async (m: GameMode) => {
      const csgo = directory?.valid ? directory.selected : null;
      if (!csgo) return null;
      try {
        const info = await api.setMode(csgo, m);
        setMode(info);
        setModePending(info.cs2_running);
        return info;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [directory, reportError]
  );

  const refreshDirectory = useCallback(async () => {
    try {
      const info = await api.detectDirectories();
      setDirectory(info);
      return info;
    } catch (e) {
      reportError(e);
      return null;
    }
  }, [reportError]);

  const refreshAll = useCallback(async (silent = false) => {
    try {
      const snapshot = await api.getRuntimeSnapshot();
      setDirectory(snapshot.directory);
      setProcess(snapshot.process);
      setInstallation(snapshot.installation);
      setFiles(snapshot.files);
      setDifficulty(snapshot.difficulty);
      setMode(snapshot.mode);
      setBotItems(snapshot.bot_items);
      setPresets(snapshot.presets);
      setDropKnives(snapshot.drop_knives);

      if (!snapshot.process.running) {
        setAimPending(false);
        setNadesPending(false);
        setModePending(false);
        setDifficultyPending(false);
        clearBotItemsPending();
        setDropKnivesPending(false);
      }
    } catch (e) {
      // A background refresh keeps the last good snapshot and retries later.
      if (silent) return;
      setDirectory(null);
      setProcess(null);
      setInstallation(null);
      setFiles(null);
      setDifficulty(null);
      setMode(null);
      setBotItems(null);
      setPresets(null);
      setDropKnives(null);
      setAimPending(false);
      setNadesPending(false);
      setModePending(false);
      setDifficultyPending(false);
      clearBotItemsPending();
      setDropKnivesPending(false);
      reportError(e);
    }
  }, [clearBotItemsPending, reportError, setAimPending, setDifficultyPending,
    setDropKnivesPending, setModePending, setNadesPending]);

  const updateConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      const base = configRef.current;
      if (!base) return false;
      const next = { ...base, ...patch };
      setConfig(next);
      try {
        await api.saveConfig(next);
        return true;
      } catch (e) {
        setConfig(base);
        reportError(e);
        return false;
      }
    },
    [reportError]
  );

  const chooseDirectory = useCallback(
    async (path: string) => {
      try {
        await api.selectDirectory(path);
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    },
    [refreshAll, reportError]
  );

  const getInstallPlan = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) return null;
    try { return await api.getInstallPlan(csgo); }
    catch (e) { reportError(e); return null; }
  }, [directory, reportError]);

  const verifyInstallation = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) return null;
    try {
      const [inspection, report] = await Promise.all([
        api.inspectInstallation(csgo),
        api.validateFiles(csgo),
      ]);
      setInstallation(inspection);
      setFiles(report);
      return inspection;
    } catch (e) {
      reportError(e);
      return null;
    }
  }, [directory, reportError]);

  const runInstallAction = useCallback(async (action: "install" | "repair") => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) return null;
    try {
      const result = action === "install" ? await api.installPayload(csgo) : await api.repairPayload(csgo);
      await refreshAll();
      return result;
    } catch (e) { reportError(e); return null; }
  }, [directory, refreshAll, reportError]);

  const installPayload = useCallback(() => runInstallAction("install"), [runInstallAction]);
  const repairPayload = useCallback(() => runInstallAction("repair"), [runInstallAction]);

  const restorePayload = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) return null;
    try {
      const result = await api.restorePayload(csgo);
      await refreshAll();
      return result;
    } catch (e) { reportError(e); return null; }
  }, [directory, refreshAll, reportError]);

  const restorePristineCs2 = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    if (!csgo) return null;
    try {
      const result = await api.restorePristineCs2(csgo);
      await refreshAll();
      return result;
    } catch (e) { reportError(e); return null; }
  }, [directory, refreshAll, reportError]);

  const exportDiagnostics = useCallback(async () => {
    const csgo = directory?.valid ? directory.selected : null;
    try { return await api.exportDiagnostics(csgo); }
    catch (e) { reportError(e); return null; }
  }, [directory, reportError]);

  // Global safety net: surface any unexpected error/rejection as a modal so the
  // UI never fails silently.
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      if (e.error) reportError(e.error);
    };
    const onRej = (e: PromiseRejectionEvent) => reportError(e.reason);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, [reportError]);

  // Boot: load config then detect dir + validate files.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        setConfig(cfg);
      } catch (e) {
        reportError(e);
      }
      // Enforce the launch-option rule: disk follows the remembered -insecure.
      try {
        await api.reconcileLaunchOptions();
      } catch (e) {
        reportError(e);
      }
      const info = await refreshDirectory();
      const csgo = info?.valid ? info.selected : null;
      if (csgo) {
        try {
          await api.cleanupBackups(csgo);
        } catch {
          /* best-effort cleanup of legacy .bak files */
        }
        try {
          // Bring CounterStrikeSharp's core.json FollowCS2ServerGuidelines in
          // line with the current Skins state on every launch.
          await api.reconcileCoreJson(csgo);
        } catch {
          /* best-effort: core.json / core.example.json may be absent */
        }
      }
      await refreshAll();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: one consolidated backend snapshot every two seconds keeps all
  // indicator lights and buttons reflect the current on-disk / CS2-running state
  // without the user reopening the panel. Silent (never pops an error modal),
  // non-overlapping (skips a tick if the previous scan is still in flight), and
  // paused while the window is hidden/minimized to avoid needless work.
  const pollingRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        await refreshAll(true);
      } finally {
        pollingRef.current = false;
      }
    };
    const id = window.setInterval(tick, 2000);
    const onFocus = () => { void tick(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, refreshAll]);

  // Keep every panel-owned local preference mirrored beside the executable.
  // The backend write only runs when the serialized state actually changes.
  useEffect(() => {
    if (!ready) return;
    let last = "";
    const sync = () => {
      const entries: Record<string, string> = {};
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith("cs2bi.")) continue;
        const value = localStorage.getItem(key);
        if (value !== null) entries[key] = value;
      }
      const serialized = JSON.stringify(entries);
      if (serialized === last) return;
      last = serialized;
      void api.savePanelMemory(entries).catch((error) => {
        void api.recordPanelError(toAppError(error), "panel-memory-sync").catch(() => {});
      });
    };
    sync();
    const id = window.setInterval(sync, 1000);
    return () => window.clearInterval(id);
  }, [ready]);

  const value: Store = {
    ready,
    config,
    directory,
    process,
    installation,
    files,
    difficulty,
    mode,
    botItems,
    presets,
    aimPending,
    nadesPending,
    modePending,
    difficultyPending,
    dropKnivesPending,
    botItemsPending,
    dropKnives,
    csgoPath: directory?.valid ? directory.selected : null,
    error,
    clearError,
    reportError,
    refreshDirectory,
    refreshFiles,
    refreshDifficulty,
    refreshAll,
    updateConfig,
    chooseDirectory,
    getInstallPlan,
    verifyInstallation,
    installPayload,
    repairPayload,
    restorePayload,
    restorePristineCs2,
    exportDiagnostics,
    applyDifficulty,
    applyMode,
    applyBotItem,
    applyAim,
    applyNades,
    applyDropKnives,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
