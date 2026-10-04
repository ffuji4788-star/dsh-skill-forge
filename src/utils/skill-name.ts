/**
 * The single source of truth for skill name rules.
 *
 * Both the analyzer (`analyze`) and the validator (`validate`) use these
 * functions, so the two commands can never disagree about what a valid name is.
 * A name is also used as a directory and identifier component, which is why
 * path separators, traversal segments and control characters are rejected rather
 * than merely reported as unusual.
 */

/** Human-readable explanation of the accepted shape. */
export const KEBAB_CASE_EXPLANATION = 'expected lower-case words separated by single hyphens';

/**
 * Reports whether a literal name matches kebab-case.
 *
 * Kebab-case means lower-case alphanumeric segments separated by single
 * hyphens: `example-skill`, `skill2`, `a-b-c`. Under-scores, spaces, upper-case
 * letters, dots, slashes, leading/trailing hyphens and repeated hyphens are
 * rejected. This is a pure lexical check; see {@link findSkillNameProblem} for
 * the safety rules that also cover values whose length an author cannot see.
 *
 * @param name Candidate name.
 */
export function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/**
 * Reports whether a string contains a C0 control character or DEL.
 *
 * Implemented by code point rather than a regular expression so the check needs
 * no lint suppression.
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
 * Explains why a name cannot be used, or `undefined` when it is acceptable.
 *
 * @param name Candidate name.
 * @returns A human-readable reason, or `undefined` when the name is valid.
 */
export function findSkillNameProblem(name: string): string | undefined {
  if (name.includes('/') || name.includes('\\')) {
    return 'must not contain a path separator';
  }

  // Checked before the lexical rules so a hidden character is named as such
  // instead of reported as a generic format failure.
  if (containsControlCharacter(name)) {
    return 'must not contain control characters';
  }

  if (name === '.') {
    return 'must not be "."';
  }
  if (name === '..') {
    return 'must not be ".."';
  }

  if (!isKebabCase(name)) {
    return `is not kebab-case (${KEBAB_CASE_EXPLANATION})`;
  }

  return undefined;
}

/**
 * Builds the failure message shared by every check that applies
 * {@link findSkillNameProblem}.
 *
 * @param name The rejected name.
 * @param problem Reason returned by {@link findSkillNameProblem}.
 */
export function formatSkillNameProblem(name: string, problem: string): string {
  return `"${name}" ${problem}`;
}
