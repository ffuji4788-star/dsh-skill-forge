/**
 * Deterministic local structural validation of a parsed skill.
 *
 * Validation answers "does this skill have the structure a skill must have?"
 * It does not judge DeepSeek Harness compatibility, prompt quality or semantics,
 * never touches the network, and never executes a skill's resources.
 *
 * Every rule is a pure function of the parsed skill, so the same input always
 * produces the same issues in the same order. Fatal problems (unreadable path,
 * ambiguous entry, malformed frontmatter) are raised as errors by the importer
 * and parser, not represented here.
 */
import type { ParsedSkill } from '../schemas/skill.js';
import type { ValidationIssue, ValidationResult } from '../schemas/validation.js';
import { findSkillNameProblem, formatSkillNameProblem } from '../utils/skill-name.js';

/** Issue codes emitted by the Phase 2 rules. */
export const VALIDATION_CODES = {
  missingName: 'MISSING_NAME',
  emptyName: 'EMPTY_NAME',
  invalidNameType: 'INVALID_NAME_TYPE',
  invalidName: 'INVALID_NAME',
  missingDescription: 'MISSING_DESCRIPTION',
  emptyDescription: 'EMPTY_DESCRIPTION',
  invalidDescriptionType: 'INVALID_DESCRIPTION_TYPE',
  emptyBody: 'EMPTY_BODY',
  unknownFrontmatterKey: 'UNKNOWN_FRONTMATTER_KEY',
} as const;

/**
 * Frontmatter keys this phase understands.
 *
 * An unlisted key is reported as a warning, never as an error: extra metadata is
 * common in skills from other ecosystems and is not a structural defect.
 */
export const KNOWN_FRONTMATTER_KEYS: ReadonlySet<string> = new Set(['name', 'description']);

/**
 * Reports whether a frontmatter key is present but unusable as a string.
 *
 * A key that is present but unusable is a different problem from a key that is
 * absent, and the two messages must not be confused: `name: 123` does have a
 * name, it simply cannot be used as one.
 *
 * `null` counts as unusable rather than absent because an empty YAML value and
 * an explicit `null` are indistinguishable once parsed (`name:` and
 * `name: null` both arrive as `null`), and a key that was written down is not
 * accurately described as missing. Only a key that is genuinely absent, or one
 * whose value is a valid string, reaches the missing-name branch.
 */
function hasUnusableValue(frontmatter: ParsedSkill['frontmatter'], key: string): boolean {
  return key in frontmatter && typeof frontmatter[key] !== 'string';
}

function nameIssues(skill: ParsedSkill): ValidationIssue[] {
  const { name } = skill;

  if (name === undefined) {
    if (hasUnusableValue(skill.frontmatter, 'name')) {
      return [
        {
          code: VALIDATION_CODES.invalidNameType,
          severity: 'error',
          message: 'Field "name" must be a string',
        },
      ];
    }

    return [
      {
        code: VALIDATION_CODES.missingName,
        severity: 'error',
        message: 'Missing required field: name',
      },
    ];
  }

  if (name.trim().length === 0) {
    return [
      {
        code: VALIDATION_CODES.emptyName,
        severity: 'error',
        message: 'Field "name" must not be empty',
      },
    ];
  }

  const problem = findSkillNameProblem(name);
  if (problem !== undefined) {
    return [
      {
        code: VALIDATION_CODES.invalidName,
        severity: 'error',
        message: `Invalid name: ${formatSkillNameProblem(name, problem)}`,
      },
    ];
  }

  return [];
}

function descriptionIssues(skill: ParsedSkill): ValidationIssue[] {
  const { description } = skill;

  if (description === undefined) {
    if (hasUnusableValue(skill.frontmatter, 'description')) {
      return [
        {
          code: VALIDATION_CODES.invalidDescriptionType,
          severity: 'error',
          message: 'Field "description" must be a string',
        },
      ];
    }

    return [
      {
        code: VALIDATION_CODES.missingDescription,
        severity: 'error',
        message: 'Missing required field: description',
      },
    ];
  }

  if (description.trim().length === 0) {
    return [
      {
        code: VALIDATION_CODES.emptyDescription,
        severity: 'error',
        message: 'Field "description" must not be empty or whitespace only',
      },
    ];
  }

  return [];
}

function bodyIssues(skill: ParsedSkill): ValidationIssue[] {
  if (skill.body.trim().length > 0) {
    return [];
  }

  return [
    {
      code: VALIDATION_CODES.emptyBody,
      severity: 'error',
      message: 'Skill body must not be empty',
    },
  ];
}

/**
 * Reports frontmatter keys this phase does not understand.
 *
 * Keys are reported in sorted order so the output cannot depend on hash or
 * filesystem ordering.
 */
function unknownKeyIssues(skill: ParsedSkill): ValidationIssue[] {
  return Object.keys(skill.frontmatter)
    .filter((key) => !KNOWN_FRONTMATTER_KEYS.has(key))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((key) => ({
      code: VALIDATION_CODES.unknownFrontmatterKey,
      severity: 'warning' as const,
      message: `Unknown frontmatter key: ${key}`,
    }));
}

/**
 * Validates a parsed skill against the Phase 2 structural rules.
 *
 * Issue order is fixed and independent of input ordering:
 * name, description, body, then unknown frontmatter keys sorted alphabetically.
 *
 * @param skill A skill that already parsed successfully.
 * @returns The issues, grouped by severity, plus the resulting validity.
 */
export function validateBasicSkill(skill: ParsedSkill): ValidationResult {
  const issues: ValidationIssue[] = [
    ...nameIssues(skill),
    ...descriptionIssues(skill),
    ...bodyIssues(skill),
    ...unknownKeyIssues(skill),
  ];

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
