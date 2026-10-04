/**
 * Runs the `dsh-forge` CLI and translates the outcome into a process exit code.
 *
 * This module is deliberately free of shebang and top-level process concerns so
 * that it can be imported by tests. Both `--help` and `--version` cause
 * Commander to print and then signal exit through a `CommanderError` with code
 * `commander.helpDisplayed` / `commander.version`; those are normal outcomes and
 * map to exit code 0.
 *
 * Expected failures (`ForgeError`) are reported as one readable line on stderr
 * with exit code 1. Unexpected failures get a separate, clearly-labelled line so
 * a bug is never mistaken for user error.
 */
import { CommanderError, type Command } from 'commander';

import { formatErrorMessage } from '../utils/error-message.js';
import { ForgeError } from '../utils/errors.js';
import { EXIT_FATAL, EXIT_SUCCESS } from '../utils/exit-codes.js';
import {
  applyOutputConfiguration,
  createProgram,
  renderRootHelp,
  stripOptionTerminator,
} from './program.js';

/** Commander exit codes that mean "the requested output was printed". */
const BENIGN_EXIT_CODES: ReadonlySet<string> = new Set([
  'commander.helpDisplayed',
  'commander.version',
]);

export interface RunOptions {
  /** Arguments to parse, without the leading `node` and script path. */
  readonly argv: readonly string[];
  /** Sink for help, version and command output. Defaults to `process.stdout.write`. */
  readonly stdout?: (text: string) => void;
  /** Sink for error output. Defaults to `process.stderr.write`. */
  readonly stderr?: (text: string) => void;
}

/**
 * Applies `exitOverride` to a command and every subcommand.
 *
 * Commander copies the exit callback when a subcommand is *created*, so setting
 * it on the root afterwards leaves subcommands calling `process.exit()` for real.
 * That would terminate the host process (and in an embedded runtime such as
 * Electron, where `process.exit` is stubbed, surface as a crash) instead of
 * returning an exit code — for example on `analyze --help`.
 */
function applyExitOverride(command: Command): void {
  command.exitOverride();
  for (const subcommand of command.commands) {
    applyExitOverride(subcommand);
  }
}

/**
 * Locates the command named by the first operand, if any.
 *
 * @returns The matching subcommand, or `undefined` for the root command.
 */
function findRequestedCommand(program: Command, argv: readonly string[]): Command | undefined {
  const [firstOperand] = argv.filter((argument) => !argument.startsWith('-'));
  if (firstOperand === undefined) {
    return undefined;
  }
  return program.commands.find((command) => command.name() === firstOperand);
}

/**
 * Prints help for the requested command on stdout instead of letting Commander
 * handle it.
 *
 * Commander routes a subcommand's `--help` through its error path
 * (`help({ error: true })`), which writes the help text to stderr and reports a
 * failure. A help request is informational, so it belongs on stdout with a
 * success exit code, exactly like the root `--help`.
 *
 * `-h` is deliberately left to Commander so its per-command behaviour is
 * preserved.
 *
 * @returns `true` when help was printed and parsing must be skipped.
 */
function printRequestedHelp(
  program: Command,
  argv: readonly string[],
  writeOut: (text: string) => void,
): boolean {
  if (!argv.includes('--help')) {
    return false;
  }

  const requested = findRequestedCommand(program, argv);
  writeOut(requested === undefined ? renderRootHelp() : `${requested.helpInformation()}\n`);
  return true;
}

/**
 * Parses `argv` and runs the matching command.
 *
 * A command may report a non-fatal outcome through `process.exitCode` (the
 * `validate` command uses it for a validation failure); that value becomes the
 * result, so a completed validation and a fatal error stay distinguishable.
 *
 * @param options Argument vector and optional output sinks.
 * @returns {@link EXIT_SUCCESS}, {@link EXIT_VALIDATION_FAILED} or {@link EXIT_FATAL}.
 */
export async function runCli(options: RunOptions): Promise<number> {
  const writeOut = options.stdout ?? ((text: string): void => void process.stdout.write(text));
  const writeErr = options.stderr ?? ((text: string): void => void process.stderr.write(text));

  const program = createProgram(writeOut, writeErr);
  applyExitOverride(program);
  applyOutputConfiguration(program, { writeOut, writeErr });

  // The exit code is an output of this call, never a leftover from a previous
  // one, so a caller can invoke runCli repeatedly and get stable results.
  process.exitCode = EXIT_SUCCESS;

  const argv = stripOptionTerminator(options.argv);
  if (printRequestedHelp(program, argv, writeOut)) {
    return EXIT_SUCCESS;
  }

  try {
    await program.parseAsync(argv, { from: 'user' });
    return process.exitCode ?? EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (BENIGN_EXIT_CODES.has(error.code)) {
        return EXIT_SUCCESS;
      }
      // Commander has already written the usage error to stderr. Commander does
      // not always populate `exitCode`, but every non-benign CommanderError is a
      // usage failure, so it must never be reported as success.
      return EXIT_FATAL;
    }
    if (error instanceof ForgeError) {
      writeErr(`dsh-forge: ${error.message}\n`);
      return EXIT_FATAL;
    }
    writeErr(`dsh-forge: unexpected failure: ${formatErrorMessage(error)}\n`);
    return EXIT_FATAL;
  }
}
