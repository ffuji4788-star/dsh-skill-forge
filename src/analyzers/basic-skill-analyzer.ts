/**
 * Basic skill analysis.
 *
 * This reports what a skill declares about itself. It makes no judgement about
 * DeepSeek Harness compatibility, does not parse any other skill ecosystem's
 * conventions and never executes a skill's resources.
 */
import type { ParsedSkill } from '../schemas/skill.js';
import { findSkillNameProblem, formatSkillNameProblem, isKebabCase } from '../utils/skill-name.js';

// Re-exported so existing callers of the analyzer keep working; the rule itself
// lives in `utils/skill-name.ts` as the single source of truth.
export { isKebabCase };

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

  const problem = findSkillNameProblem(name);
  if (problem !== undefined) {
    return { passed: false, message: formatSkillNameProblem(name, problem) };
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
