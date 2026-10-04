/**
 * Deterministic normalization of a local skill into Universal Skill IR v1.
 *
 * The pipeline is Local Importer → Parser → ParsedSkill → **generic structural
 * validation** → this normalizer → SkillIR v1 → canonical serializer. Target
 * compatibility is deliberately not consulted: whether a skill suits one
 * platform is independent of whether it can be represented canonically.
 *
 * This module only reads and transforms in memory. It performs no filesystem
 * work of its own, executes nothing, writes nothing and never touches the
 * network.
 */
import path from 'node:path';

import { loadLocalSkill } from '../importers/local-importer.js';
import type { ParsedSkill } from '../schemas/skill.js';
import type { ValidationResult } from '../schemas/validation.js';
import { validateBasicSkill } from '../validators/basic-skill-validator.js';
import { toCanonicalJson, type JsonObject } from './json-value.js';
import {
  GENERIC_LOCAL_SKILL_FORMAT,
  SKILL_IR_SCHEMA_VERSION,
  validateSkillIR,
  type SkillIR,
} from './skill-ir.js';

/** Universal core fields: the ones with meaning in every skill system. */
const UNIVERSAL_CORE_FIELDS: readonly string[] = ['name', 'description'];

/**
 * Raised when a parsed skill cannot be represented as IR.
 *
 * Carries the schema problems so the caller can report all of them instead of
 * only the first. This is not a user-input error class: input problems are
 * raised earlier by the importer, parser or generic validator.
 */
export class SkillIRError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Cannot build Universal Skill IR: ${problems.join('; ')}`);
    this.name = 'SkillIRError';
    this.problems = problems;
  }
}

/** Raised when generic structural validation fails, so no IR may be produced. */
export class SkillNotNormalizableError extends Error {
  readonly validation: ValidationResult;

  constructor(validation: ValidationResult) {
    super('Skill cannot be normalized because generic validation failed.');
    this.name = 'SkillNotNormalizableError';
    this.validation = validation;
  }
}

/**
 * Normalizes line endings to LF.
 *
 * This is the only text transformation normalization performs. The body is never
 * trimmed, re-wrapped or otherwise rewritten.
 */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Reports whether a string contains a C0 control character or DEL.
 *
 * Implemented by code point rather than a regular expression so the check needs
 * no lint suppression, and shared in spirit with the skill-name rule.
 */
function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Produces a skill-root-relative, `/`-separated resource path.
 *
 * @returns The normalized path, or `undefined` when the path is absolute,
 *   drive-qualified, contains a control character, or escapes the skill root.
 */
export function normalizeResourcePath(resource: string): string | undefined {
  const unified = resource.split('\\').join('/');
  if (unified.length === 0 || unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) {
    return undefined;
  }
  if (containsControlCharacter(unified)) {
    return undefined;
  }
  const segments = unified.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.length === 0)) {
    return undefined;
  }
  return segments.join('/');
}

function normalizeResources(resources: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const resource of resources) {
    const candidate = normalizeResourcePath(resource);
    if (candidate !== undefined) {
      normalized.add(candidate);
    }
  }
  // Sorted so filesystem enumeration order cannot influence the result.
  return [...normalized].sort((left, right) => left.localeCompare(right, 'en'));
}

/**
 * Normalizes the entry file path for display and storage: root-relative, with
 * `/` separators and no absolute component.
 *
 * @param entryFile Absolute entry file path, as read by the importer.
 * @param rootPath Absolute skill root directory.
 */
export function normalizeEntryFile(entryFile: string, rootPath: string): string {
  const relative = path.relative(rootPath, entryFile);
  const unified = relative.split(path.sep).join('/');
  const normalized = normalizeResourcePath(unified);
  return normalized ?? path.basename(entryFile);
}

/**
 * Builds the source envelope, preserving every non-core frontmatter field.
 *
 * @param skill The parsed skill.
 * @param rootPath Absolute skill root directory.
 * @throws SkillIRError when a value cannot be represented as JSON.
 */
function buildSourceEnvelope(skill: ParsedSkill, rootPath: string): SkillIR['source'] {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(skill.frontmatter)) {
    if (!UNIVERSAL_CORE_FIELDS.includes(key)) {
      extra[key] = value;
    }
  }

  const converted = toCanonicalJson(extra, 'source.extraFrontmatter');
  if ('problem' in converted) {
    throw new SkillIRError([`${converted.problem.path}: ${converted.problem.reason}`]);
  }

  return {
    format: GENERIC_LOCAL_SKILL_FORMAT,
    entryFile: normalizeEntryFile(skill.entryFile, rootPath),
    extraFrontmatter: converted.value as JsonObject,
  };
}

/**
 * Converts an already-validated skill into Universal Skill IR v1.
 *
 * @param skill A skill that already passed generic structural validation.
 * @param rootPath Absolute skill root directory, used to relativize the entry file.
 * @returns The IR, verified against the v1 schema before it is returned.
 * @throws SkillIRError when a frontmatter value is not JSON-safe.
 */
export function toSkillIR(
  skill: ParsedSkill,
  rootPath: string = path.dirname(skill.entryFile),
): SkillIR {
  if (skill.name === undefined || skill.description === undefined) {
    throw new SkillIRError(['name and description are required to build IR']);
  }

  const ir: SkillIR = {
    schemaVersion: SKILL_IR_SCHEMA_VERSION,
    name: skill.name,
    description: skill.description,
    instructions: toLf(skill.body),
    resources: normalizeResources(skill.resources),
    source: buildSourceEnvelope(skill, rootPath),
  };

  // The IR must satisfy its own contract; a normalizer bug must not be able to
  // emit a shape that merely resembles it.
  const problems = validateSkillIR(ir);
  if (problems.length > 0) {
    throw new SkillIRError(problems);
  }

  return ir;
}

export interface NormalizeResult {
  readonly ir: SkillIR;
  readonly validation: ValidationResult;
}

/**
 * Converts an already-validated skill and pairs the IR with its validation result.
 *
 * @param skill A skill that already passed generic structural validation.
 * @param rootPath Absolute skill root directory, used to relativize the entry file.
 * @returns The IR together with the validation result that admitted it.
 * @throws SkillIRError when a frontmatter value cannot be represented as JSON.
 */
export function toNormalizeResult(skill: ParsedSkill, rootPath?: string): NormalizeResult {
  return {
    ir: rootPath === undefined ? toSkillIR(skill) : toSkillIR(skill, rootPath),
    validation: validateBasicSkill(skill),
  };
}

/**
 * Reads a local skill, applies the generic validation gate and normalizes it.
 *
 * @param inputPath File or directory to normalize.
 * @param options Directory used to resolve the input path.
 * @throws SkillNotNormalizableError when generic validation fails (no IR is produced).
 * @throws SkillInputError, AmbiguousSkillError or FrontmatterError for fatal input.
 * @throws SkillIRError when a frontmatter value cannot be represented as JSON.
 */
export function normalizeSkill(
  inputPath: string,
  options: { readonly cwd?: string } = {},
): NormalizeResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  // The importer resolves the entry file to an absolute path, so the skill root
  // is the directory that contains it.
  const skill = loadLocalSkill(path.resolve(cwd, inputPath));
  const validation = validateBasicSkill(skill);

  if (!validation.valid) {
    throw new SkillNotNormalizableError(validation);
  }

  return { ir: toSkillIR(skill), validation };
}
