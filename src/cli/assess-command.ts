/**
 * The `assess` command: report whether a skill would convert, without converting.
 *
 * stdout carries a short report and nothing else. Nothing is written anywhere at
 * all — no output directory, no staging directory, no temporary file — so running
 * an assessment cannot affect the skill or the filesystem.
 */
import path from 'node:path';

import { assessSkill, renderAssessmentReport } from '../assessment/assess-skill.js';
import { formatErrorMessage } from '../utils/error-message.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../utils/exit-codes.js';

export interface RunAssessOptions {
  /** Directory used to resolve the source path. Defaults to the process cwd. */
  readonly cwd?: string;
  /** Source adapter selected with `--source`. `undefined` uses the generic path. */
  readonly source?: string;
  /** Sink for the report. Defaults to `process.stdout.write`. */
  readonly writeOut?: (text: string) => void;
  /** Sink for problem messages. Defaults to `process.stderr.write`. */
  readonly writeErr?: (text: string) => void;
}

/**
 * Assesses a skill and writes the report.
 *
 * @param inputPath Source skill file or directory.
 * @param target Requested target identifier.
 * @param options Output sinks, directory context and the selected source.
 * @returns `0` when convertible, `2` when refused, `1` on a fatal error.
 */
export function runAssess(
  inputPath: string,
  target: string,
  options: RunAssessOptions = {},
): number {
  const writeOut = options.writeOut ?? ((text: string): void => void process.stdout.write(text));
  const writeErr = options.writeErr ?? ((text: string): void => void process.stderr.write(text));
  const cwd = path.resolve(options.cwd ?? process.cwd());

  try {
    const result = assessSkill(inputPath, {
      target,
      cwd,
      ...(options.source === undefined ? {} : { source: options.source }),
    });
    writeOut(renderAssessmentReport(result));

    return result.status === 'CONVERTIBLE' ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
  } catch (error) {
    // Fatal input and filesystem failures are not assessments: one readable line
    // on stderr, no report, nothing written.
    writeErr(`dsh-forge: ${formatErrorMessage(error)}\n`);
    return EXIT_FATAL;
  }
}
