/**
 * Checks a parsed skill against the pinned DeepSeek Harness contract.
 *
 * This answers exactly one question: *would the pinned DSH skill-filesystem
 * implementation accept this skill and discover it?* It is not a quality gate —
 * where DSH is lenient, this validator is lenient too.
 *
 * Read-only, offline and deterministic. Fatal problems (unreadable path,
 * ambiguous entry, malformed frontmatter) are raised by the importer and parser
 * as errors, never represented here.
 */
import type { CompatibilityIssue, CompatibilityResult } from '../../schemas/compatibility.js';
import type { ParsedSkill } from '../../schemas/skill.js';
import {
  DSH_KNOWN_FRONTMATTER_KEYS,
  DSH_LEGACY_INVOCATION_KEYS,
  DSH_SKILL_NAME_PATTERN,
} from './dsh-contract.js';
import { resolveDshInvocationPolicy } from './dsh-invocation-policy.js';

/** Issue codes emitted by the pinned DSH contract. */
export const DSH_COMPATIBILITY_CODES = {
  missingName: 'DSH_MISSING_NAME',
  invalidNameType: 'DSH_INVALID_NAME_TYPE',
  invalidName: 'DSH_INVALID_NAME',
  missingDescription: 'DSH_MISSING_DESCRIPTION',
  invalidDescriptionType: 'DSH_INVALID_DESCRIPTION_TYPE',
  ignoredWhenToUse: 'DSH_IGNORED_WHEN_TO_USE',
  ignoredMetadata: 'DSH_IGNORED_METADATA',
  legacyInvocationKey: 'DSH_LEGACY_INVOCATION_KEY',
  invalidInvocationValue: 'DSH_INVALID_INVOCATION_VALUE',
  ignoredFrontmatterKey: 'DSH_IGNORED_FRONTMATTER_KEY',
  emptyContent: 'DSH_EMPTY_CONTENT',
} as const;

/** The frontmatter keys this contract understands. */
const KNOWN_KEYS: ReadonlySet<string> = new Set(DSH_KNOWN_FRONTMATTER_KEYS);

function error(code: string, message: string): CompatibilityIssue {
  return { code, severity: 'error', message };
}

function warning(code: string, message: string): CompatibilityIssue {
  return { code, severity: 'warning', message };
}

function nameIssue(frontmatter: Record<string, unknown>): CompatibilityIssue[] {
  const value = frontmatter['name'];

  // Upstream `stringField` keeps a string only when `length > 0`; whitespace
  // counts as length, so a whitespace-only name then fails the name pattern.
  if (value === undefined || value === null) {
    return [error(DSH_COMPATIBILITY_CODES.missingName, 'frontmatter requires a "name" field')];
  }
  if (typeof value !== 'string') {
    return [
      error(DSH_COMPATIBILITY_CODES.invalidNameType, 'frontmatter field "name" must be a string'),
    ];
  }
  if (value.length === 0) {
    return [
      error(DSH_COMPATIBILITY_CODES.missingName, 'frontmatter field "name" must not be empty'),
    ];
  }
  if (!DSH_SKILL_NAME_PATTERN.test(value)) {
    return [
      error(
        DSH_COMPATIBILITY_CODES.invalidName,
        `invalid skill name "${value}": the pinned contract requires /${DSH_SKILL_NAME_PATTERN.source}/`,
      ),
    ];
  }

  return [];
}

function descriptionIssue(frontmatter: Record<string, unknown>): CompatibilityIssue[] {
  const value = frontmatter['description'];

  if (value === undefined || value === null) {
    return [
      error(
        DSH_COMPATIBILITY_CODES.missingDescription,
        'frontmatter requires a "description" field',
      ),
    ];
  }
  if (typeof value !== 'string') {
    return [
      error(
        DSH_COMPATIBILITY_CODES.invalidDescriptionType,
        'frontmatter field "description" must be a string',
      ),
    ];
  }
  if (value.length === 0) {
    return [
      error(
        DSH_COMPATIBILITY_CODES.missingDescription,
        'frontmatter field "description" must not be empty',
      ),
    ];
  }

  // A whitespace-only description is accepted by the pinned contract, which
  // only requires a non-empty string. Judging its content is not this
  // validator's job.
  return [];
}

function whenToUseIssue(frontmatter: Record<string, unknown>): CompatibilityIssue[] {
  const value = frontmatter['whenToUse'];
  if (value === undefined) {
    return [];
  }

  // Upstream `optionalString` keeps a string only when `length > 0` and drops
  // anything else, including a sequence, without rejecting the skill.
  if (typeof value === 'string' && value.length > 0) {
    return [];
  }

  return [
    warning(
      DSH_COMPATIBILITY_CODES.ignoredWhenToUse,
      'frontmatter key "whenToUse" is ignored by the pinned contract: it must be a non-empty string',
    ),
  ];
}

function metadataIssue(frontmatter: Record<string, unknown>): CompatibilityIssue[] {
  if (!Object.hasOwn(frontmatter, 'metadata')) {
    return [];
  }

  const value = frontmatter['metadata'];
  // Upstream `optionalMetadata` keeps an object that is neither null nor an
  // array, and silently drops everything else.
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return [];
  }

  return [
    warning(
      DSH_COMPATIBILITY_CODES.ignoredMetadata,
      'frontmatter key "metadata" is ignored by the pinned contract: it must be an object',
    ),
  ];
}

function invocationIssues(frontmatter: Record<string, unknown>): CompatibilityIssue[] {
  return resolveDshInvocationPolicy(frontmatter).problems.map((problem) =>
    problem.kind === 'legacy'
      ? error(DSH_COMPATIBILITY_CODES.legacyInvocationKey, problem.message)
      : error(DSH_COMPATIBILITY_CODES.invalidInvocationValue, problem.message),
  );
}

function unknownKeyIssues(frontmatter: Record<string, unknown>): CompatibilityIssue[] {
  // Sorted so the output cannot depend on hash or document ordering. Legacy
  // invocation keys are excluded: they are already reported as errors, and
  // calling the same key "ignored" at the same time would contradict that.
  return Object.keys(frontmatter)
    .filter((key) => !KNOWN_KEYS.has(key) && !DSH_LEGACY_INVOCATION_KEYS.has(key))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((key) =>
      warning(
        DSH_COMPATIBILITY_CODES.ignoredFrontmatterKey,
        `frontmatter key "${key}" is ignored by the pinned DSH contract`,
      ),
    );
}

function contentIssue(skill: ParsedSkill): CompatibilityIssue[] {
  // Upstream trims the body and only requires `content` to be a string, so an
  // empty body is accepted.
  if (skill.body.trim().length > 0) {
    return [];
  }

  return [
    warning(
      DSH_COMPATIBILITY_CODES.emptyContent,
      'the pinned contract accepts an empty Markdown body, so nothing is injected when the skill is loaded',
    ),
  ];
}

/**
 * Checks a parsed skill against the pinned DSH contract.
 *
 * Issue order is fixed and independent of input ordering: name, description,
 * whenToUse, metadata, invocation (legacy keys first), unknown keys sorted
 * alphabetically, then body content.
 *
 * @param skill A skill that already parsed successfully.
 * @returns Issues grouped by severity, the status and the overall result.
 */
export function validateDshCompatibility(skill: ParsedSkill): CompatibilityResult {
  const frontmatter = skill.frontmatter;
  const issues: CompatibilityIssue[] = [
    ...nameIssue(frontmatter),
    ...descriptionIssue(frontmatter),
    ...whenToUseIssue(frontmatter),
    ...metadataIssue(frontmatter),
    ...invocationIssues(frontmatter),
    ...unknownKeyIssues(frontmatter),
    ...contentIssue(skill),
  ];

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    compatible: errors.length === 0,
    status: compatibilityStatus(errors.length, warnings.length),
    errors,
    warnings,
    issues,
  };
}

function compatibilityStatus(
  errorCount: number,
  warningCount: number,
): CompatibilityResult['status'] {
  if (errorCount > 0) {
    return 'INCOMPATIBLE';
  }
  return warningCount > 0 ? 'COMPATIBLE_WITH_WARNINGS' : 'COMPATIBLE';
}
