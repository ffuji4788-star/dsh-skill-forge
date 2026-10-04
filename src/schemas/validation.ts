/**
 * Shapes for deterministic local skill validation.
 *
 * These describe the outcome of validating a skill that already parsed
 * successfully. A parse failure is a fatal error, not a validation issue: the
 * validator never receives a skill whose frontmatter could not be read.
 */

/** How serious a validation issue is. */
export type ValidationSeverity = 'error' | 'warning';

/**
 * A single validation finding.
 *
 * Deliberately minimal: no provider, target platform, compatibility, suggestion,
 * autofix, confidence or model fields, because Phase 2 validation is local and
 * deterministic.
 */
export interface ValidationIssue {
  /** Stable machine-readable identifier, for example `MISSING_NAME`. */
  readonly code: string;
  readonly severity: ValidationSeverity;
  /** Human-readable explanation. */
  readonly message: string;
}

/** The complete result of validating one skill. */
export interface ValidationResult {
  /** True when no issue has severity `error`. Warnings do not fail a skill. */
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  /** Every issue, in the deterministic order described by the validator. */
  readonly issues: readonly ValidationIssue[];
}
