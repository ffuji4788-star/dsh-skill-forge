/**
 * Universal Skill IR v2.
 *
 * v2 is a separate schema, not v1 with optional extras: v1 stays frozen so
 * `dsh-forge normalize` keeps producing byte-identical output for every existing
 * fixture. v2 adds one thing — a `semantics` object holding the package-level
 * fields whose meaning has been *proven* to be portable.
 *
 * The split matters. In v1 every unrecognised frontmatter key is raw source data
 * sitting in `source.extraFrontmatter`, and a target must refuse rather than guess
 * what it means. In v2 a source adapter that has interpreted its own vocabulary
 * may promote a field into `semantics`, where the target can map it or refuse it
 * explicitly. A field is promoted only with contract evidence; anything else
 * stays in the source envelope exactly as before.
 *
 * `source.format` records provenance only. It is not platform semantics.
 */
import type { JsonObject } from './json-value.js';
import { validatePortableSemantics, type SerializedSemantics } from './portable-semantics.js';

/** The schema version this module produces or accepts. */
export const SKILL_IR_V2_SCHEMA_VERSION = 2;

/** The uninterpreted local-skill provenance v1 already used. */
export const GENERIC_LOCAL_SKILL_FORMAT = 'generic-local-skill';

/** Provenance for a skill read through the Agent Skills source contract. */
export const AGENT_SKILLS_FORMAT = 'agent-skills';

/**
 * Provenance values IR v2 accepts.
 *
 * These name where the bytes came from. They deliberately do not name a vendor:
 * `agent-skills` is the standard, not one implementation of it.
 */
export const KNOWN_V2_SOURCE_FORMATS: readonly string[] = [
  GENERIC_LOCAL_SKILL_FORMAT,
  AGENT_SKILLS_FORMAT,
];

/** Where a v2 skill came from, described without any absolute local path. */
export interface SkillIRV2Source {
  readonly format: string;
  /** Entry file name relative to the skill root, for example `SKILL.md`. */
  readonly entryFile: string;
  /**
   * Frontmatter that was not promoted into `semantics`, preserved verbatim.
   *
   * `name` and `description` are never repeated here, and neither is any field
   * that reached `semantics`: duplicating them would give one fact two homes that
   * could disagree.
   */
  readonly extraFrontmatter: JsonObject;
}

/** The canonical, platform-neutral representation of one skill, schema 2. */
export interface SkillIRV2 {
  readonly schemaVersion: typeof SKILL_IR_V2_SCHEMA_VERSION;
  readonly name: string;
  readonly description: string;
  /** The Markdown body, with line endings normalised to LF and nothing else changed. */
  readonly instructions: string;
  /** Resource references, relative to the skill root, `/`-separated and sorted. */
  readonly resources: readonly string[];
  /** Portable package semantics. Empty when the source offers none. */
  readonly semantics: SerializedSemantics;
  readonly source: SkillIRV2Source;
}

/** Reports whether a path is relative, contained, and free of control characters. */
function isRelativeContainedPath(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    return false;
  }
  // `C:/x`, `C:\x` and `c:x` are all absolute or drive-qualified on Windows.
  if (/^[a-zA-Z]:/.test(path)) {
    return false;
  }
  if (path.includes('\\')) {
    return false;
  }
  for (const character of path) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return false;
    }
  }
  return path.split('/').every((segment) => segment !== '..' && segment !== '.');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return Object.values(value).every(isJsonValue);
}

/**
 * Validates a value as Universal Skill IR v2.
 *
 * Errors are returned rather than thrown so a caller can report all of them at
 * once. This is the only place the v2 contract is enforced, so a normalizer bug
 * cannot emit a shape that merely resembles it.
 *
 * @param value Candidate value.
 * @returns A list of human-readable problems; empty when the value is valid IR v2.
 */
export function validateSkillIRV2(value: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    return ['IR v2 must be a JSON object'];
  }

  if (value['schemaVersion'] !== SKILL_IR_V2_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SKILL_IR_V2_SCHEMA_VERSION}`);
  }

  for (const field of ['name', 'description', 'instructions'] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string') {
      errors.push(`${field} must be a string`);
    } else if (field === 'name' && fieldValue.length === 0) {
      errors.push('name must not be empty');
    } else if (field === 'description' && fieldValue.length === 0) {
      errors.push('description must not be empty');
    }
  }

  const resources = value['resources'];
  if (!Array.isArray(resources)) {
    errors.push('resources must be an array');
  } else {
    for (const [index, resource] of resources.entries()) {
      if (typeof resource !== 'string') {
        errors.push(`resources[${index}] must be a string`);
      } else if (!isRelativeContainedPath(resource)) {
        errors.push(
          `resources[${index}] "${resource}" must be a skill-root-relative path without traversal`,
        );
      }
    }
  }

  if (!('semantics' in value)) {
    errors.push('semantics must be present (use {} when the source offers none)');
  } else {
    const semantics = value['semantics'];
    for (const problem of validatePortableSemantics(semantics)) {
      errors.push(`${problem.path} ${problem.reason}`);
    }
    if (isPlainObject(semantics) && !isJsonValue(semantics)) {
      errors.push('semantics must contain only JSON-safe values');
    }
  }

  if (!isPlainObject(value['source'])) {
    errors.push('source must be an object');
    return errors;
  }

  const source = value['source'];
  const format = source['format'];
  if (typeof format !== 'string') {
    errors.push('source.format must be a string');
  } else if (!KNOWN_V2_SOURCE_FORMATS.includes(format)) {
    errors.push(`source.format "${format}" is not a known v2 provenance`);
  }

  const entryFile = source['entryFile'];
  if (typeof entryFile !== 'string') {
    errors.push('source.entryFile must be a string');
  } else if (!isRelativeContainedPath(entryFile)) {
    errors.push(`source.entryFile "${entryFile}" must be a skill-root-relative path`);
  }

  const extra = source['extraFrontmatter'];
  if (!isPlainObject(extra)) {
    errors.push('source.extraFrontmatter must be an object');
  } else if (!isJsonValue(extra)) {
    errors.push('source.extraFrontmatter must contain only JSON-safe values');
  } else if ('name' in extra || 'description' in extra) {
    errors.push('source.extraFrontmatter must not repeat the universal core fields');
  } else if (isPlainObject(value['semantics'])) {
    const promoted = Object.keys(value['semantics']).filter((field) => field in extra);
    if (promoted.length > 0) {
      errors.push(
        `source.extraFrontmatter must not repeat promoted semantics: ${promoted.sort().join(', ')}`,
      );
    }
  }

  return errors;
}
