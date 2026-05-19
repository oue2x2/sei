/**
 * IPC contract between main, preload, and renderer.
 *
 * Single source of truth: every ipcMain.handle (in src/main/ipc.ts) and every
 * ipcRenderer.invoke (in src/preload/index.ts) imports channel names from
 * `IpcChannel` below. Method signatures imported as `RendererApi`.
 *
 * Sources:
 *   - CONTEXT D-17 (RendererApi shape)
 *   - CONTEXT D-19 (BotLifecycle vocabulary)
 *   - CONTEXT D-22 (LanState variants)
 *   - PATTERNS §src/shared/ipc.ts
 *   - RESEARCH §Pattern 2 (contextBridge contract)
 *   - UI-SPEC §Defaults (channel naming)
 */

import type { Character, Skin, SkinSource, UserConfig } from './characterSchema';
import type { ErrorClass } from './errorClasses';
export type { ErrorClass } from './errorClasses';

/* -------------------------------------------------------------------------- */
/*  Lifecycle / status / log domain types                                     */
/* -------------------------------------------------------------------------- */

export type Unsubscribe = () => void;

/** Renderer-facing bot status surface (used by CharacterPage model row). */
export type BotStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'online'; uptimeMs: number; characterId: string }
  | { kind: 'error'; error: ErrorClass; message: string; characterId: string };

/** Renderer-facing LAN watcher status (used by HomeScreen pill + LAN modal). */
export type LanState =
  | { kind: 'connected'; port: number; motd: string; lastSeenAt: number }
  | { kind: 'not_connected' }
  | { kind: 'unavailable' };

/**
 * Startup warnings reported by main on first boot (one-shot query).
 * `keychainFallbackPlaintext` is true when running on Linux with the
 * `basic_text` safeStorage backend (no kwallet/libsecret available) —
 * surfaces as a top-of-window Banner per RESEARCH §Pitfall 3.
 */
export interface StartupWarnings {
  keychainFallbackPlaintext: boolean;
}

/** Single log line forwarded from utilityProcess stdout/stderr → main → renderer. */
export interface LogEntry {
  timestamp: string;             // ISO; main attaches this when it tees the line
  tag: string | null;            // e.g. "[chat<-]", "[haiku!]"; null when no prefix matches
  message: string;               // raw line text including any prefix
  level: 'info' | 'warn' | 'error';
}

/** Batched log delivery (Pitfall 7 — main coalesces ~50ms / 100 lines per batch). */
export interface LogBatch {
  entries: LogEntry[];
  dropped?: number;              // sentinel when backpressure clipped lines
}

/**
 * Internal main↔utilityProcess MessagePort message vocabulary.
 * Renderer never sees these directly — main translates to BotStatus.
 */
export type BotLifecycle =
  | { type: 'init-ack' }
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: ErrorClass; message: string }
  | { type: 'chat'; from: string; text: string }
  | { type: 'summon-ready' }
  | { type: 'summon-stopped' }
  | { type: 'exit'; code: number | null };

/* -------------------------------------------------------------------------- */
/*  Skin pipeline + setup-wizard domain types                                  */
/* -------------------------------------------------------------------------- */

/**
 * A detected Minecraft installation surfaced to the wizard.
 * Source: CONTEXT.md §decisions "Cross-platform paths" + "First-launch wizard scope".
 *
 * Zod-schema asymmetry (260518-o1k T2): the `kind` and `compatibility`
 * fields below ride the main→renderer push channel as plain TS objects;
 * inbound IPC zod-validation in `src/main/ipc.ts` only gates
 * `runWizardInstall` args (sessionId/installIds/skinServerBaseUrl) and
 * `wizardCancel` args (sessionId). The widened McInstall / Wizard*Event
 * unions therefore require NO zod schema changes — they are pure TS
 * contracts. Documented here so a future security pass doesn't conclude
 * the validation step was skipped.
 */
export interface McInstall {
  /** Stable hash of `${kind}:${absolutePath}` — durable across re-detects on the same machine. */
  id: string;
  kind: 'vanilla' | 'curseforge' | 'lunar';
  /** e.g. "Vanilla Launcher" or "Pixelmon · 1.20.1" or "Lunar Client" */
  label: string;
  /** Absolute on-disk path — game dir for vanilla, instance dir for CurseForge. */
  path: string;
  mc_version: string | null;
  loader: 'fabric' | 'forge' | null;
  loader_version: string | null;
  csl_installed: boolean;
  csl_version: string | null;
  /** True when persisted wizard state previously enabled Sei here. */
  sei_enabled: boolean;
  /**
   * Functional compatibility marker (260518-o1k D3).
   *   - `full`    — wizard can install Fabric + CSL here (vanilla, curseforge).
   *   - `limited` — read-only listing; wizard does NOT install (Lunar Client
   *                 has no user-accessible mods/ — surfaced for UX
   *                 transparency only).
   * Required field; scanners set it on every emission.
   */
  compatibility: 'full' | 'limited';
}

/** Per-install install result returned from runWizardInstall. */
export interface WizardInstallResult {
  installId: string;
  ok: boolean;
  error?: ErrorClass;
  message?: string;
  installedFabricVersion?: string;
  installedCslVersion?: string;
  /**
   * Vanilla-only (260518-o1k T6). Summary of the mod-link pass that ran
   * between the Fabric install and the CSL config write. Absent for
   * curseforge / lunar installs.
   */
  modLinkSummary?: {
    linked: number;
    excluded: number;
    linkedJars: { sourceName: string; strategy: 'link' | 'symlink' | 'copy' }[];
    excludedJars: {
      name: string;
      reason: 'mc-version-mismatch' | 'unparseable' | 'no-metadata' | 'read-error';
      declaredMc?: string;
    }[];
  };
}

/** Persisted wizard state at <userData>/skin-setup-state.json. */
export interface WizardState {
  version: 1;
  hasRunOnce: boolean;
  enabledInstallIds: string[];
  lastRunAt: string | null;
  lastSkinServerPort: number | null;
}

/** Push events emitted while runWizardInstall is in flight. */
export type WizardProgressEvent =
  | { installId: string; stage: 'queued' }
  | { installId: string; stage: 'fabric-downloading'; pct: number }
  | { installId: string; stage: 'fabric-installing' }
  /**
   * 260518-o1k T2: vanilla-only stage that runs between Fabric install and
   * CSL download. `totalEstimate` is null until the orchestrator has
   * `readdir`'d the source mods/ directory; after that it's the count of
   * candidate JARs. `scanned/linked/excluded` are monotonic running counts.
   */
  | {
      installId: string;
      stage: 'mods-linking';
      scanned: number;
      linked: number;
      excluded: number;
      totalEstimate: number | null;
    }
  | { installId: string; stage: 'mod-downloading'; pct: number }
  | { installId: string; stage: 'mod-placing' }
  | { installId: string; stage: 'config-writing' }
  | { installId: string; stage: 'done' }
  | { installId: string; stage: 'failed'; error: ErrorClass; message: string }
  | { installId: string; stage: 'cancelled' };

/* -------------------------------------------------------------------------- */
/*  Preload-exposed RendererApi                                                */
/* -------------------------------------------------------------------------- */

/**
 * The shape of `window.sei` in renderer code.
 * Preload (src/preload/index.ts) uses `contextBridge.exposeInMainWorld('sei', api)`
 * with `api: RendererApi`. Main registers ipcMain.handle for every request/response method.
 */
export interface RendererApi {
  // Bot supervision (request/response with timeouts — main enforces)
  summon(characterId: string): Promise<void>;
  stop(): Promise<void>;

  // Character CRUD
  listCharacters(): Promise<Character[]>;
  getCharacter(id: string): Promise<Character | null>;
  // 260516-0yw: saveCharacter now returns the persisted Character so the
  // renderer can pick up the LLM-generated persona.expanded after main
  // ran the expansion call.
  // 260517-frz: optional { skipExpansion } lets the renderer hand main a
  // manually-edited persona.expanded and skip the LLM regeneration. When
  // omitted/false, main regenerates expanded from persona.source as before.
  saveCharacter(
    character: Character,
    options?: { skipExpansion?: boolean },
  ): Promise<Character>;
  deleteCharacter(id: string): Promise<void>;
  resetMemory(id: string): Promise<void>;

  // User config + secret
  getConfig(): Promise<UserConfig>;
  saveConfig(config: UserConfig): Promise<void>;
  saveApiKey(plaintext: string): Promise<void>;
  hasApiKey(): Promise<boolean>;

  // App-level one-shot queries
  getStartupWarnings(): Promise<StartupWarnings>;

  // --- Skin pipeline ---
  /**
   * Apply an already-validated PNG (from upload or Mojang search) as the persona's skin, AND
   * update the persona's per-persona MC username, atomically (single saveCharacter call).
   * `username` is the per-persona MC in-game name; pass null/undefined to leave the existing value untouched.
   * Pass an empty string to clear it (falls back to sanitized persona name).
   * The main process writes the PNG to <userData>/skins/<id>.png and updates the character's skin descriptor + username in one saveCharacter call.
   */
  applySkin(args: { characterId: string; pngBase64: string; source: SkinSource; mojangUsername?: string | null; username?: string | null }): Promise<{ skin: Skin; username: string | null }>;
  /** Reset the persona to its bundled default skin (or 'none' for user-created personas). */
  removeSkin(characterId: string): Promise<{ skin: Skin }>;
  /** Open native file dialog, validate dimensions (64×64), and return base64 + sha256 for renderer-side preview + applySkin. */
  uploadSkinPng(): Promise<{ pngBase64: string; sha256: string } | null>;
  /** Resolve Mojang username -> UUID -> texture URL -> PNG bytes. 15s timeout. Normalizes legacy 64×32 skins to 64×64 before returning. */
  searchMojangSkin(username: string): Promise<{ pngBase64: string; sha256: string; resolvedUsername: string }>;
  /** Returns the loopback URL prefix that CustomSkinLoader is configured against (e.g. 'http://127.0.0.1:54321'). */
  getSkinServerUrl(): Promise<{ baseUrl: string }>;

  // --- Setup wizard ---
  /** Scan known Minecraft launcher + CurseForge paths on the current platform. */
  detectMcInstalls(): Promise<{ installs: McInstall[] }>;
  /**
   * Install Fabric Loader (vanilla) and/or drop CustomSkinLoader into each selected install. Emits progress via onWizardProgress.
   * `sessionId` is a renderer-generated opaque id (e.g. crypto.randomUUID()) that lets a subsequent wizardCancel(sessionId) abort THIS install run.
   */
  runWizardInstall(args: { sessionId: string; installIds: string[]; skinServerBaseUrl: string }): Promise<{ results: WizardInstallResult[] }>;
  /**
   * Abort an in-flight runWizardInstall by sessionId. Main holds a Map<sessionId, AbortController>;
   * this resolves immediately after firing .abort() — the in-flight runWizardInstall promise then rejects.
   */
  wizardCancel(sessionId: string): Promise<void>;
  /** Returns the persisted wizard state (which installs are enabled, last setup timestamp, last skin server port). */
  getWizardState(): Promise<WizardState>;

  // Push subscriptions — return Unsubscribe (renderer cleans up on unmount)
  onStatus(cb: (status: BotStatus) => void): Unsubscribe;
  onLog(cb: (batch: LogBatch) => void): Unsubscribe;
  onLan(cb: (state: LanState) => void): Unsubscribe;
  /** Subscribe to per-install progress events during runWizardInstall. */
  onWizardProgress(cb: (ev: WizardProgressEvent) => void): Unsubscribe;
  /** Fires once at startup (delayed) if sei.gg/version.json reports a newer version. */
  onUpdateAvailable(cb: (info: UpdateAvailableEvent) => void): Unsubscribe;
}

/** Payload pushed by main when an update is detected on sei.gg. */
export interface UpdateAvailableEvent {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  notes?: string;
}

/* -------------------------------------------------------------------------- */
/*  IPC channel string constants — single source of truth for both sides       */
/* -------------------------------------------------------------------------- */

export const IpcChannel = {
  bot: {
    summon: 'bot:summon',
    stop: 'bot:stop',
    status: 'bot:status',
    logBatch: 'bot:log:batch',
  },
  lan: {
    state: 'lan:state',
  },
  chars: {
    list: 'chars:list',
    get: 'chars:get',
    save: 'chars:save',
    delete: 'chars:delete',
    resetMemory: 'chars:reset-memory',
  },
  config: {
    get: 'config:get',
    save: 'config:save',
    saveApiKey: 'config:save-api-key',
    hasApiKey: 'config:has-api-key',
  },
  app: {
    ready: 'app:ready',
    warnings: 'app:warnings',
    updateAvailable: 'app:update-available',
  },
  // Skin pipeline.
  skin: {
    apply: 'skin:apply',
    remove: 'skin:remove',
    uploadPng: 'skin:upload-png',
    searchMojang: 'skin:search-mojang',
    getServerUrl: 'skin:get-server-url',
  },
  // Setup wizard. `cancel` crosses the IPC boundary to abort an in-flight
  // install — a renderer-local AbortController cannot reach the main-process
  // child running `java -jar fabric-installer`.
  // `progress` is a push channel (main → renderer) for per-install progress events.
  wizard: {
    detectInstalls: 'wizard:detect-installs',
    install: 'wizard:install',
    cancel: 'wizard:cancel',
    getState: 'wizard:get-state',
    progress: 'wizard:progress',
  },
} as const;

export type IpcChannelName =
  | typeof IpcChannel.bot[keyof typeof IpcChannel.bot]
  | typeof IpcChannel.lan[keyof typeof IpcChannel.lan]
  | typeof IpcChannel.chars[keyof typeof IpcChannel.chars]
  | typeof IpcChannel.config[keyof typeof IpcChannel.config]
  | typeof IpcChannel.app[keyof typeof IpcChannel.app]
  | typeof IpcChannel.skin[keyof typeof IpcChannel.skin]
  | typeof IpcChannel.wizard[keyof typeof IpcChannel.wizard];
