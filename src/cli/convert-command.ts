/**
 * The `convert` command: turn a local skill into a DeepSeek Harness package.
 *
 * stdout carries a short human-readable report. Nothing is written anywhere
 * except the staging directory and, on success, the final output directory.
 */
import path from 'node:path';

import { convertSkillToTarget, renderConversionReport } from '../conversion/convert-skill.js';
import { formatErrorMessage } from '../utils/error-message.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../utils/exit-codes.js';

export interface RunConvertOptions {
  /** Directory used to resolve the source path. Defaults to the process cwd. */
  readonly cwd?: string;
  /**
   * Source adapter selected with `--source`. `undefined` keeps the generic local
   * behaviour, so omitting the option cannot change an existing conversion.
   */
  readonly source?: string;
  /** Sink for the report. Defaults to `process.stdout.write`. */
  readonly writeOut?: (text: string) => void;
  /** Sink for problem messages. Defaults to `process.stderr.write`. */
  readonly writeErr?: (text: string) => void;
}

/**
 * Converts a skill and writes the report.
 *
 * @param inputPath Source skill file or directory.
 * @param target Requested target; only `dsh` is supported.
 * @param outputPath Destination directory; never overwritten.
 * @param options Output sinks, directory context and the selected source.
 * @returns `0` on success, `2` when the conversion is refused, `1` on a fatal error.
 */
export function runConvert(
  inputPath: string,
  target: string,
  outputPath: string,
  options: RunConvertOptions = {},
): number {
  const writeOut = options.writeOut ?? ((text: string): void => void process.stdout.write(text));
  const writeErr = options.writeErr ?? ((text: string): void => void process.stderr.write(text));
  const cwd = path.resolve(options.cwd ?? process.cwd());

  try {
    const outcome = convertSkillToTarget(inputPath, outputPath, target, {
      cwd,
      ...(options.source === undefined ? {} : { source: options.source }),
    });
    writeOut(renderConversionReport(outcome, { baseDirectory: cwd }));

    return outcome.result.converted ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
  } catch (error) {
    // Fatal input and filesystem failures are not refusals: one readable line on
    // stderr, no report, no output.
    writeErr(`dsh-forge: ${formatErrorMessage(error)}\n`);
    return EXIT_FATAL;
  }
}
