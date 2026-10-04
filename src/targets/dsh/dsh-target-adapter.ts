/**
 * The DSH target adapter: renders Universal Skill IR v1 into a DeepSeek Harness
 * skill package.
 *
 * Mapping is deliberately minimal. Only the three universal core fields are
 * emitted: `name`, `description` and the instructions. The pinned DSH contract
 * happens to understand more keys (`whenToUse`, `metadata`, the invocation
 * keys), but the IR does not carry interpreted semantics for them — they live in
 * `source.extraFrontmatter` as raw source data — so this adapter refuses to
 * invent a mapping. Converting a skill that carries them is refused upstream by
 * the unmapped-frontmatter policy.
 */
import { stringify } from 'yaml';

import type { SkillIR } from '../../ir/skill-ir.js';
import type { SkillIRV2 } from '../../ir/skill-ir-v2.js';

/** The single file name a DSH directory-bundle skill uses for its entry. */
export const DSH_ENTRY_FILENAME = 'SKILL.md';

/** The rendered entry document for a target package. */
export interface RenderedEntry {
  /** File name inside the package, always `SKILL.md`. */
  readonly path: string;
  /** Complete file contents: YAML frontmatter plus the instructions. */
  readonly content: string;
}

/**
 * Serializes the DSH frontmatter for a skill.
 *
 * Uses the YAML library rather than string interpolation, so a description
 * containing a colon, a quote, a `#`, a newline, leading or trailing spaces,
 * Unicode or emoji is emitted as valid YAML with the same value on re-parse.
 *
 * @param name Skill name.
 * @param description Skill description.
 * @returns YAML frontmatter text, ending with a newline.
 */
export function renderDshFrontmatter(name: string, description: string): string {
  const yaml = stringify({ name, description }, { lineWidth: 0, defaultStringType: 'PLAIN' });
  return `---\n${yaml}---\n`;
}

/**
 * Renders the IR as a DSH `SKILL.md`.
 *
 * The instructions are written verbatim after the frontmatter: the IR already
 * carries canonical LF text, and this adapter never trims, reflows or reformats
 * Markdown. The result ends with exactly one newline.
 *
 * @param ir Universal Skill IR v1.
 * @returns The rendered entry document.
 */
export function renderDshSkillMarkdown(ir: SkillIR): RenderedEntry {
  return renderDshEntry(ir.name, ir.description, ir.instructions, {});
}

/**
 * Frontmatter keys this target can emit beyond the universal core.
 *
 * `metadata` is emitted verbatim: the pinned contract documents it as provider
 * frontmatter the registry carries without reading, so a string map survives
 * unchanged. `whenToUse` and the invocation keys are deliberately absent — no
 * Phase 7 source has a proven mapping onto them, and inventing one would change
 * which skills a model may load.
 */
export interface DshEmitExtras {
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Renders a target entry document from the universal core plus mapped extras.
 *
 * Frontmatter is produced by the YAML library, never by string interpolation, so
 * a description containing a colon, a quote, `#`, a newline, Unicode or emoji is
 * valid YAML with the same value on re-parse. `metadata` values are emitted as
 * YAML strings, so a value such as `"1.0"` or `"no"` cannot come back as a number
 * or a boolean.
 *
 * @param name Skill name.
 * @param description Skill description.
 * @param instructions Markdown body.
 * @param extras Emitted optional frontmatter.
 * @returns The rendered entry document.
 */
export function renderDshEntry(
  name: string,
  description: string,
  instructions: string,
  extras: DshEmitExtras,
): RenderedEntry {
  const frontmatterFields: Record<string, unknown> = { name, description };
  if (extras.metadata !== undefined && Object.keys(extras.metadata).length > 0) {
    frontmatterFields['metadata'] = { ...extras.metadata };
  }

  const yaml = stringify(frontmatterFields, { lineWidth: 0, defaultStringType: 'PLAIN' });
  const frontmatter = `---\n${yaml}---\n`;

  // The IR already carries canonical LF text; normalising again keeps the
  // emitter's LF-only guarantee independent of its caller.
  const normalized = instructions.replace(/\r\n?/g, '\n');
  const body = normalized.endsWith('\n') ? normalized : `${normalized}\n`;

  return { path: DSH_ENTRY_FILENAME, content: `${frontmatter}${body}` };
}

/**
 * Renders IR v2 as a DSH `SKILL.md`.
 *
 * Only `semantics.metadata` reaches the target. `license` and `compatibility`
 * have no counterpart here and are refused before this point rather than being
 * folded into description, body or metadata.
 *
 * @param ir Universal Skill IR v2.
 * @returns The rendered entry document.
 */
export function renderDshSkillMarkdownV2(ir: SkillIRV2): RenderedEntry {
  const metadata = ir.semantics['metadata'];
  const extras: DshEmitExtras =
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? { metadata: metadata as Record<string, string> }
      : {};

  return renderDshEntry(ir.name, ir.description, ir.instructions, extras);
}

/**
 * Reports which portable semantics this target cannot express.
 *
 * A semantic that reaches the target but has no counterpart is a refusal, never a
 * silent drop and never a reinterpretation. `license` and `compatibility` are
 * unsupported here because the pinned contract has no field carrying a license or
 * environment requirement: folding either into `description`, the body, or
 * `metadata` would invent a meaning the source never stated.
 *
 * Results are sorted, so the report cannot depend on object key order.
 *
 * @param semantics Serialized portable semantics.
 * @returns Unsupported field names, sorted.
 */
export function unsupportedDshSemantics(semantics: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(semantics)
    .filter((field) => field !== 'metadata')
    .sort((left, right) => left.localeCompare(right, 'en'));
}

/**
 * Maps portable semantics onto the frontmatter this target can emit.
 *
 * @param semantics Serialized portable semantics.
 * @returns The emit extras for the supported fields.
 */
export function toDshEmitExtras(semantics: Readonly<Record<string, unknown>>): DshEmitExtras {
  const metadata = semantics['metadata'];
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return {};
  }
  return { metadata: { ...(metadata as Record<string, string>) } };
}
