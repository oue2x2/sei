/**
 * LogsBar — collapsible bottom log strip for the app shell.
 *
 * Collapsed (default): a thin (~30px) bar showing the LOGS label, a preview
 * of the latest log line (truncated to one line), and a chevron-up. Click
 * anywhere on the bar to expand.
 *
 * Expanded: bar header (chevron-down) + a constrained-height LogsPanel
 * (~280px) below it. Click the header to collapse.
 *
 * Tokens follow the existing surface/border/mono palette so the bar matches
 * LogsPanel and the wallpaper. Sharp corners (D-28).
 *
 * Source: quick task 260508-mun item 5.
 */

import React, { useState } from 'react';
import { useDataStore } from '../lib/stores/useDataStore';
import { LogsPanel } from './LogsPanel';
import styles from './LogsBar.module.css';

const PANEL_HEIGHT_PX = 280;

export function LogsBar(): React.ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  // Subscribe only to the last log message preview when collapsed; the
  // expanded LogsPanel does its own subscription. The selector returns a
  // primitive string so equality checks are cheap.
  const preview = useDataStore((s) =>
    s.logs.length > 0 ? s.logs[s.logs.length - 1].message : '',
  );

  return (
    <div className={open ? styles.rootOpen : styles.root}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Collapse console' : 'Expand console'}
      >
        <span className={styles.label}>CONSOLE</span>
        {!open ? (
          <span className={styles.preview} title={preview}>
            {preview || '—'}
          </span>
        ) : (
          <span className={styles.previewSpacer} />
        )}
        <span className={styles.chevron} aria-hidden="true">
          {open ? '▾' : '▴'}
        </span>
      </button>
      {open ? (
        <div className={styles.panelWrap} style={{ height: PANEL_HEIGHT_PX }}>
          <LogsPanel />
        </div>
      ) : null}
    </div>
  );
}
