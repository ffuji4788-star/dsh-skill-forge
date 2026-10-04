/**
 * Converts Universal Skill IR v1 into a DeepSeek Harness skill package.
 *
 * Guarantees, in order of importance:
 *
 * - **Lossless or refused.** Any non-core source frontmatter refuses the
 *   conversion; nothing is dropped or guessed at, and there is no lossy flag.
 * - **Non-destructive.** An existing output path is refused. There is no
 *   `--force`.
 * - **Atomic.** The package is written to a staging directory beside the output,
 *   fully verified, and only then renamed into place. A failed conversion leaves
 *   no output and cleans its staging directory.
 * - **Offline and inert.** No network, no subprocess, no resource execution, no
 *   writes anywhere except staging and the final output.
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

import {
  buildConversionResult,
  CONVERSION_CODES,
  type ConversionIssue,
  type ConversionResult,
} from '../schemas/conversion.js';
import { toSkillIRV2, type SourceProvenance } from '../ir/normalize-skill-v2.js';
import { SkillIRError } from '../ir/normalize-skill.js';
import { GENERIC_LOCAL_SKILL_FORMAT, type SkillIRV2 } from '../ir/skill-ir-v2.js';
import { validateDshCompatibility } from '../targets/dsh/dsh-compatibility-validator.js';
import {
  DSH_CONTRACT_VERIFIED_AT,
  DSH_TARGET_NAME,
  DSH_UPSTREAM_COMMIT,
  DSH_UPSTREAM_REPOSITORY,
} from '../targets/dsh/dsh-contract.js';
import {
  renderDshSkillMarkdownV2,
  unsupportedDshSemantics,
} from '../targets/dsh/dsh-target-adapter.js';
import { agentSkillsUpstreamReference } from '../sources/agent-skills/agent-skills-contract.js';
import { loadLocalSkill } from '../importers/local-importer.js';
import { validateBasicSkill } from '../validators/basic-skill-validator.js';
import { isAtOrBelow, isPathWithin } from '../utils/path-boundary.js';
import { collectResources } from './resource-collector.js';
import {
  GENERIC_LOCAL_SOURCE_ID,
  loadSourceSkill,
  SOURCE_CODES,
  type SourceIssue,
} from './source-adapter.js';

/** The only target this project supports. */
export const SUPPORTED_TARGET = 'dsh';

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
   * path, which is exactly the behaviour Phase 5 had.
   */
  readonly source?: string;
}

/**
 * Converts a source issue into a conversion issue.
 *
 * @param issues Source findings.
 */
function toConversionIssues(issues: readonly SourceIssue[]): ConversionIssue[] {
  return issues.map((issue) =>
    issue.details === undefined
      ? { code: issue.code, severity: issue.severity, message: issue.message }
      : {
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
          details: issue.details,
        },
  );
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
   * which is the unchanged Phase 5 behaviour.
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
 * Converts a local skill into a DSH package.
 *
 * @param inputPath Source skill file or directory.
 * @param outputPath Destination directory. Must not exist and must not be inside
 *   the source skill.
 * @param target Requested target; only `dsh` is supported.
 * @param options Directory used to resolve the source path.
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
    // Recorded before the source is resolved, so a failed selection is still
    // reported against the source the user asked for.
    source: options.source ?? GENERIC_LOCAL_SOURCE_ID,
    writtenPaths: [] as readonly string[],
  };

  if (target !== SUPPORTED_TARGET) {
    return refusal(base, [
      error(
        CONVERSION_CODES.unsupportedResource,
        `Unsupported target "${target}": this project can only convert to "${SUPPORTED_TARGET}"`,
      ),
    ]);
  }

  // The source is resolved through the selected adapter. A refusal here is a
  // deterministic outcome: an unknown source name, a package that does not have
  // the source's shape, or frontmatter that violates its contract.
  const loaded = loadSourceSkill(inputPath, options.source, cwd);
  if (!loaded.ok) {
    return refusal(base, toConversionIssues(loaded.issues));
  }

  const { skill, sourceRoot } = loaded;
  const resolvedBase = { ...base, sourceRoot };

  // Refuse before doing anything else, so a refusal never creates output.
  // Containment is checked first: an output equal to the source root also
  // "exists", but naming the real problem is more useful than reporting that the
  // source directory is in the way.
  if (isAtOrBelow(sourceRoot, absoluteOutput)) {
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

  // The generic validation gate is still applied after the source contract: a
  // skill can satisfy its own source and still be outside what the IR can
  // represent (a source-valid Unicode name, for example). That is reported
  // distinctly so it is never mistaken for a source adapter defect.
  const validation = validateBasicSkill(skill);
  if (!validation.valid) {
    if (options.source !== undefined) {
      return refusal(resolvedBase, [
        error(
          SOURCE_CODES.sourceValidIrUnsupported,
          `The skill satisfies the ${options.source} source contract but cannot be represented as Universal Skill IR. This is not a source adapter defect.`,
          validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
        ),
      ]);
    }

    return refusal(
      resolvedBase,
      validation.errors.map((issue) =>
        error(CONVERSION_CODES.generatedPackageInvalid, `${issue.code}: ${issue.message}`),
      ),
    );
  }

  // Conversion builds IR v2 internally. A source that offers no portable
  // semantics produces an empty `semantics`, which emits exactly the same
  // frontmatter v1 did, so the generic path stays byte-compatible.
  const provenance: SourceProvenance = {
    format: loaded.format ?? GENERIC_LOCAL_SKILL_FORMAT,
    ...(loaded.semantics === undefined ? {} : { semantics: loaded.semantics }),
  };

  let ir: SkillIRV2;
  try {
    ir = toSkillIRV2(skill, provenance, sourceRoot);
  } catch (thrown) {
    // A value that cannot be represented in canonical IR — an unsafe JSON key
    // such as `__proto__`, or a non-JSON value — is valid source the IR cannot
    // carry. That is a deterministic refusal, not a crash: the caller did nothing
    // wrong, and dropping the value silently would be worse than refusing.
    if (thrown instanceof SkillIRError) {
      return refusal(resolvedBase, [
        error(
          CONVERSION_CODES.unrepresentableIrValue,
          'A source value cannot be represented in the Universal Skill IR, so conversion is refused rather than dropping it',
          thrown.problems,
        ),
      ]);
    }
    throw thrown;
  }

  // Lossless or refused: uninterpreted source frontmatter has no mapping yet.
  const unmappedKeys = Object.keys(ir.source.extraFrontmatter);
  if (unmappedKeys.length > 0) {
    return refusal(resolvedBase, [
      error(
        CONVERSION_CODES.unmappedSourceFrontmatter,
        'Source frontmatter has no target mapping, so conversion is refused rather than dropping it',
        unmappedKeys,
      ),
    ]);
  }

  // Portable semantics the source *did* interpret but this target cannot express
  // are a different refusal from raw source data: the meaning is known, and it
  // simply has no counterpart here. Dropping or reinterpreting it would be a lie.
  const unsupportedSemantics = unsupportedDshSemantics(ir.semantics);
  if (unsupportedSemantics.length > 0) {
    return refusal(resolvedBase, [
      error(
        CONVERSION_CODES.unsupportedTargetSemantic,
        'Semantics were interpreted by the source but have no mapping in this target, so conversion is refused rather than dropping or reinterpreting them',
        unsupportedSemantics,
      ),
    ]);
  }

  const collected = collectResources(ir.resources, sourceRoot);
  if (collected.issues.length > 0) {
    return refusal(resolvedBase, collected.issues);
  }

  const entry = renderDshSkillMarkdownV2(ir);
  const plannedPaths = [
    entry.path,
    ...collected.nodes.filter((node) => node.kind === 'file').map((node) => node.destination),
  ].sort((left, right) => left.localeCompare(right, 'en'));

  const parentDirectory = path.dirname(absoluteOutput);
  mkdirSync(parentDirectory, { recursive: true });

  const stagingDirectory = mkdtempSync(path.join(parentDirectory, '.dsh-forge-staging-'));

  try {
    writeFileSync(path.join(stagingDirectory, entry.path), entry.content, { encoding: 'utf8' });

    for (const node of collected.nodes) {
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
