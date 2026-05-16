import { z } from 'zod';

/**
 * 260516-0yw: persona is now an object with `source` (user's short blurb,
 * required) and `expanded` (LLM-generated long prompt produced at
 * character-save time by src/main/personaExpansion.ts). The legacy
 * `description` and `persona_prompt` fields are DROPPED outright — no
 * .optional(), no .default(''), no migration shim per CLAUDE.md
 * ("no backwards-compat hacks"). Existing characters JSON whose shape
 * does not include `persona.source` will fail Zod parsing explicitly so
 * the user knows to re-save in the GUI.
 *
 * `expanded` defaults to '' so a newly-created character can round-trip
 * through saveCharacter BEFORE the expansion call lands (the IPC path
 * runs expansion in `expandAndSaveCharacter`, but the migration path
 * writes raw `saveCharacter` with empty `expanded` so first-launch
 * doesn't burn an API call on a freshly-cloned dev tree).
 */
export const PersonaSchema = z.object({
  source: z.string().min(1),
  expanded: z.string().default(''),
});

export type Persona = z.infer<typeof PersonaSchema>;

/**
 * Character JSON shape stored at `<userData>/characters/<id>.json`.
 * Source: CONTEXT D-09, D-11, D-14 + PATTERNS §characterSchema.ts.
 *
 * 260516-0yw: `description` + `persona_prompt` replaced by `persona`
 * object — see PersonaSchema docblock above.
 */
export const CharacterSchema = z.object({
  id: z.string().min(1),                              // slug, kebab-case
  name: z.string().min(1),
  persona: PersonaSchema,                             // 260516-0yw: replaces description + persona_prompt
  is_default: z.boolean().default(false),             // sui = true after migration (D-10)
  created: z.string(),                                // ISO timestamp, immutable (D-11)
  last_launched: z.string().nullable().default(null), // ISO or null (D-11)
  playtime_ms: z.number().int().min(0).default(0),    // accumulated (D-11)
  portrait_image: z.string().nullable().default(null),// optional override file (D-14)
});

export type Character = z.infer<typeof CharacterSchema>;

/**
 * Index manifest at `<userData>/characters/index.json`.
 * Maintains ordering across the character grid (D-09).
 */
export const CharacterIndexSchema = z.object({
  version: z.literal(1).default(1),
  order: z.array(z.string()).default([]),             // character ids in display order
});

export type CharacterIndex = z.infer<typeof CharacterIndexSchema>;

/**
 * User config stored at `<userData>/config.json`.
 * NEVER contains the API secret (D-13: secret lives in safeStorage at `<userData>/api-key.bin`).
 * Sources: CONTEXT D-12, D-26, D-27, D-33.
 */
export const UserConfigSchema = z.object({
  mc_username: z.string().default(''),                            // Minecraft account display name
  preferred_name: z.string().default(''),                          // what bot calls the user
  provider: z.enum(['anthropic']).default('anthropic'),            // D-26 reserves more (OpenAI/Google/Local) — only anthropic valid today
  theme_mode: z.enum(['system', 'light', 'dark']).default('system'), // D-33
});

export type UserConfig = z.infer<typeof UserConfigSchema>;
