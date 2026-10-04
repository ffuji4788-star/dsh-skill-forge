/**
 * Basic skill analysis.
 *
 * This reports what a skill declares about itself. It makes no judgement about
 * DeepSeek Harness compatibility, does not parse any other skill ecosystem's
 * conventions and never executes a skill's resources.
 */
import type { ParsedSkill } from '../schemas/skill.js';

/** Outcome of a single check. */
export interface SkillCheck {
  readonly passed: boolean;
  /** Human-readable explanation, present when the check did not pass. */
  readonly message?: string;
}

export interface SkillAnalysis {
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly entryFile: string;
  readonly sourceType: 'file' | 'directory';
  /** Number of files beside the entry. */
  readonly resourceCount: number;
  readonly resources: readonly string[];
  /** Markdown body length, excluding the frontmatter block. */
  readonly bodyLength: number;
  /** Frontmatter keys in document order. */
  readonly frontmatterKeys: readonly string[];
  readonly checks: {
    readonly name: SkillCheck;
    readonly description: SkillCheck;
    readonly kebabCase: SkillCheck;
  };
}

/**
 * Reports whether a name is kebab-case.
 *
 * Kebab-case here means lower-case alphanumeric segments separated by single
 * hyphens: `example-skill`, `skill2`, `a-b-c`. Underscores, spaces, upper-case
 * letters, leading/trailing hyphens and repeated hyphens are rejected.
 *
 * @param name Candidate name.
 */
export function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function checkName(name: string | undefined): SkillCheck {
  if (name === undefined) {
    return { passed: false, message: 'missing (frontmatter has no string "name")' };
  }
  if (name.trim().length === 0) {
    return { passed: false, message: 'present but empty' };
  }
  return { passed: true };
}

function checkDescription(description: string | undefined): SkillCheck {
  if (description === undefined) {
    return { passed: false, message: 'missing (frontmatter has no string "description")' };
  }
  if (description.trim().length === 0) {
    return { passed: false, message: 'present but empty' };
  }
  return { passed: true };
}

function checkKebabCase(name: string | undefined): SkillCheck {
  if (name === undefined || name.trim().length === 0) {
    return { passed: false, message: 'not applicable (no name to check)' };
  }
  if (!isKebabCase(name)) {
    return {
      passed: false,
      message: `"${name}" is not kebab-case (expected lower-case words separated by single hyphens)`,
    };
  }
  return { passed: true };
}

/**
 * Analyzes a parsed skill.
 *
 * @param skill Skill read from a local source.
 * @returns Counts, frontmatter keys and the basic checks.
 */
export function analyzeBasicSkill(skill: ParsedSkill): SkillAnalysis {
  return {
    name: skill.name,
    description: skill.description,
    entryFile: skill.entryFile,
    sourceType: skill.sourceType,
    resourceCount: skill.resources.length,
    resources: skill.resources,
    bodyLength: skill.body.trim().length,
    frontmatterKeys: Object.keys(skill.frontmatter),
    checks: {
      name: checkName(skill.name),
      description: checkDescription(skill.description),
      kebabCase: checkKebabCase(skill.name),
    },
  };
}
