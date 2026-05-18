/**
 * PortraitImagePicker — small image-upload control used by both
 * EditCharacterModal and AddCharacterScreen. Stores the image inline as a
 * base64 data URL in `character.portrait_image` so no main-side IPC is needed.
 *
 * Caps the encoded payload at ~512KB so very large user images don't blow the
 * character JSON file. Above that, the user gets an inline error.
 */
import React, { useRef } from 'react';

const MAX_DATA_URL_BYTES = 512 * 1024;

export interface PortraitImagePickerProps {
  value: string | null;
  onChange: (next: string | null) => void;
}

export function PortraitImagePicker({
  value,
  onChange,
}: PortraitImagePickerProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onPick = (): void => {
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file (PNG/JPG).');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ''));
      r.onerror = () => reject(r.error ?? new Error('read failed'));
      r.readAsDataURL(file);
    });
    if (dataUrl.length > MAX_DATA_URL_BYTES) {
      setError('Image too large (max ~512KB after encoding).');
      return;
    }
    onChange(dataUrl);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {value ? (
        <img
          src={value}
          alt="Card image preview"
          style={{
            width: 56,
            height: 56,
            objectFit: 'cover',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px dashed var(--border)',
            borderRadius: 4,
            color: 'var(--muted)',
            fontSize: 11,
            fontFamily: 'var(--mono)',
          }}
        >
          NONE
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void onFile(e)}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={onPick}
        style={{
          fontFamily: 'inherit',
          fontSize: 13,
          padding: '6px 12px',
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text)',
          cursor: 'pointer',
        }}
      >
        {value ? 'Change' : 'Upload'}
      </button>
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          style={{
            fontFamily: 'inherit',
            fontSize: 13,
            padding: '6px 12px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--red)',
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      ) : null}
      {error ? (
        <span style={{ color: 'var(--red)', fontSize: 12, fontFamily: 'var(--mono)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
