/**
 * AddCharacterScreen — 4-step new character flow.
 *
 * Steps:
 *  0. Name.
 *  1. Persona source (Save creates the character; main expands persona via LLM).
 *  2. Card image (skippable) — uploads a portrait override.
 *  3. Skin (skippable) — search MC username or upload PNG, applies via SkinEditor.
 *
 * The character is created at the end of step 1 (we need a persisted id before
 * apply-skin / portrait save can run). Steps 2 & 3 mutate the already-saved
 * record. "Skip" on either jumps straight to the character page.
 */

import React, { useState } from 'react';
import { sei } from '../lib/ipcClient';
import { useUiStore } from '../lib/stores/useUiStore';
import { useDataStore } from '../lib/stores/useDataStore';
import { QuestionShell } from '../components/QuestionShell';
import { TextField } from '../components/TextField';
import { PortraitImagePicker } from '../components/PortraitImagePicker';
import { SkinEditor } from '../components/SkinEditor';
import { slugify } from '../lib/slug';
import type { Character } from '@shared/characterSchema';

const STEPS = 4;

export function AddCharacterScreen(): React.ReactElement {
  const navigate = useUiStore((s) => s.navigate);
  const characters = useDataStore((s) => s.characters);
  const addCharacter = useDataStore((s) => s.addCharacter);
  const refreshCharacter = useDataStore((s) => s.refreshCharacter);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [personaSource, setPersonaSource] = useState('');
  const [portraitImage, setPortraitImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Character | null>(null);

  const back = () => {
    if (step === 0) {
      navigate({ kind: 'home' });
      return;
    }
    // Once the character is created (step >= 2), block back-navigation past
    // the creation point — the record exists and editing happens on the
    // character page now.
    if (created && step <= 2) return;
    setStep((s) => s - 1);
  };

  const validate = (): boolean => {
    if (submitting) return false;
    if (step === 0) return name.trim() !== '';
    if (step === 1) return personaSource.trim() !== '';
    return true; // 2 & 3 always allow next (skippable)
  };

  const persistCreate = async (): Promise<Character | null> => {
    setError(null);
    setSubmitting(true);
    try {
      const existingIds = characters.map((c) => c.id);
      const id = slugify(name.trim(), existingIds);
      const draft: Character = {
        id,
        name: name.trim(),
        persona: { source: personaSource.trim(), expanded: '' },
        is_default: false,
        created: new Date().toISOString(),
        last_launched: null,
        playtime_ms: 0,
        portrait_image: portraitImage,
        skin: { source: 'none', mojang_username: null, png_sha256: null, applied_at: null },
        username: null,
      };
      const persisted = await sei.saveCharacter(draft);
      addCharacter(persisted);
      setCreated(persisted);
      return persisted;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const persistPortrait = async (): Promise<void> => {
    if (!created) return;
    if (created.portrait_image === portraitImage) return;
    try {
      await sei.saveCharacter(
        { ...created, portrait_image: portraitImage },
        { skipExpansion: true },
      );
      await refreshCharacter(created.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const finish = (id: string): void => {
    navigate({ kind: 'character', id });
  };

  const next = async (): Promise<void> => {
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1) {
      const persisted = await persistCreate();
      if (persisted) setStep(2);
      return;
    }
    if (step === 2) {
      await persistPortrait();
      setStep(3);
      return;
    }
    if (step === 3) {
      if (created) finish(created.id);
      return;
    }
  };

  const skip = async (): Promise<void> => {
    if (step === 2) {
      // Skip image — keep whatever was already there (likely null) and move on.
      setStep(3);
      return;
    }
    if (step === 3 && created) {
      finish(created.id);
    }
  };

  // ── Step 0 — Name ───────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <QuestionShell
        title="Name your character."
        stepCount={STEPS}
        currentStep={step}
        onBack={back}
        onNext={() => void next()}
        nextDisabled={!validate()}
      >
        <TextField
          value={name}
          onChange={setName}
          autoFocus
          onEnter={() => void next()}
          aria-label="Character name"
        />
      </QuestionShell>
    );
  }

  // ── Step 1 — Persona source (commits create) ────────────────────────────
  if (step === 1) {
    return (
      <QuestionShell
        eyebrow="Shown to the model after expansion"
        title="Write a short persona blurb."
        hint="A short description of who this character is. The model expands this into the full prompt when you save."
        stepCount={STEPS}
        currentStep={step}
        onBack={back}
        onNext={() => void next()}
        nextLabel={submitting ? 'Generating…' : 'Create'}
        nextKind="accent"
        nextDisabled={!validate()}
      >
        <TextField
          value={personaSource}
          onChange={setPersonaSource}
          multiline
          rows={4}
          aria-label="Persona source"
        />
        {error ? <ErrorRow message={error} /> : null}
      </QuestionShell>
    );
  }

  // ── Step 2 — Card image (skippable) ─────────────────────────────────────
  if (step === 2) {
    return (
      <QuestionShell
        title="Add a card image?"
        hint="Optional. Shown on the character card on Home."
        stepCount={STEPS}
        currentStep={step}
        onBack={back}
        onNext={() => void next()}
        nextLabel="Next"
        nextDisabled={!validate()}
        secondaryLabel="Skip"
        onSecondary={() => void skip()}
      >
        <PortraitImagePicker value={portraitImage} onChange={setPortraitImage} />
        {error ? <ErrorRow message={error} /> : null}
      </QuestionShell>
    );
  }

  // ── Step 3 — Skin (skippable) ───────────────────────────────────────────
  return (
    <QuestionShell
      title="Pick a skin?"
      hint="Optional. Search a Minecraft username or upload a PNG. You can change this later."
      stepCount={STEPS}
      currentStep={step}
      wide
      onBack={back}
      onNext={() => void next()}
      nextLabel="Done"
      nextKind="accent"
      secondaryLabel="Skip"
      onSecondary={() => void skip()}
    >
      {created ? (
        <SkinEditor
          character={created}
          onChanged={() => {
            if (created) void refreshCharacter(created.id);
          }}
        />
      ) : null}
    </QuestionShell>
  );
}

function ErrorRow({ message }: { message: string }): React.ReactElement {
  return (
    <div
      style={{
        marginTop: 12,
        color: 'var(--red)',
        fontFamily: 'var(--mono)',
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}
