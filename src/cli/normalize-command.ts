/**
 * The `normalize` command: read a skill and emit its canonical Universal Skill IR.
 *
 * stdout carries the JSON document and nothing else, so a shell redirect yields a
 * valid file. Problems go to stderr and are reflected in the exit code.
 *
 * IR v1 is the default and stays frozen: with no `--ir-version`, the output for a
 * given input is byte-identical to what it was before v2 existed. v2 is produced
 * only when asked for, and a source is consulted only when named — neither the
 * version nor the source is ever inferred.
 */
import path from 'node:path';

import { loadSourceSkill } from '../conversion/source-adapter.js';
import { loadLocalSkill } from '../importers/local-importer.js';
import { GENERIC_LOCAL_SKILL_FORMAT, SKILL_IR_V2_SCHEMA_VERSION } from '../ir/skill-ir-v2.js';
import { toSkillIR, SkillIRError, SkillNotNormalizableError } from '../ir/normalize-skill.js';
import { toSkillIRV2, type SourceProvenance } from '../ir/normalize-skill-v2.js';
import { serializeSkillIR } from '../ir/serialize-skill-ir.js';
import { serializeSkillIRV2 } from '../ir/serialize-skill-ir-v2.js';
import { validateBasicSkill } from '../validators/basic-skill-validator.js';
import { formatErrorMessage } from '../utils/error-message.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../utils/exit-codes.js';

/** The IR version `normalize` emits when no version is requested. */
export const DEFAULT_IR_VERSION = 1;

/** IR versions this command can emit. */
export const SUPPORTED_IR_VERSIONS: readonly number[] = [
  DEFAULT_IR_VERSION,
  SKILL_IR_V2_SCHEMA_VERSION,
];

export interface RunNormalizeOptions {
  /** Directory used to resolve the input path. Defaults to the process cwd. */
  readonly cwd?: string;
  /** IR version to emit. Defaults to {@link DEFAULT_IR_VERSION}. */
  readonly irVersion?: number;
  /**
   * Source adapter selected with `--source`. `undefined` keeps the generic local
   * path, so omitting the option cannot change an existing result.
   */
  readonly source?: string;
  /** Sink for the canonical IR JSON. Defaults to `process.stdout.write`. */
  readonly writeOut?: (text: string) => void;
  /** Sink for problem messages. Defaults to `process.stderr.write`. */
  readonly writeErr?: (text: string) => void;
}

/**
 * Renders the refusal message for a skill that failed the generic gate.
 *
 * The gate is a deliberate IR invariant, so the message says why no IR was
 * produced instead of implying a tool failure. Validation is not re-implemented
 * here: the issues come from the Phase 2 validator.
 */
function renderRefusal(error: SkillNotNormalizableError): string {
  const lines = [`dsh-forge: ${error.message}`, `Errors: ${error.validation.errors.length}`];
  for (const issue of error.validation.errors) {
    lines.push(`- ${issue.code}: ${issue.message}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Renders the refusal for a source that could not be read as a skill. */
function renderSourceRefusal(source: string, messages: readonly string[]): string {
  const lines = [`dsh-forge: cannot read the skill from source "${source}"`];
  for (const message of messages) {
    lines.push(`- ${message}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Normalizes a skill and writes its canonical IR to stdout.
 *
 * @param inputPath File or directory to normalize.
 * @param options Output sinks, directory context, IR version and source.
 * @returns `0` on success, `2` when the skill is refused.
 * @throws SkillInputError, AmbiguousSkillError, FrontmatterError or SkillIRError.
 */
export function runNormalize(inputPath: string, options: RunNormalizeOptions = {}): number {
  const writeOut = options.writeOut ?? ((text: string): void => void process.stdout.write(text));
  const writeErr = options.writeErr ?? ((text: string): void => void process.stderr.write(text));
  const cwd = options.cwd ?? process.cwd();
  const irVersion = options.irVersion ?? DEFAULT_IR_VERSION;

  if (!SUPPORTED_IR_VERSIONS.includes(irVersion)) {
    writeErr(
      `dsh-forge: unsupported IR version ${irVersion}. Supported versions are: ${SUPPORTED_IR_VERSIONS.join(', ')}\n`,
    );
    return EXIT_VALIDATION_FAILED;
  }

  try {
    if (options.source === undefined) {
      // The generic path interprets nothing, so a named source is required for
      // any semantic lifting. It reads through the generic importer directly, so
      // a missing path, an ambiguous directory and malformed frontmatter stay
      // fatal exactly as they were before a source adapter existed, and v1 output
      // keeps flowing through the frozen v1 normalizer.
      const loaded = loadLocalSkill(path.resolve(cwd, inputPath));
      const sourceRoot = path.dirname(loaded.entryFile);

      // The generic validation gate is an IR invariant in both versions: a skill
      // that fails it produces no document at all.
      const gate = validateBasicSkill(loaded);
      if (!gate.valid) {
        throw new SkillNotNormalizableError(gate);
      }

      writeOut(
        irVersion === 1
          ? serializeSkillIR(toSkillIR(loaded, sourceRoot))
          : serializeSkillIRV2(
              toSkillIRV2(loaded, { format: GENERIC_LOCAL_SKILL_FORMAT }, sourceRoot),
            ),
      );
      return EXIT_SUCCESS;
    }

    const loaded = loadSourceSkill(inputPath, options.source, cwd);
    if (!loaded.ok) {
      writeErr(
        renderSourceRefusal(
          loaded.source,
          loaded.issues.map((issue) => `${issue.code}: ${issue.message}`),
        ),
      );
      return EXIT_VALIDATION_FAILED;
    }

    const provenance: SourceProvenance = {
      format: loaded.format ?? GENERIC_LOCAL_SKILL_FORMAT,
      ...(loaded.semantics === undefined ? {} : { semantics: loaded.semantics }),
    };

    if (irVersion === 1) {
      // v1 carries no semantics, so every interpreted field is preserved as raw
      // source data by the frozen v1 normalizer.
      const gate = validateBasicSkill(loaded.skill);
      if (!gate.valid) {
        throw new SkillNotNormalizableError(gate);
      }
      writeOut(serializeSkillIR(toSkillIR(loaded.skill, loaded.sourceRoot)));
      return EXIT_SUCCESS;
    }

    const gate = validateBasicSkill(loaded.skill);
    if (!gate.valid) {
      throw new SkillNotNormalizableError(gate);
    }
    writeOut(serializeSkillIRV2(toSkillIRV2(loaded.skill, provenance, loaded.sourceRoot)));
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof SkillNotNormalizableError) {
      writeErr(renderRefusal(error));
      return EXIT_VALIDATION_FAILED;
    }
    if (error instanceof SkillIRError) {
      writeErr(`dsh-forge: ${formatErrorMessage(error)}\n`);
      return EXIT_FATAL;
    }
    // Unreadable input, malformed frontmatter and ambiguity are fatal: one
    // readable line on stderr, no partial document on stdout. Re-thrown so the
    // CLI boundary maps it consistently with the other commands.
    throw error;
  }
}
