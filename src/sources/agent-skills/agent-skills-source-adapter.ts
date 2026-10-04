/**
 * The Agent Skills source adapter.
 *
 * It answers one question: "is this directory an Agent Skills package, and what
 * does it contain?" It is deliberately not a plugin: Phase 6 has exactly one
 * explicit source, so it is called directly.
 *
 * What the adapter owns, and what the reference parser owns, is kept separate:
 *
 * - the adapter enforces the *package shape* — the source must be a directory,
 *   and the entry is `SKILL.md` and then `skill.md`, in that order, exactly as
 *   `find_skill_md` does. A loose Markdown file has no Agent Skills shape, so it
 *   is refused instead of being quietly downgraded to generic mode;
 * - the *frontmatter contract* is enforced by
 *   {@link validateAgentSkillFrontmatter};
 * - parsing and the filesystem walk are reused from the generic importer, so
 *   there is one hardened implementation of each.
 *
 * Nothing here executes a resource, mutates the source, or touches the network.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import {
  enumerateResources,
  readSkillFile,
  statOrThrow,
  toRelativePosixPath,
} from '../../importers/skill-files.js';
import { parseFrontmatter } from '../../parsers/frontmatter-parser.js';
import { buildParsedSkill, type ParsedSkill } from '../../schemas/skill.js';
import type {
  SourceFailure,
  SourceIssue,
  SourceLoadResult,
} from '../../conversion/source-adapter.js';
import { SkillInputError } from '../../utils/errors.js';
import { AGENT_SKILLS_ENTRY_NAMES } from './agent-skills-contract.js';
import { validateAgentSkillFrontmatter } from './agent-skills-validator.js';

/** Codes for problems with the package itself, as opposed to its frontmatter. */
export const AGENT_SKILLS_PACKAGE_CODES = {
  shapeInvalid: 'SOURCE_PACKAGE_SHAPE_INVALID',
  missingEntry: 'SOURCE_PACKAGE_MISSING_ENTRY',
} as const;

function failure(
  source: string,
  issues: readonly SourceIssue[],
  selection: SourceFailure['selection'],
): SourceLoadResult {
  return { ok: false, source, issues, selection };
}

/**
 * Finds the skill entry file in an Agent Skills directory.
 *
 * Entry names are matched case-insensitively against the directory's real
 * entries, which is equivalent to the reference's exact lookup on a
 * case-sensitive filesystem and is the only workable reading on a
 * case-insensitive one (where `existsSync('SKILL.md')` also answers for
 * `Skill.md`).
 *
 * Precedence is explicit and matches `find_skill_md`: `SKILL.md` first, then
 * `skill.md`, then any other casing of the same name. Comparison is by code unit
 * so the winner never depends on filesystem listing order.
 *
 * @param directory Absolute skill directory.
 * @returns The absolute entry path, or `undefined` when no candidate exists.
 * @throws SkillInputError when the directory cannot be listed.
 */
export function findAgentSkillEntry(directory: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    throw new SkillInputError(
      `Unable to list directory ${directory}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const lowercased = entries.map((entry) => entry.toLowerCase());
  for (const name of AGENT_SKILLS_ENTRY_NAMES) {
    const index = lowercased.indexOf(name.toLowerCase());
    if (index !== -1) {
      return path.join(directory, entries[index] ?? name);
    }
  }

  return undefined;
}

/**
 * Reads an Agent Skills package.
 *
 * @param inputPath Directory to read; relative paths resolve against `cwd`.
 * @param cwd Directory used to resolve a relative input path.
 * @returns The parsed skill, or a refusal listing every source issue.
 * @throws SkillInputError when the path is missing or unreadable.
 */
export function loadAgentSkill(inputPath: string, cwd: string): SourceLoadResult {
  const source = 'agent-skills';
  const resolved = path.resolve(cwd, inputPath);
  const stats = statOrThrow(resolved);

  if (stats.isFile) {
    return failure(
      source,
      [
        {
          code: AGENT_SKILLS_PACKAGE_CODES.shapeInvalid,
          severity: 'error',
          message:
            'An Agent Skills package must be a directory containing SKILL.md: a single Markdown file cannot be read as one',
        },
      ],
      'package-shape',
    );
  }

  if (!stats.isDirectory) {
    return failure(
      source,
      [
        {
          code: AGENT_SKILLS_PACKAGE_CODES.shapeInvalid,
          severity: 'error',
          message: 'An Agent Skills package must be a directory containing SKILL.md',
        },
      ],
      'package-shape',
    );
  }

  const entryFile = findAgentSkillEntry(resolved);
  if (entryFile === undefined) {
    return failure(
      source,
      [
        {
          code: AGENT_SKILLS_PACKAGE_CODES.missingEntry,
          severity: 'error',
          message: `Missing required file ${AGENT_SKILLS_ENTRY_NAMES[0]} in ${resolved}`,
        },
      ],
      'package-shape',
    );
  }

  const { frontmatter, body } = parseFrontmatter(readSkillFile(entryFile));
  const validation = validateAgentSkillFrontmatter(frontmatter, path.basename(resolved));

  if (!validation.valid) {
    return failure(source, validation.issues, 'source-contract');
  }

  const entryRelative = toRelativePosixPath(resolved, entryFile);

  const skill: ParsedSkill = buildParsedSkill({
    frontmatter,
    // The body is preserved exactly as parsed. The reference parser strips it,
    // but the IR's preservation policy is the project's own decision and is
    // documented as a deliberate divergence.
    body,
    entryFile,
    sourceType: 'directory',
    resources: enumerateResources(resolved).filter((file) => file !== entryRelative),
  });

  return {
    ok: true,
    source,
    selection: 'explicit',
    skill,
    sourceRoot: resolved,
  };
}
