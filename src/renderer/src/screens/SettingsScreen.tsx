/**
 * SettingsScreen — Account / Appearance / Setup sections.
 *
 * Source: 04-UI-SPEC.md §SettingsScreen + §Re-onboarding; D-58.
 *
 * Account section reads from `sei.getConfig()` and `sei.hasApiKey()` on mount.
 * API key is shown as bullet placeholders only — never reveal plaintext.
 *
 * Appearance section toggles light↔dark and persists `theme_mode` immediately
 * via `sei.saveConfig({...current, theme_mode})`. The display button label and
 * icon track the *resolved* theme (read from `data-theme` attribute) so 'system'
 * mode reflects the actual rendering.
 *
 * Setup section's "Start over" navigates to onboarding in `isReonboard=true`
 * mode.
 */

import React, { useEffect, useState } from 'react';
import { sei } from '../lib/ipcClient';
import { useUiStore } from '../lib/stores/useUiStore';
import { applyTheme, type ThemeMode } from '../lib/theme';
import { Button } from '../components/Button';
import { BackIcon, SunIcon, MoonIcon } from '../components/icons';
import type { UserConfig } from '@shared/characterSchema';
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

  useEffect(() => {
    void sei.getConfig().then((c) => setCfg(c));
    void sei.hasApiKey().then((b) => setHasKey(b));
  }, []);

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
        // Plan 09 will replace with ERROR_COPY mapping; for v1 we log.
        // eslint-disable-next-line no-console
        console.error('[SettingsScreen] saveConfig failed', err);
      }
    }
  };

  const providerDisplay = (() => {
    const p = cfg?.provider ?? 'anthropic';
    return p.charAt(0).toUpperCase() + p.slice(1);
  })();

  return (
    <div className={styles.root}>
      <Button
        kind="quiet"
        size="sm"
        icon={<BackIcon size={14} />}
        onClick={() => navigate({ kind: 'home' })}
      >
        Back
      </Button>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>ACCOUNT</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Minecraft username</span>
          <span className={styles.rowMonoValue}>{cfg?.mc_username || '—'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Preferred name</span>
          <span className={styles.rowValue}>{cfg?.preferred_name || '—'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Provider</span>
          <span className={styles.rowValue}>{providerDisplay}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>API key</span>
          <span className={styles.rowMonoValue}>
            {hasKey ? '•'.repeat(API_KEY_BULLET_LEN) : 'Not set'}
          </span>
        </div>
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

      <section className={styles.section}>
        <div className={styles.sectionTitle}>SETUP</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Re-run onboarding</span>
          <Button
            kind="primary"
            size="sm"
            onClick={() => navigate({ kind: 'onboarding', isReonboard: true })}
          >
            Start over
          </Button>
        </div>
      </section>
    </div>
  );
}
