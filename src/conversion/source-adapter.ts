/**
 * The boundary between a skill source and the conversion pipeline.
 *
 * Phase 6 introduces the first source adapter, but not a plugin system: a source
 * is selected explicitly by name and called directly. There is no registry, no
 * dynamic loading, and no automatic detection — guessing a source from a
 * directory's contents would silently reinterpret a user's skill.
 *
 * A source is only ever consulted when the user asks for it. Omitting `--source`
 * keeps the generic local path, whose behaviour is unchanged.
 */
import path from 'node:path';

import { loadLocalSkill } from '../importers/local-importer.js';
import type { PortableSemantics } from '../ir/portable-semantics.js';
import type { ParsedSkill } from '../schemas/skill.js';
import { loadAgentSkill } from '../sources/agent-skills/agent-skills-source-adapter.js';
import { AGENT_SKILLS_SOURCE_ID } from '../sources/agent-skills/agent-skills-contract.js';

/** Source selected when `--source` is omitted: the previous generic behaviour. */
export const GENERIC_LOCAL_SOURCE_ID = 'generic-local';

/** Every source that can be selected explicitly, in display order. */
export const AVAILABLE_SOURCE_IDS: readonly string[] = [
  GENERIC_LOCAL_SOURCE_ID,
  AGENT_SKILLS_SOURCE_ID,
];

/** How serious a source finding is. */
export type SourceIssueSeverity = 'error' | 'warning';

/** A single source contract finding. */
export interface SourceIssue {
  readonly code: string;
  readonly severity: SourceIssueSeverity;
  readonly message: string;
  /** Optional list rendered under the message, for example failing field names. */
  readonly details?: readonly string[];
}

/**
 * Which layer refused a source.
 *
 * `selection` means the source name or package shape was wrong, `source-contract`
 * means the package violated the named source's own rules, and `generic`
 * describes a skill read without a source adapter.
 */
export type SourceSelection = 'selection' | 'package-shape' | 'source-contract' | 'generic';

/** A source that could not be read as a skill. */
export interface SourceFailure {
  readonly ok: false;
  /** Source identifier that produced the failure. */
  readonly source: string;
  readonly issues: readonly SourceIssue[];
  readonly selection: SourceSelection;
}

/** A source that was read and satisfies its own contract. */
export interface SourceSuccess {
  readonly ok: true;
  readonly source: string;
  readonly selection: 'explicit' | 'generic';
  readonly skill: ParsedSkill;
  /** Absolute skill root directory. */
  readonly sourceRoot: string;
  /**
   * `source.format` provenance for IR v2, for example `agent-skills`.
   *
   * Paired with {@link semantics}. The generic local path leaves both unset,
   * which is what keeps its IR v2 output identical to v1: with nothing handed in,
   * no frontmatter key is ever promoted out of the source envelope.
   */
  readonly format?: string;
  /**
   * Portable semantics the adapter interpreted from its own vocabulary.
   *
   * Only a source adapter that has actually validated a field against a contract
   * may fill this in. A key whose name merely resembles a target field is never
   * promoted here — interpreting a vocabulary is the adapter's job, and the IR
   * layer refuses to guess.
   */
  readonly semantics?: PortableSemantics;
}

export type SourceLoadResult = SourceSuccess | SourceFailure;

/** Codes emitted while selecting or resolving a source. */
export const SOURCE_CODES = {
  unknownSource: 'UNKNOWN_SOURCE',
  notADirectory: 'SOURCE_PACKAGE_SHAPE_INVALID',
  missingEntry: 'SOURCE_PACKAGE_MISSING_ENTRY',
  sourceValidIrUnsupported: 'SOURCE_VALID_BUT_IR_UNSUPPORTED',
} as const;

/**
 * Reports whether a source name can be selected.
 *
 * @param source Source identifier from the command line.
 */
export function isKnownSourceId(source: string): boolean {
  return AVAILABLE_SOURCE_IDS.includes(source);
}

function selectionFailure(source: string, message: string): SourceFailure {
  return {
    ok: false,
    source,
    selection: 'selection',
    issues: [{ code: SOURCE_CODES.unknownSource, severity: 'error', message }],
  };
}

/**
 * Reads a skill through the generic local path.
 *
 * The generic importer resolves the entry itself: a missing path, an unreadable
 * path, malformed YAML and an ambiguous directory all stay fatal, exactly as they
 * were before a source adapter existed. Only a named source adapter turns those
 * cases into contract refusals, because only there does the package shape belong
 * to a documented contract.
 */
function loadGenericSkill(inputPath: string, cwd: string): SourceLoadResult {
  const skill = loadLocalSkill(path.resolve(cwd, inputPath));

  return {
    ok: true,
    source: GENERIC_LOCAL_SOURCE_ID,
    selection: 'generic',
    skill,
    sourceRoot: path.dirname(skill.entryFile),
  };
}

/**
 * Resolves and reads a skill from the selected source.
 *
 * @param inputPath Skill file or directory.
 * @param source Source identifier, or `undefined` to use the generic path.
 * @param cwd Directory used to resolve a relative input path.
 * @returns The parsed skill, or a refusal describing what was wrong.
 */
export function loadSourceSkill(
  inputPath: string,
  source: string | undefined,
  cwd: string,
): SourceLoadResult {
  if (source === undefined) {
    return loadGenericSkill(inputPath, cwd);
  }

  if (!isKnownSourceId(source)) {
    return selectionFailure(
      source,
      `Unknown source "${source}". Available sources are: ${AVAILABLE_SOURCE_IDS.join(', ')}`,
    );
  }

  if (source === GENERIC_LOCAL_SOURCE_ID) {
    return loadGenericSkill(inputPath, cwd);
  }

  return loadAgentSkill(inputPath, cwd);
}
