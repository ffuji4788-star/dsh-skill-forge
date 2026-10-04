/**
 * Universal Skill IR v1.
 *
 * A canonical, platform-neutral representation of a structurally valid local
 * skill. It is deliberately not a conversion format and not an archive: it
 * carries references, never resource contents.
 *
 * The IR is *not* a claim of semantic equivalence between skill ecosystems. It
 * records the three fields that are demonstrably universal (name, description,
 * instructions) and preserves everything else verbatim in a source envelope, so
 * a later adapter can interpret it without any information having been lost here.
 */
import type { JsonObject } from './json-value.js';

/** The only schema version this module produces or accepts. */
export const SKILL_IR_SCHEMA_VERSION = 1;

/** The only `source.format` value Phase 4 can justify. */
export const GENERIC_LOCAL_SKILL_FORMAT = 'generic-local-skill';

/** Source formats this module accepts. Adapters add their own in a later phase. */
export const KNOWN_SOURCE_FORMATS: readonly string[] = [GENERIC_LOCAL_SKILL_FORMAT];

/** Where the skill came from, described without any absolute local path. */
export interface SkillIRSource {
  readonly format: string;
  /** Entry file name relative to the skill root, for example `SKILL.md`. */
  readonly entryFile: string;
  /**
   * Frontmatter this phase does not interpret, preserved verbatim.
   *
   * `name` and `description` are never repeated here: they are already the
   * universal core fields. Keys are stored in canonical (sorted) order.
   */
  readonly extraFrontmatter: JsonObject;
}

/** The canonical, platform-neutral representation of one skill. */
export interface SkillIR {
  readonly schemaVersion: typeof SKILL_IR_SCHEMA_VERSION;
  readonly name: string;
  readonly description: string;
  /** The Markdown body, with line endings normalised to LF and nothing else changed. */
  readonly instructions: string;
  /** Resource references, relative to the skill root, `/`-separated and sorted. */
  readonly resources: readonly string[];
  readonly source: SkillIRSource;
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
 * Validates a value as Universal Skill IR v1.
 *
 * Errors are returned rather than thrown so a caller can report all of them at
 * once. The checker is intentionally explicit: it is the only place the IR
 * contract is enforced, so a normalizer bug cannot produce a shape that "looks
 * about right".
 *
 * @param value Candidate value.
 * @returns A list of human-readable problems; empty when the value is valid IR.
 */
export function validateSkillIR(value: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    return ['IR must be a JSON object'];
  }

  if (value['schemaVersion'] !== SKILL_IR_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SKILL_IR_SCHEMA_VERSION}`);
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

  if (!isPlainObject(value['source'])) {
    errors.push('source must be an object');
    return errors;
  }

  const source = value['source'];
  const format = source['format'];
  if (typeof format !== 'string') {
    errors.push('source.format must be a string');
  } else if (!KNOWN_SOURCE_FORMATS.includes(format)) {
    errors.push(`source.format "${format}" is not a known format`);
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
  }

  return errors;
}

/**
 * Narrows a value to {@link SkillIR}.
 *
 * @param value Candidate value.
 */
export function isSkillIR(value: unknown): value is SkillIR {
  return validateSkillIR(value).length === 0;
}
