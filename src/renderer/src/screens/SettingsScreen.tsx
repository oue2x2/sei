/**
 * SettingsScreen — Account / Appearance sections (inline-editable).
 *
 * Account section reads from `sei.getConfig()` and `sei.hasApiKey()` on mount,
 * and persists changes inline:
 *  - mc_username / preferred_name → on-blur saveConfig (no debounce; commit
 *    only when focus leaves the field).
 *  - API key → "Update" button reveals a password TextField; Save calls
 *    sei.saveApiKey, then re-checks hasApiKey() and collapses the editor.
 *  - Provider stays read-only (only "anthropic" is valid in v1).
 *
 * Appearance section toggles light↔dark and persists `theme_mode` immediately.
 *
 * Source: 04-UI-SPEC.md §SettingsScreen + §Re-onboarding (replaced by inline
 * edit in quick task 260508-mun) + D-58.
 */

import React, { useEffect, useState } from 'react';
import { sei } from '../lib/ipcClient';
import { useUiStore } from '../lib/stores/useUiStore';
import { useWizardStore } from '../lib/stores/useWizardStore';
import { applyTheme, type ThemeMode } from '../lib/theme';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { StatusPill, type StatusPillTone } from '../components/StatusPill';
import { BackIcon, SunIcon, MoonIcon } from '../components/icons';
import type { UserConfig } from '@shared/characterSchema';
import type { McInstall, WizardState } from '@shared/ipc';
import styles from './SettingsScreen.module.css';

const API_KEY_BULLET_LEN = 24;

export function SettingsScreen(): React.ReactElement {
  const navigate = useUiStore((s) => s.navigate);
  const setThemeMode = useUiStore((s) => s.setThemeMode);
  const [cfg, setCfg] = useState<UserConfig | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' ? 'dark' : 'light';
  });

  // Inline edit buffers — typing only updates these; commit happens on blur.
  const [mcDraft, setMcDraft] = useState<string>('');
  const [preferredDraft, setPreferredDraft] = useState<string>('');
  const [editingKey, setEditingKey] = useState<boolean>(false);
  const [keyDraft, setKeyDraft] = useState<string>('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void sei.getConfig().then((c) => {
      setCfg(c);
      setMcDraft(c.mc_username ?? '');
      setPreferredDraft(c.preferred_name ?? '');
    });
    void sei.hasApiKey().then((b) => setHasKey(b));
  }, []);

  const persistConfig = async (next: UserConfig): Promise<void> => {
    try {
      await sei.saveConfig(next);
      setCfg(next);
      setSaveError(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SettingsScreen] saveConfig failed', err);
      setSaveError('Failed to save. Try again.');
    }
  };

  const onMcBlur = (): void => {
    if (!cfg) return;
    if ((cfg.mc_username ?? '') === mcDraft) return;
    void persistConfig({ ...cfg, mc_username: mcDraft });
  };

  const onPreferredBlur = (): void => {
    if (!cfg) return;
    if ((cfg.preferred_name ?? '') === preferredDraft) return;
    void persistConfig({ ...cfg, preferred_name: preferredDraft });
  };

  const onSaveKey = async (): Promise<void> => {
    const trimmed = keyDraft.trim();
    if (!trimmed) {
      setKeyError('API key cannot be empty.');
      return;
    }
    try {
      await sei.saveApiKey(trimmed);
      const has = await sei.hasApiKey();
      setHasKey(has);
      setKeyDraft('');
      setEditingKey(false);
      setKeyError(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SettingsScreen] saveApiKey failed', err);
      setKeyError('Failed to save key. Try again.');
    }
  };

  const onCancelKey = (): void => {
    setKeyDraft('');
    setEditingKey(false);
    setKeyError(null);
  };

  const toggleTheme = async (): Promise<void> => {
    const next: ThemeMode = resolvedTheme === 'light' ? 'dark' : 'light';
    setThemeMode(next);
    applyTheme(next);
    setResolvedTheme(next);
    if (cfg) {
      const updated: UserConfig = { ...cfg, theme_mode: next };
      try {
        await sei.saveConfig(updated);
        setCfg(updated);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[SettingsScreen] saveConfig (theme) failed', err);
      }
    }
  };

  const providerDisplay = (() => {
    const p = cfg?.provider ?? 'anthropic';
    return p.charAt(0).toUpperCase() + p.slice(1);
  })();

  return (
    <div className={styles.root}>
      <div className={styles.backRow}>
        <Button
          kind="quiet"
          size="sm"
          icon={<BackIcon size={14} />}
          onClick={() => navigate({ kind: 'home' })}
        >
          Back
        </Button>
      </div>
      <h1 className={styles.title}>Settings</h1>

      {saveError ? <div className={styles.errorRow}>{saveError}</div> : null}

      <section className={styles.section}>
        <div className={styles.sectionTitle}>ACCOUNT</div>

        <div className={styles.row} onBlur={onMcBlur}>
          <span className={styles.rowLabel}>Minecraft username</span>
          <span className={styles.rowEditor}>
            <TextField
              value={mcDraft}
              onChange={setMcDraft}
              monospace
              placeholder="—"
              aria-label="Minecraft username"
            />
          </span>
        </div>

        <div className={styles.row} onBlur={onPreferredBlur}>
          <span className={styles.rowLabel}>Preferred name</span>
          <span className={styles.rowEditor}>
            <TextField
              value={preferredDraft}
              onChange={setPreferredDraft}
              placeholder="—"
              aria-label="Preferred name"
            />
          </span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Provider</span>
          <span className={styles.rowValue}>{providerDisplay}</span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>API key</span>
          {editingKey ? (
            <span className={styles.rowEditor}>
              <TextField
                value={keyDraft}
                onChange={setKeyDraft}
                type="password"
                placeholder="sk-…"
                autoFocus
                onEnter={() => void onSaveKey()}
                aria-label="API key"
              />
              <Button kind="primary" size="sm" onClick={() => void onSaveKey()}>
                Save
              </Button>
              <Button kind="quiet" size="sm" onClick={onCancelKey}>
                Cancel
              </Button>
            </span>
          ) : (
            <span className={styles.rowEditor}>
              <span className={styles.rowMonoValue}>
                {hasKey ? '•'.repeat(API_KEY_BULLET_LEN) : 'Not set'}
              </span>
              <Button kind="ghost" size="sm" onClick={() => setEditingKey(true)}>
                {hasKey ? 'Update' : 'Set'}
              </Button>
            </span>
          )}
        </div>
        {keyError ? <div className={styles.errorRow}>{keyError}</div> : null}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>MINECRAFT SKINS SETUP</div>
        <SkinSetupRow />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>APPEARANCE</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Theme</span>
          <Button
            kind="ghost"
            size="sm"
            icon={resolvedTheme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
            onClick={toggleTheme}
          >
            {resolvedTheme === 'dark' ? 'Light' : 'Dark'}
          </Button>
        </div>
      </section>
    </div>
  );
}

/**
 * SkinSetupRow — Phase 9 plan 07 settings row.
 *
 * Shows the current state of the Minecraft skin setup wizard:
 *   - green pill + count when 1+ installs are enabled
 *   - warn pill when any enabled install has version drift / missing mod
 *   - muted "Not set up yet" when getWizardState().hasRunOnce === false
 *
 * "Re-run setup" button opens SetupWizardModal in re-entry mode (Back-to-settings
 * button visible on welcome step).
 */
function SkinSetupRow(): React.ReactElement {
  const openWizard = useWizardStore((s) => s.openWizard);
  const [state, setState] = useState<WizardState | null>(null);
  const [installs, setInstalls] = useState<McInstall[]>([]);

  useEffect(() => {
    let cancelled = false;
    void sei.getWizardState().then((s) => {
      if (!cancelled) setState(s);
    });
    void sei
      .detectMcInstalls()
      .then((r) => {
        if (!cancelled) setInstalls(r.installs);
      })
      .catch(() => {
        /* detection failure is non-fatal here — row falls back to "Not set up yet". */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = state?.enabledInstallIds.length ?? 0;
  // Mod-missing OR version-drift heuristic: an install Sei previously enabled
  // that the current scan reports as csl_installed=false is broken; flag.
  const driftCount = installs.filter(
    (i) => i.sei_enabled && !i.csl_installed,
  ).length;

  const tone: StatusPillTone =
    enabledCount > 0 ? (driftCount > 0 ? 'warn' : 'green') : 'muted';
  const label =
    enabledCount > 0
      ? `Sei enabled on ${enabledCount} install${enabledCount === 1 ? '' : 's'}`
      : 'Not set up yet';
  const secondary =
    driftCount > 0
      ? `${driftCount} install${driftCount === 1 ? '' : 's'} need${driftCount === 1 ? 's' : ''} update`
      : undefined;

  return (
    <div className={styles.row}>
      <span className={styles.rowEditor} style={{ justifyContent: 'flex-start' }}>
        <StatusPill tone={tone} label={label} secondary={secondary} />
      </span>
      <Button kind="quiet" size="md" onClick={() => openWizard(true)}>
        Re-run setup
      </Button>
    </div>
  );
}
