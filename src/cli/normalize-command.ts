/**
 * The `normalize` command: read a structurally valid local skill and emit its
 * canonical Universal Skill IR v1 on stdout.
 *
 * stdout carries the JSON document and nothing else, so a shell redirect yields a
 * valid file. Problems go to stderr and are reflected in the exit code.
 */
import { formatErrorMessage } from '../utils/error-message.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../utils/exit-codes.js';
import { normalizeSkill, SkillNotNormalizableError, SkillIRError } from '../ir/normalize-skill.js';
import { serializeSkillIR } from '../ir/serialize-skill-ir.js';

export interface RunNormalizeOptions {
  /** Directory used to resolve the input path. Defaults to the process cwd. */
  readonly cwd?: string;
  /** Sink for the canonical IR JSON. Defaults to `process.stdout.write`. */
  readonly writeOut?: (text: string) => void;
  /** Sink for problem messages. Defaults to `process.stderr.write`. */
  readonly writeErr?: (text: string) => void;
}

/**
 * Renders the refusal message for a skill that failed the generic gate.
 *
 * The gate is a deliberate IR v1 invariant, so the message says why no IR was
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

/**
 * Normalizes a skill and writes its canonical IR to stdout.
 *
 * @param inputPath File or directory to normalize.
 * @param options Output sinks and directory context.
 * @returns `0` on success, `2` when the generic validation gate refuses the skill.
 * @throws SkillInputError, AmbiguousSkillError, FrontmatterError or SkillIRError.
 */
export function runNormalize(inputPath: string, options: RunNormalizeOptions = {}): number {
  const writeOut = options.writeOut ?? ((text: string): void => void process.stdout.write(text));
  const writeErr = options.writeErr ?? ((text: string): void => void process.stderr.write(text));

  try {
    const { ir } = normalizeSkill(inputPath, options.cwd === undefined ? {} : { cwd: options.cwd });
    writeOut(serializeSkillIR(ir));
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
