/**
 * Agent Skills source validation.
 *
 * This is the source contract, not the generic structural rules and not the DSH
 * target contract. It mirrors `validate_metadata` in the pinned reference
 * validator (`skills-ref/src/skills_ref/validator.py`) so a skill that the
 * reference accepts is accepted here, and one it rejects is rejected here with an
 * equivalent reason.
 *
 * Two deliberate differences from the reference are recorded in
 * `docs/agent-skills-source-contract.md`:
 *
 * - the `license`, `metadata` and `allowed-tools` *types* are checked here, which
 *   the reference parser does not check; values are still only accepted or
 *   refused, never rewritten;
 * - an empty `name`/`description` is always an error, which is what the
 *   specification requires and what the reference achieves through its
 *   non-empty-string check.
 *
 * Nothing here reads the filesystem, executes anything, or touches the network.
 */
import type { SkillFrontmatter } from '../../parsers/frontmatter-parser.js';
import {
  AGENT_SKILLS_ALLOWED_FIELDS,
  AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH,
  AGENT_SKILLS_MAX_DESCRIPTION_LENGTH,
  AGENT_SKILLS_MAX_NAME_LENGTH,
} from './agent-skills-contract.js';

/** How serious an Agent Skills source finding is. */
export type AgentSkillSeverity = 'error' | 'warning';

/** A single source contract finding. */
export interface AgentSkillIssue {
  readonly code: string;
  readonly severity: AgentSkillSeverity;
  readonly message: string;
}

/** Stable codes emitted by the Agent Skills source contract. */
export const AGENT_SKILLS_CODES = {
  unknownFrontmatterKey: 'AGENT_SKILLS_UNKNOWN_FRONTMATTER_KEY',
  missingName: 'AGENT_SKILLS_MISSING_NAME',
  invalidNameType: 'AGENT_SKILLS_INVALID_NAME_TYPE',
  emptyName: 'AGENT_SKILLS_EMPTY_NAME',
  nameTooLong: 'AGENT_SKILLS_NAME_TOO_LONG',
  nameNotLowercase: 'AGENT_SKILLS_NAME_NOT_LOWERCASE',
  nameHyphenEdge: 'AGENT_SKILLS_NAME_HYPHEN_EDGE',
  nameConsecutiveHyphens: 'AGENT_SKILLS_NAME_CONSECUTIVE_HYPHENS',
  nameInvalidCharacters: 'AGENT_SKILLS_NAME_INVALID_CHARACTERS',
  nameDirectoryMismatch: 'AGENT_SKILLS_NAME_DIRECTORY_MISMATCH',
  missingDescription: 'AGENT_SKILLS_MISSING_DESCRIPTION',
  invalidDescriptionType: 'AGENT_SKILLS_INVALID_DESCRIPTION_TYPE',
  emptyDescription: 'AGENT_SKILLS_EMPTY_DESCRIPTION',
  descriptionTooLong: 'AGENT_SKILLS_DESCRIPTION_TOO_LONG',
  invalidCompatibilityType: 'AGENT_SKILLS_INVALID_COMPATIBILITY_TYPE',
  compatibilityTooLong: 'AGENT_SKILLS_COMPATIBILITY_TOO_LONG',
  invalidLicenseType: 'AGENT_SKILLS_INVALID_LICENSE_TYPE',
  invalidMetadataType: 'AGENT_SKILLS_INVALID_METADATA_TYPE',
  invalidMetadataValue: 'AGENT_SKILLS_INVALID_METADATA_VALUE',
  invalidAllowedToolsType: 'AGENT_SKILLS_INVALID_ALLOWED_TOOLS_TYPE',
} as const;

/** The result of validating one Agent Skills frontmatter mapping. */
export interface AgentSkillValidationResult {
  readonly valid: boolean;
  readonly errors: readonly AgentSkillIssue[];
  readonly warnings: readonly AgentSkillIssue[];
  readonly issues: readonly AgentSkillIssue[];
}

function error(code: string, message: string): AgentSkillIssue {
  return { code, severity: 'error', message };
}

function compareKeys(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

/**
 * Reports frontmatter keys the specification does not allow.
 *
 * The reference validator treats unexpected fields as errors, so this is an
 * error: a key neither the standard nor the target understands must stop the
 * source adapter rather than reach the DSH target as an unknown field.
 *
 * @param frontmatter Parsed frontmatter.
 * @returns One issue per unexpected key, sorted.
 */
function unknownKeyIssues(frontmatter: SkillFrontmatter): AgentSkillIssue[] {
  return Object.keys(frontmatter)
    .filter((key) => !AGENT_SKILLS_ALLOWED_FIELDS.has(key))
    .sort(compareKeys)
    .map((key) =>
      error(
        AGENT_SKILLS_CODES.unknownFrontmatterKey,
        `Unexpected frontmatter field: ${key}. Allowed fields are: ${[...AGENT_SKILLS_ALLOWED_FIELDS].sort(compareKeys).join(', ')}`,
      ),
    );
}

/**
 * Reads a required string field.
 *
 * @returns The trimmed value when the field holds a non-empty string, otherwise
 *   the issues describing why it cannot be used.
 */
function requiredString(
  frontmatter: SkillFrontmatter,
  key: 'name' | 'description',
  codes: { missing: string; invalidType: string; empty: string },
): { value: string } | { issues: AgentSkillIssue[] } {
  if (!(key in frontmatter)) {
    return { issues: [error(codes.missing, `Missing required field in frontmatter: ${key}`)] };
  }

  const raw = frontmatter[key];
  if (typeof raw !== 'string') {
    return { issues: [error(codes.invalidType, `Field '${key}' must be a string`)] };
  }

  const value = raw.trim();
  if (value.length === 0) {
    return { issues: [error(codes.empty, `Field '${key}' must be a non-empty string`)] };
  }

  return { value };
}

/**
 * Validates the `name` field against the specification.
 *
 * The reference normalizes with NFKC and then applies, in order: length limit,
 * lowercase, no leading or trailing hyphen, no consecutive hyphens, and only
 * alphanumeric-or-hyphen characters. It also requires the parent directory name
 * to match. The same order is used here.
 */
function nameIssues(name: string, directoryName: string | undefined): AgentSkillIssue[] {
  const issues: AgentSkillIssue[] = [];

  if (name.length > AGENT_SKILLS_MAX_NAME_LENGTH) {
    issues.push(
      error(
        AGENT_SKILLS_CODES.nameTooLong,
        `Skill name '${name}' exceeds ${AGENT_SKILLS_MAX_NAME_LENGTH} character limit (${name.length} chars)`,
      ),
    );
  }

  if (name !== name.toLowerCase()) {
    issues.push(
      error(AGENT_SKILLS_CODES.nameNotLowercase, `Skill name '${name}' must be lowercase`),
    );
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    issues.push(
      error(AGENT_SKILLS_CODES.nameHyphenEdge, 'Skill name cannot start or end with a hyphen'),
    );
  }

  if (name.includes('--')) {
    issues.push(
      error(
        AGENT_SKILLS_CODES.nameConsecutiveHyphens,
        'Skill name cannot contain consecutive hyphens',
      ),
    );
  }

  // Unicode-aware, matching Python's `str.isalnum()` exactly. Python accepts the
  // eight categories Ll, Lm, Lo, Lt, Lu, Nd, Nl and No; `\p{L}` covers the five
  // letter categories (including titlecase) and `\p{N}` covers the three number
  // ones, so listing them explicitly is documentation of an equality rather than
  // a widening of it.
  if (!/^[\p{L}\p{Lt}\p{N}\p{Nd}\p{Nl}\p{No}-]+$/u.test(name)) {
    issues.push(
      error(
        AGENT_SKILLS_CODES.nameInvalidCharacters,
        `Skill name '${name}' contains invalid characters. Only letters, digits, and hyphens are allowed.`,
      ),
    );
  }

  if (directoryName !== undefined && directoryName.normalize('NFKC') !== name) {
    issues.push(
      error(
        AGENT_SKILLS_CODES.nameDirectoryMismatch,
        `Directory name '${directoryName}' must match skill name '${name}'`,
      ),
    );
  }

  return issues;
}

function descriptionIssues(description: string): AgentSkillIssue[] {
  if (description.length > AGENT_SKILLS_MAX_DESCRIPTION_LENGTH) {
    return [
      error(
        AGENT_SKILLS_CODES.descriptionTooLong,
        `Description exceeds ${AGENT_SKILLS_MAX_DESCRIPTION_LENGTH} character limit (${description.length} chars)`,
      ),
    ];
  }
  return [];
}

function compatibilityIssues(value: unknown): AgentSkillIssue[] {
  if (typeof value !== 'string') {
    return [
      error(AGENT_SKILLS_CODES.invalidCompatibilityType, "Field 'compatibility' must be a string"),
    ];
  }
  if (value.length > AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH) {
    return [
      error(
        AGENT_SKILLS_CODES.compatibilityTooLong,
        `Compatibility exceeds ${AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH} character limit (${value.length} chars)`,
      ),
    ];
  }
  return [];
}

/**
 * Validates the optional fields the reference parser does not type-check.
 *
 * The specification describes `license` and `allowed-tools` as strings and
 * `metadata` as a map from string keys to string values. A value of the wrong
 * shape is refused rather than kept, because a guess about what it meant would
 * end up in the IR as if it were understood.
 */
function optionalFieldIssues(frontmatter: SkillFrontmatter): AgentSkillIssue[] {
  const issues: AgentSkillIssue[] = [];

  if ('license' in frontmatter && typeof frontmatter['license'] !== 'string') {
    issues.push(error(AGENT_SKILLS_CODES.invalidLicenseType, "Field 'license' must be a string"));
  }

  if ('allowed-tools' in frontmatter && typeof frontmatter['allowed-tools'] !== 'string') {
    issues.push(
      error(AGENT_SKILLS_CODES.invalidAllowedToolsType, "Field 'allowed-tools' must be a string"),
    );
  }

  if ('metadata' in frontmatter) {
    const metadata = frontmatter['metadata'];
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      Array.isArray(metadata) ||
      Object.getPrototypeOf(metadata) !== Object.prototype
    ) {
      issues.push(
        error(
          AGENT_SKILLS_CODES.invalidMetadataType,
          "Field 'metadata' must be a mapping of strings to strings",
        ),
      );
    } else {
      const badValue = Object.entries(metadata as Record<string, unknown>).find(
        ([, value]) => typeof value !== 'string',
      );
      if (badValue !== undefined) {
        issues.push(
          error(
            AGENT_SKILLS_CODES.invalidMetadataValue,
            `Field 'metadata.${badValue[0]}' must be a string`,
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * Validates Agent Skills frontmatter.
 *
 * Issue order is fixed and independent of key ordering: unexpected fields
 * (sorted), then name, description, compatibility, and finally the optional
 * fields the reference parser leaves unchecked.
 *
 * @param frontmatter Parsed frontmatter mapping.
 * @param directoryName Name of the skill directory, when the source was a directory.
 * @returns The issues, grouped by severity, plus the resulting validity.
 */
export function validateAgentSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  directoryName?: string,
): AgentSkillValidationResult {
  const issues: AgentSkillIssue[] = [...unknownKeyIssues(frontmatter)];

  const name = requiredString(frontmatter, 'name', {
    missing: AGENT_SKILLS_CODES.missingName,
    invalidType: AGENT_SKILLS_CODES.invalidNameType,
    empty: AGENT_SKILLS_CODES.emptyName,
  });

  if ('issues' in name) {
    issues.push(...name.issues);
  } else {
    issues.push(...nameIssues(name.value.normalize('NFKC'), directoryName));
  }

  const description = requiredString(frontmatter, 'description', {
    missing: AGENT_SKILLS_CODES.missingDescription,
    invalidType: AGENT_SKILLS_CODES.invalidDescriptionType,
    empty: AGENT_SKILLS_CODES.emptyDescription,
  });

  if ('issues' in description) {
    issues.push(...description.issues);
  } else {
    issues.push(...descriptionIssues(description.value));
  }

  if ('compatibility' in frontmatter) {
    issues.push(...compatibilityIssues(frontmatter['compatibility']));
  }

  issues.push(...optionalFieldIssues(frontmatter));

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return { valid: errors.length === 0, errors, warnings, issues };
}
