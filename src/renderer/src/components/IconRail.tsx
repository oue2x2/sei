/**
 * IconRail / Sidebar — 72px wide sidebar.
 *
 * Top→bottom (D-34): Home → divider → Minecraft (MCBlock, always active) →
 * Add game (Plus) → flex-spacer → Theme toggle → Settings.
 *
 * NO "Sei" wordmark in the rail (D-34 — user removed iteration 5).
 *
 * Source: 04-UI-SPEC.md §Component Inventory → IconRail/Sidebar.
 */

import React from 'react';
import styles from './IconRail.module.css';
import {
  HomeIcon,
  PlusIcon,
  SettingsIcon,
} from './icons';
import { useUiStore } from '../lib/stores/useUiStore';
const minecraftIcon = './img/minecraft.png';

interface RailButtonProps {
  active?: boolean;
  onClick?: () => void;
  title?: string;
  badge?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}

function RailButton({
  active,
  onClick,
  title,
  badge,
  muted,
  children,
}: RailButtonProps): React.ReactElement {
  const cls = [
    styles.railButton,
    active ? styles.active : '',
    muted ? styles.muted : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button onClick={onClick} title={title} className={cls} type="button">
      {active && <span className={styles.activeBar} aria-hidden="true" />}
      {children}
      {badge && <span className={styles.badge} aria-hidden="true" />}
    </button>
  );
}

export function IconRail(): React.ReactElement {
  const view = useUiStore((s) => s.view);
  const navigate = useUiStore((s) => s.navigate);

  const homeActive =
    view.kind === 'home' || view.kind === 'character' || view.kind === 'add-character';

  return (
    <nav className={styles.rail} aria-label="Primary">
      <div className={styles.cluster}>
        <RailButton
          active={homeActive}
          onClick={() => navigate({ kind: 'home' })}
          title="Home"
        >
          <HomeIcon size={30} />
        </RailButton>
      </div>

      <div className={styles.divider} />

      <div className={styles.cluster}>
        {/* Minecraft — always active (only registered game). */}
        <RailButton active title="Minecraft">
          <img
            src={minecraftIcon}
            alt="Minecraft"
            width={34}
            height={34}
            style={{ imageRendering: 'pixelated', display: 'block' }}
          />
        </RailButton>
        <RailButton
          muted
          title="Add game"
          onClick={() => navigate({ kind: 'coming-soon' })}
        >
          <PlusIcon size={26} />
        </RailButton>
      </div>

      <div className={styles.spacer} />

      <div className={styles.cluster}>
        <RailButton
          active={view.kind === 'settings'}
          onClick={() => navigate({ kind: 'settings' })}
          title="Settings"
        >
          <SettingsIcon size={28} />
        </RailButton>
      </div>
    </nav>
  );
}
