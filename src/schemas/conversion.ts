/**
 * Shapes for converting Universal Skill IR v1 into a target package.
 *
 * Phase 5 has exactly one target, so there is no adapter registry: the result
 * model only has to describe whether a conversion succeeded or was refused, and
 * why.
 */

/** How serious a conversion issue is. */
export type ConversionSeverity = 'error' | 'warning';

/** A single conversion finding. */
export interface ConversionIssue {
  /** Stable machine-readable identifier, for example `UNMAPPED_SOURCE_FRONTMATTER`. */
  readonly code: string;
  readonly severity: ConversionSeverity;
  readonly message: string;
  /** Optional list rendered under the message, for example unmapped field names. */
  readonly details?: readonly string[];
}

/** Codes emitted by the conversion pipeline. */
export const CONVERSION_CODES = {
  unmappedSourceFrontmatter: 'UNMAPPED_SOURCE_FRONTMATTER',
  unsupportedTargetSemantic: 'UNSUPPORTED_TARGET_SEMANTIC',
  unrepresentableIrValue: 'UNREPRESENTABLE_IR_VALUE',
  unsupportedTarget: 'UNSUPPORTED_TARGET',
  unsupportedResource: 'UNSUPPORTED_RESOURCE',
  duplicateResourceDestination: 'DUPLICATE_RESOURCE_DESTINATION',
  caseCollision: 'CASE_COLLISION',
  reservedResourceName: 'RESERVED_RESOURCE_NAME',
  outputAlreadyExists: 'OUTPUT_ALREADY_EXISTS',
  outputInsideSource: 'OUTPUT_INSIDE_SOURCE',
  resourceOutsideSource: 'RESOURCE_OUTSIDE_SOURCE',
  generatedPackageInvalid: 'GENERATED_PACKAGE_INVALID',
  targetCompatibilityFailed: 'TARGET_COMPATIBILITY_FAILED',
} as const;

/** The complete outcome of one conversion attempt. */
export interface ConversionResult {
  readonly converted: boolean;
  /** Absolute output directory; present only when the conversion succeeded. */
  readonly outputDirectory: string | undefined;
  /** Package-relative paths written, sorted. Empty when refused. */
  readonly writtenPaths: readonly string[];
  readonly errors: readonly ConversionIssue[];
  readonly warnings: readonly ConversionIssue[];
  readonly issues: readonly ConversionIssue[];
}

/** Builds a result from collected issues. */
export function buildConversionResult(
  issues: readonly ConversionIssue[],
  written: {
    readonly outputDirectory?: string;
    readonly writtenPaths?: readonly string[];
  } = {},
): ConversionResult {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const converted = errors.length === 0;

  return {
    converted,
    outputDirectory: converted ? written.outputDirectory : undefined,
    writtenPaths: converted ? (written.writtenPaths ?? []) : [],
    errors,
    warnings,
    issues,
  };
}
