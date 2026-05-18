/**
 * UpdateToast — bottom-right "A new version of Sei is available" notification.
 * Persists until dismissed; clicking the action opens the download URL.
 */
import React from 'react';

export interface UpdateToastProps {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  onDismiss: () => void;
}

export function UpdateToast({
  currentVersion,
  latestVersion,
  downloadUrl,
  onDismiss,
}: UpdateToastProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1000,
        background: 'var(--text)',
        color: 'var(--window)',
        padding: '12px 14px',
        boxShadow: 'var(--shadow-pop, 0 8px 24px rgba(0,0,0,0.3))',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: 320,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600 }}>Update available</div>
      <div style={{ opacity: 0.8 }}>
        v{latestVersion} is out — you're on v{currentVersion}.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            color: 'var(--window)',
            textDecoration: 'underline',
            fontWeight: 500,
          }}
          onClick={onDismiss}
        >
          Download
        </a>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            color: 'var(--window)',
            border: '1px solid currentColor',
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
