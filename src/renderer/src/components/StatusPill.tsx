/**
 * StatusPill — 8px-square dot + uppercase label primitive with optional mono secondary caption.
 *
 * Extracted from the inline patterns in LanModal.headerEyebrow + CharacterPage.modelRow
 * to a shared primitive Plan 06 consumes today (SkinEditor empty-states, "Default skin"
 * badge adjacency, future status indicators) and Plan 07's setup wizard will reuse for
 * MC-install rows and the wizard "Setup complete" panel.
 *
 * Source: 09-UI-SPEC.md §"Status dot system (D-22 family, extended)" — the 5-state
 * dot/label matrix (green / red / warn / muted / pulse-in-flight).
 *
 * Visual contract:
 *   - 8px square dots, sharp corners (D-28 — NO border-radius)
 *   - Label is rendered as-is (caller controls casing). UI-SPEC says uppercase but
 *     we don't text-transform here so the component is callsite-truthful.
 *   - Optional mono secondary caption underneath the primary label, --text-2.
 *   - Tone 'pulse' is the in-flight (Installing… / Detecting… / Searching skin…) state:
 *     --text-2 dot with a 1.4s opacity pulse; the animation is disabled under
 *     `prefers-reduced-motion: reduce`.
 *
 * a11y:
 *   - The colored dot is `aria-hidden` because the textual label carries the meaning;
 *     status pills must never convey information by color alone (UI-SPEC §Accessibility).
 */

import React from 'react';
import styles from './StatusPill.module.css';

export type StatusPillTone = 'green' | 'red' | 'warn' | 'muted' | 'pulse';

export interface StatusPillProps {
  tone: StatusPillTone;
  /** Primary text. Caller controls uppercasing — component does not text-transform. */
  label: string;
  /** Optional mono caption under the label (e.g. version string, path). */
  secondary?: string;
  className?: string;
}

function cls(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ');
}

export function StatusPill({
  tone,
  label,
  secondary,
  className,
}: StatusPillProps): React.ReactElement {
  return (
    <div className={cls(styles.pill, className)}>
      <span className={cls(styles.dot, styles['dot_' + tone])} aria-hidden="true" />
      <span className={styles.labels}>
        <span className={styles.label}>{label}</span>
        {secondary ? <span className={styles.secondary}>{secondary}</span> : null}
      </span>
    </div>
  );
}
