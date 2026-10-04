/**
 * Shapes for DeepSeek Harness compatibility reporting.
 *
 * Separate from `schemas/validation.ts` on purpose: a generic structural
 * problem and a target-contract problem mean different things, and merging them
 * would blur "is this skill well formed?" with "would the pinned DSH
 * implementation accept it?".
 */

/** How serious a compatibility issue is for the pinned target. */
export type CompatibilitySeverity = 'error' | 'warning';

/**
 * A single compatibility finding.
 *
 * Deliberately minimal: no autofix, suggestion, confidence or model fields. Only
 * what the pinned contract justifies.
 */
export interface CompatibilityIssue {
  /** Stable machine-readable identifier, for example `DSH_INVALID_NAME`. */
  readonly code: string;
  readonly severity: CompatibilitySeverity;
  /** Human-readable explanation, phrased against the pinned contract. */
  readonly message: string;
}

/** The three outcomes a compatibility check can produce. */
export type CompatibilityStatus = 'COMPATIBLE' | 'COMPATIBLE_WITH_WARNINGS' | 'INCOMPATIBLE';

/** The complete result of checking one skill against the pinned contract. */
export interface CompatibilityResult {
  /** True when no issue has severity `error`. Warnings do not fail a skill. */
  readonly compatible: boolean;
  readonly status: CompatibilityStatus;
  readonly errors: readonly CompatibilityIssue[];
  readonly warnings: readonly CompatibilityIssue[];
  /** Every issue, in the deterministic order described by the validator. */
  readonly issues: readonly CompatibilityIssue[];
}
