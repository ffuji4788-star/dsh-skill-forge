/**
 * Converts a skill into a DeepSeek Harness skill package.
 *
 * Guarantees, in order of importance:
 *
 * - **Lossless or refused.** A source value the target cannot carry faithfully
 *   refuses the conversion; nothing is dropped or guessed at, and there is no
 *   lossy flag.
 * - **Non-destructive.** An existing output path is refused. There is no
 *   `--force`.
 * - **Atomic.** The package is written to a staging directory beside the output,
 *   fully verified, and only then renamed into place. A failed conversion leaves
 *   no output and cleans its staging directory.
 * - **Offline and inert.** No network, no subprocess, no resource execution, no
 *   writes anywhere except staging and the final output.
 *
 * Every decision about *whether* a skill converts lives in
 * {@link planConversion}, which this module shares with `assess`. This file only
 * adds the output-path checks and the write.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { planConversion } from './conversion-plan.js';
import { collectResources } from './resource-collector.js';
import {
  buildConversionResult,
  CONVERSION_CODES,
  type ConversionIssue,
  type ConversionResult,
} from '../schemas/conversion.js';
import { validateDshCompatibility } from '../targets/dsh/dsh-compatibility-validator.js';
import {
  DSH_CONTRACT_VERIFIED_AT,
  DSH_TARGET_NAME,
  DSH_UPSTREAM_COMMIT,
  DSH_UPSTREAM_REPOSITORY,
} from '../targets/dsh/dsh-contract.js';
import { agentSkillsUpstreamReference } from '../sources/agent-skills/agent-skills-contract.js';
import { loadLocalSkill } from '../importers/local-importer.js';
import { validateBasicSkill } from '../validators/basic-skill-validator.js';
import { isAtOrBelow, isPathWithin } from '../utils/path-boundary.js';
import { GENERIC_LOCAL_SOURCE_ID } from './source-adapter.js';
import { SUPPORTED_TARGET } from './target-id.js';

export { SUPPORTED_TARGET };

/** The short upstream reference a converted package is measured against. */
export function targetContractReference(): string {
  const slug = DSH_UPSTREAM_REPOSITORY.replace('https://github.com/', '');
  return `${slug}@${DSH_UPSTREAM_COMMIT.slice(0, 12)}`;
}

export interface ConvertOptions {
  /** Directory used to resolve the source path. Defaults to the process cwd. */
  readonly cwd?: string;
  /**
   * Source adapter to read the skill with. `undefined` uses the generic local
   * path.
   */
  readonly source?: string;
}

/** Everything a caller needs to report a conversion. */
export interface ConvertOutcome {
  readonly result: ConversionResult;
  /** Absolute source skill root, for display only. Never written into the package. */
  readonly sourceRoot: string;
  /** Absolute requested output path. */
  readonly outputDirectory: string;
  readonly target: string;
  /**
   * Source adapter that was used. `generic-local` means no `--source` was given,
   * which is the unchanged default behaviour.
   */
  readonly source: string;
  /** Rendered plan preview, used by the report. */
  readonly writtenPaths: readonly string[];
}

function error(code: string, message: string, details?: readonly string[]): ConversionIssue {
  return details === undefined
    ? { code, severity: 'error', message }
    : { code, severity: 'error', message, details };
}

function refusal(
  outcome: Omit<ConvertOutcome, 'result'>,
  issues: readonly ConversionIssue[],
): ConvertOutcome {
  return { ...outcome, result: buildConversionResult(issues) };
}

/**
 * A short, non-busy pause used between rename attempts.
 *
 * @param milliseconds How long to wait.
 */
function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Error codes that mean "try again shortly", not "this is impossible". */
const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Renames the staging directory into place, retrying a transient refusal.
 *
 * @param stagingDirectory Absolute staging path.
 * @param finalDirectory Absolute destination path, which must not exist.
 * @throws Error when the rename keeps failing; the caller's `finally` cleans staging.
 */
function renameWithRetry(stagingDirectory: string, finalDirectory: string): void {
  const attempts = 10;

  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(stagingDirectory, finalDirectory);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= attempts || !TRANSIENT_RENAME_CODES.has(code)) {
        throw new Error(
          `Unable to finalize the generated package: rename failed with ${code === '' ? 'an unknown error' : code}`,
          { cause: error },
        );
      }
      sleep(20);
    }
  }
}

/**
 * Converts a skill into a DSH package.
 *
 * @param inputPath Source skill file or directory.
 * @param outputPath Destination directory. Must not exist and must not be inside
 *   the source skill.
 * @param target Requested target; only `dsh` is supported.
 * @param options Directory used to resolve the source path, and the source adapter.
 * @returns The outcome, including whether anything was written.
 * @throws SkillInputError, AmbiguousSkillError or FrontmatterError for fatal input.
 */
export function convertSkillToTarget(
  inputPath: string,
  outputPath: string,
  target: string,
  options: ConvertOptions = {},
): ConvertOutcome {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const absoluteOutput = path.resolve(cwd, outputPath);

  const base = {
    sourceRoot: cwd,
    outputDirectory: absoluteOutput,
    target,
    source: options.source ?? GENERIC_LOCAL_SOURCE_ID,
    writtenPaths: [] as readonly string[],
  };

  // The target is checked before anything is read, so an unsupported target is
  // reported even when the input path does not exist.
  if (target !== SUPPORTED_TARGET) {
    return refusal(base, [
      error(
        CONVERSION_CODES.unsupportedTarget,
        `Unsupported target "${target}": this project can only convert to "${SUPPORTED_TARGET}"`,
      ),
    ]);
  }

  const plan = planConversion(inputPath, {
    target,
    source: options.source,
    cwd,
  });

  if (!plan.ok) {
    const resolvedBase = { ...base, sourceRoot: plan.sourceRoot ?? base.sourceRoot };
    return refusal(
      resolvedBase,
      plan.issues.map((issue) =>
        error(issue.code, issue.message, issue.details === undefined ? undefined : issue.details),
      ),
    );
  }

  const resolvedBase = { ...base, sourceRoot: plan.sourceRoot };

  // Output-path checks belong to the write step, not to planning: an assessment
  // of a skill must not depend on where someone wants the package.
  if (isAtOrBelow(plan.sourceRoot, absoluteOutput)) {
    return refusal(resolvedBase, [
      error(
        CONVERSION_CODES.outputInsideSource,
        'Output directory must not be the source skill root or inside it',
      ),
    ]);
  }

  if (existsSync(absoluteOutput)) {
    return refusal(resolvedBase, [
      error(
        CONVERSION_CODES.outputAlreadyExists,
        `Output path already exists and is never overwritten: ${outputPath}`,
      ),
    ]);
  }

  const plannedPaths = [...plan.plannedPaths];
  const parentDirectory = path.dirname(absoluteOutput);
  mkdirSync(parentDirectory, { recursive: true });

  const stagingDirectory = mkdtempSync(path.join(parentDirectory, '.dsh-forge-staging-'));

  try {
    writeFileSync(path.join(stagingDirectory, plan.entry.path), plan.entry.content, {
      encoding: 'utf8',
    });

    for (const node of plan.resources.nodes) {
      if (node.kind === 'directory') {
        continue;
      }

      const destination = path.resolve(stagingDirectory, node.destination);
      if (!isPathWithin(stagingDirectory, destination)) {
        return refusal(resolvedBase, [
          error(
            CONVERSION_CODES.resourceOutsideSource,
            `Resource "${node.destination}" would be written outside the package`,
          ),
        ]);
      }

      // Byte-for-byte copy: never interpreted, never re-encoded, never executed.
      const contents = readFileSync(node.sourcePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, contents);
    }

    const verificationIssues = verifyGeneratedPackage(stagingDirectory);
    if (verificationIssues.length > 0) {
      return refusal(resolvedBase, verificationIssues);
    }

    // On Windows a scanner can briefly hold a freshly written script resource,
    // which makes the directory rename fail with EPERM even though nothing is
    // wrong with the package. Retrying keeps the atomic finalize reliable
    // instead of turning an environmental race into a failed conversion.
    renameWithRetry(stagingDirectory, absoluteOutput);
  } finally {
    // A successful rename moves the directory away, so this only removes a
    // staging directory that is still present after a failure.
    rmSync(stagingDirectory, { recursive: true, force: true });
  }

  return {
    ...resolvedBase,
    writtenPaths: plannedPaths,
    result: buildConversionResult([], {
      outputDirectory: absoluteOutput,
      writtenPaths: plannedPaths,
    }),
  };
}

/**
 * Re-reads a staged package with the project's own pipeline and checks that it
 * is a clean DSH skill.
 *
 * Self-generated output must be clean: any generic validation error or DSH
 * warning means the emitter is wrong, so it is an error here rather than
 * something to tolerate.
 *
 * @param stagingDirectory Absolute staging directory holding the package.
 * @returns Refusal issues; empty when the package is clean.
 */
export function verifyGeneratedPackage(stagingDirectory: string): ConversionIssue[] {
  const issues: ConversionIssue[] = [];

  const skill = loadLocalSkill(path.join(stagingDirectory, 'SKILL.md'));
  const validation = validateBasicSkill(skill);
  for (const issue of validation.errors) {
    issues.push(
      error(
        CONVERSION_CODES.generatedPackageInvalid,
        `Generated package failed generic validation: ${issue.code}: ${issue.message}`,
      ),
    );
  }

  const compatibility = validateDshCompatibility(skill);
  for (const issue of compatibility.errors) {
    issues.push(
      error(
        CONVERSION_CODES.targetCompatibilityFailed,
        `Generated package is not compatible with the pinned contract: ${issue.code}: ${issue.message}`,
      ),
    );
  }
  for (const issue of compatibility.warnings) {
    issues.push(
      error(
        CONVERSION_CODES.generatedPackageInvalid,
        `Generated package carries a warning the emitter should not produce: ${issue.code}: ${issue.message}`,
      ),
    );
  }

  return issues;
}

/** Renders the conversion report shown to a user. */
export function renderConversionReport(
  outcome: ConvertOutcome,
  options: { readonly baseDirectory: string },
): string {
  const relativeSource = path
    .relative(options.baseDirectory, outcome.sourceRoot)
    .split(path.sep)
    .join('/');

  if (!outcome.result.converted) {
    const lines = ['DSH Conversion', '', 'Result: REFUSED', '', 'Conversion Refused', ''];
    // The order is the order the plan produced, which is already staged and
    // sorted; re-sorting here would change an existing report.
    for (const issue of outcome.result.errors) {
      lines.push(`${issue.code}:`);
      lines.push(`  ${issue.message}`);
      if (issue.details !== undefined) {
        for (const detail of issue.details) {
          lines.push(`  - ${detail}`);
        }
      }
    }
    lines.push('', 'No output was created.');
    return `${lines.join('\n')}\n`;
  }

  const lines = [
    'DSH Conversion',
    '',
    `Target: ${DSH_TARGET_NAME}`,
    `Contract: ${targetContractReference()}`,
    `Contract verified: ${DSH_CONTRACT_VERIFIED_AT}`,
    '',
    `Source: ${relativeSource.length === 0 ? '.' : relativeSource}`,
    `Source adapter: ${outcome.source}`,
    ...(outcome.source === GENERIC_LOCAL_SOURCE_ID
      ? []
      : [`Source contract: ${agentSkillsUpstreamReference()}`]),
    `Output: ${outcome.outputDirectory}`,
    '',
    'Result: SUCCESS',
    `Files: ${outcome.writtenPaths.length}`,
  ];

  for (const written of outcome.writtenPaths) {
    lines.push(`  ${written}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Kept exported for callers that need the collector without a conversion. */
export { collectResources };
