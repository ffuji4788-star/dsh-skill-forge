/**
 * Read-only compatibility assessment.
 *
 * Answers one question: "would this skill convert to the target as things stand?"
 * It never writes anything — no output directory, no staging directory, no
 * temporary package. That is the whole point: an assessment is a preflight, so it
 * must be safe to run against a skill whose conversion you are still deciding
 * about.
 *
 * The verdict comes from {@link planConversion}, the same planner the converter
 * runs, so an assessment cannot disagree with a conversion.
 */
import {
  planConversion,
  orderIssues,
  type ConversionStage,
  type StagedIssue,
} from '../conversion/conversion-plan.js';
import { GENERIC_LOCAL_SOURCE_ID } from '../conversion/source-adapter.js';

/** The overall verdict. */
export type AssessmentStatus = 'CONVERTIBLE' | 'REFUSED' | 'SOURCE_INVALID';

/** The verdict for one stage, or `SKIPPED` when it was never reached. */
export type AssessmentStageStatus = 'PASS' | 'REFUSED' | 'SKIPPED';

/** An assessment finding, ordered by `stage` then `code`. */
export type AssessmentIssue = StagedIssue;

/** The complete assessment of one skill. */
export interface AssessmentResult {
  /** Source adapter that was consulted, as named by the caller. */
  readonly source: string;
  readonly target: string;
  readonly status: AssessmentStatus;
  readonly stages: {
    readonly source: AssessmentStageStatus;
    readonly ir: AssessmentStageStatus;
    readonly semantic: AssessmentStageStatus;
    readonly resource: AssessmentStageStatus;
    readonly target: AssessmentStageStatus;
  };
  readonly issues: readonly AssessmentIssue[];
  /**
   * Semantic field names that would be carried in the tool-owned preservation
   * envelope, sorted. Reported so a reader knows a declaration is preserved
   * without being told the target understands it.
   */
  readonly preservedSemantics: readonly string[];
  /**
   * Which optional product sidecar the package carried.
   *
   * `undefined` when the source has no sidecar concept. Reported so a reader can
   * see that a Codex package's presentation config was accepted for opaque
   * preservation, or that a behavioural one refused the conversion.
   */
  readonly codexSidecar?: string;
}

export interface AssessOptions {
  /** Requested target identifier. */
  readonly target: string;
  /** Source adapter, or `undefined` for the generic local path. */
  readonly source?: string | undefined;
  /** Directory used to resolve a relative input path. */
  readonly cwd: string;
}

/** Renders one stage's verdict from the issues that stopped planning. */
function stageStatus(
  stage: ConversionStage,
  issues: readonly StagedIssue[],
  reached: boolean,
): AssessmentStageStatus {
  if (!reached) {
    return 'SKIPPED';
  }
  return issues.some((issue) => issue.stage === stage) ? 'REFUSED' : 'PASS';
}

/**
 * Assesses whether a skill converts, without writing anything.
 *
 * @param inputPath Skill file or directory; relative paths resolve against `cwd`.
 * @param options Target, source and directory context.
 * @returns The verdict, the per-stage statuses and every issue found.
 * @throws SkillInputError, AmbiguousSkillError or FrontmatterError for fatal input.
 */
export function assessSkill(inputPath: string, options: AssessOptions): AssessmentResult {
  const plan = planConversion(inputPath, {
    target: options.target,
    source: options.source,
    cwd: options.cwd,
  });

  const issues = orderIssues(plan.issues);

  // Once the source contract fails, nothing downstream could have been
  // interpreted, so reporting a later stage as "PASS" would be a lie. Those
  // stages are skipped instead.
  const sourceContractFailed = !plan.ok && plan.sourceContractFailed;
  const reached = (stage: ConversionStage): boolean => !sourceContractFailed || stage === 'SOURCE';

  const status: AssessmentStatus =
    issues.length === 0 ? 'CONVERTIBLE' : sourceContractFailed ? 'SOURCE_INVALID' : 'REFUSED';

  return {
    source: options.source ?? GENERIC_LOCAL_SOURCE_ID,
    target: options.target,
    status,
    stages: {
      source: stageStatus('SOURCE', issues, reached('SOURCE')),
      ir: stageStatus('IR', issues, reached('IR')),
      semantic: stageStatus('SEMANTIC', issues, reached('SEMANTIC')),
      resource: stageStatus('RESOURCE', issues, reached('RESOURCE')),
      target: stageStatus('TARGET', issues, reached('TARGET')),
    },
    issues,
    preservedSemantics: plan.ok ? Object.keys(plan.preservedSemantics).sort() : [],
    ...(plan.codexSidecar === undefined ? {} : { codexSidecar: plan.codexSidecar }),
  };
}

/**
 * Renders the human-readable assessment report.
 *
 * Only package-relative names appear: an absolute local source path is never
 * printed, so a report is safe to paste anywhere.
 *
 * @param result Assessment to render.
 * @returns The report text, newline-terminated.
 */
export function renderAssessmentReport(result: AssessmentResult): string {
  const lines = [
    'DSH Skill Assessment',
    '',
    'Source:',
    result.source,
    '',
    'Target:',
    result.target,
    '',
    'Result:',
    result.status,
    '',
    'Source Contract:',
    result.stages.source,
    '',
    'IR:',
    result.stages.ir,
    '',
    'Semantics:',
    result.stages.semantic,
    '',
    'Resources:',
    result.stages.resource,
    '',
    'Target Contract:',
    result.stages.target,
  ];

  if (result.preservedSemantics.length > 0) {
    lines.push(
      '',
      'Preserved Semantics:',
      ...result.preservedSemantics.map((field) => `  ${field}`),
      '  (carried verbatim in a tool-owned envelope; the target does not interpret it)',
    );
  }

  if (result.codexSidecar !== undefined) {
    lines.push('', 'Codex Sidecar:', result.codexSidecar);
    if (result.codexSidecar === 'INTERFACE_ONLY') {
      lines.push('  (presentation metadata only; the file is carried byte-for-byte)');
    } else if (result.codexSidecar === 'BEHAVIOURAL') {
      lines.push('  (declares behaviour the target cannot express; see the issues below)');
    } else if (result.codexSidecar === 'UNREADABLE') {
      lines.push('  (the file could not be read as product configuration; see the issues below)');
    }
  }

  if (result.issues.length > 0) {
    lines.push('', 'Issues:', '');
    for (const issue of result.issues) {
      lines.push(`[${issue.code}]`);
      lines.push(`  stage: ${issue.stage}`);
      lines.push(`  ${issue.message}`);
      if (issue.details !== undefined) {
        for (const detail of issue.details) {
          lines.push(`  - ${detail}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('', 'Convertible:', result.status === 'CONVERTIBLE' ? 'YES' : 'NO');

  return `${lines.join('\n')}\n`;
}
