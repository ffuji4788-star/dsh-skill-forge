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
  const frontmatter = renderDshFrontmatter(ir.name, ir.description);
  // The IR already carries canonical LF text; normalising again keeps the
  // emitter's LF-only guarantee independent of its caller.
  const instructions = ir.instructions.replace(/\r\n?/g, '\n');
  const body = instructions.endsWith('\n') ? instructions : `${instructions}\n`;

  return { path: DSH_ENTRY_FILENAME, content: `${frontmatter}${body}` };
}
