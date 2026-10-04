/**
 * Path containment checks shared by every module that must not escape a
 * boundary directory.
 *
 * `path.relative` alone is not sufficient on Windows: it returns an absolute
 * path when the two paths have different roots, which is not a nesting
 * relationship. This module owns that rule so filesystem boundaries are checked
 * one way rather than re-derived per call site.
 */
import path from 'node:path';

/**
 * Reports whether `candidate` is `boundary` itself or nested inside it.
 *
 * Comparison is case-insensitive on Windows, where filesystems are normally
 * case-insensitive, so a differently-cased spelling of the boundary is still
 * recognised as the same directory.
 *
 * @param boundary Directory that must contain the candidate.
 * @param candidate Path to test.
 * @returns True when the candidate is the boundary or inside it.
 */
export function isAtOrBelow(boundary: string, candidate: string): boolean {
  const resolvedBoundary = path.resolve(boundary);
  const resolvedCandidate = path.resolve(candidate);

  const normalize = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value;

  const relative = path.relative(normalize(resolvedBoundary), normalize(resolvedCandidate));
  if (relative === '') {
    return true;
  }
  return !path.isAbsolute(relative) && !relative.startsWith('..');
}

/**
 * Reports whether `candidate` is strictly inside `boundary`.
 *
 * @param boundary Directory that must contain the candidate.
 * @param candidate Path to test.
 * @returns True when the candidate is inside the boundary but not equal to it.
 */
export function isPathWithin(boundary: string, candidate: string): boolean {
  return isAtOrBelow(boundary, candidate) && path.resolve(boundary) !== path.resolve(candidate);
}
