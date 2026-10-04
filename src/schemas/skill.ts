/**
 * Shapes shared by local skill analysis.
 *
 * This is the minimum needed to describe one skill read from disk. It is
 * deliberately not a universal skill IR: no cross-ecosystem fields, no license
 * or provenance data, no conversion metadata.
 */
import type { SkillFrontmatter } from '../parsers/frontmatter-parser.js';

/** How the skill's content was read. */
export type SkillSourceType = 'file' | 'directory';

/** A `name` string when the frontmatter provides one, otherwise `undefined`. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * A skill parsed from local content.
 *
 * `name` and `description` are `undefined` when the frontmatter lacks them or
 * provides a non-string value: reporting that is the analyzer's job, so the
 * schema does not invent a value.
 */
export interface ParsedSkill {
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly frontmatter: SkillFrontmatter;
  /** Markdown body with the frontmatter block removed. */
  readonly body: string;
  /** Absolute path of the entry file that was read. */
  readonly entryFile: string;
  /** Who the skill was read from: a single file or a directory. */
  readonly sourceType: SkillSourceType;
  /** Repo-relative resource paths, always `/`-separated. */
  readonly resources: readonly string[];
}

/** Inputs for {@link buildParsedSkill}. */
export interface ParsedSkillInput {
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
  readonly entryFile: string;
  readonly sourceType: SkillSourceType;
  readonly resources: readonly string[];
}

/**
 * Builds a {@link ParsedSkill} from raw parts.
 *
 * @param input Parsed frontmatter, body, entry file and resources.
 * @returns The assembled skill.
 */
export function buildParsedSkill(input: ParsedSkillInput): ParsedSkill {
  return {
    name: optionalString(input.frontmatter['name']),
    description: optionalString(input.frontmatter['description']),
    frontmatter: input.frontmatter,
    body: input.body,
    entryFile: input.entryFile,
    sourceType: input.sourceType,
    resources: input.resources,
  };
}
