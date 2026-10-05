/**
 * Builds the `dsh-forge` command-line interface.
 *
 * Phase 8 registers exactly six commands: `analyze` describes a local skill,
 * `validate` checks its structure, `compat` checks it against the pinned
 * DeepSeek Harness contract, `normalize` emits the canonical Universal Skill IR,
 * `convert` writes a DSH package, and `assess` reports whether a conversion would
 * succeed without writing anything. No source adapter registry, remote import or
 * model-provider command exists.
 */
import { Command } from 'commander';

import { EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../utils/exit-codes.js';
import { describeNodeRequirement, readPackageInfo } from '../utils/package-info.js';
import { runAnalyze } from './analyze-command.js';
import { runAssess } from './assess-command.js';
import { runCompat } from './compat-command.js';
import { runConvert } from './convert-command.js';
import { runNormalize } from './normalize-command.js';
import { runValidate } from './validate-command.js';

/**
 * Parts of the root help footer. The environment line is built from the
 * package's own `engines.node`, so the help cannot claim a runtime the package
 * does not declare.
 */
const HELP_FOOTER_SECTIONS = [
  `Security:
  Third-party skills are untrusted input. dsh-forge never executes shell
  commands, scripts, executables or binaries from a third-party skill. Skill
  resources are enumerated and read, never run.`,
  `Status:
  Phase 8 (local analysis, deterministic validation, pinned DeepSeek Harness
  compatibility, canonical Universal Skill IR, safe DSH conversion, an Agent
  Skills source adapter, portable semantics and read-only compatibility
  assessment). \`analyze\`, \`validate\`, \`compat\`, \`normalize\`, \`convert\` and
  \`assess\` exist so far.`,
];

function buildEnvironmentSection(nodeRequirement: string | undefined): string {
  if (nodeRequirement === undefined) {
    return 'Environment:\n  See package.json for the supported Node.js version.';
  }
  return `Environment:\n  Requires Node.js ${describeNodeRequirement(nodeRequirement)}.`;
}

/**
 * Builds the root help footer text.
 *
 * Exported so the CLI runner can render the same root help on stdout without
 * duplicating it.
 */
export function buildRootHelpFooter(nodeRequirement: string | undefined): string {
  return [buildEnvironmentSection(nodeRequirement), ...HELP_FOOTER_SECTIONS].join('\n\n');
}

/**
 * Removes the lone leading option terminator `--` that package managers forward.
 *
 * `pnpm dev -- analyze <path>` reaches the script as `['--', 'analyze', '<path>']`:
 * pnpm prepends a terminator of its own. Commander would treat everything after a
 * terminator as a literal operand, which would stop `analyze` from being
 * recognized as a command. Only a leading terminator is removed, so a user who
 * writes `analyze -- <path>` still gets their own terminator honoured.
 */
export function stripOptionTerminator(argv: readonly string[]): string[] {
  return argv[0] === '--' ? argv.slice(1) : [...argv];
}

/**
 * Creates the CLI program.
 *
 * Kept separate from the executable entry point so tests can drive the very same
 * program object without spawning a process. Creating the program has no side
 * effects: it neither parses nor prints, so the caller stays in control of when
 * output reaches its sinks.
 *
 * A caller that receives raw `process.argv` should pass it through
 * {@link stripOptionTerminator} first; `runCli` already does.
 *
 * @param writeOut Sink used by a command to print its report.
 * @param writeErr Sink used by a command to print a problem message.
 * @returns A configured, not-yet-parsed Commander program.
 */
export function createProgram(
  writeOut: (text: string) => void = () => {},
  writeErr: (text: string) => void = () => {},
): Command {
  const packageInfo = readPackageInfo();
  const program = new Command();

  program
    .name('dsh-forge')
    .description(packageInfo.description)
    .version(packageInfo.version, '-v, --version', 'Print the dsh-forge version and exit.')
    .helpOption('-h, --help', 'Print this help and exit.')
    .addHelpText('after', `\n${buildRootHelpFooter(packageInfo.nodeRequirement)}\n`)
    .showHelpAfterError()
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  program
    .command('analyze')
    .description('Read and analyze a local skill file or directory. Nothing is executed.')
    // Declared optional so a missing path is rejected by this action rather than
    // by Commander's own missing-argument handling. That internal path calls
    // `process.exit()` directly after invoking the exit callback, which
    // terminates the host process instead of returning an exit code. The usage
    // string still shows `<path>`, because a path is required.
    .argument('[path]', 'Path to a SKILL.md file or a directory containing one')
    .usage('<path>')
    .action((inputPath: string | undefined) => {
      if (inputPath === undefined || inputPath.length === 0) {
        program.error("error: missing required argument 'path'", { exitCode: 1 });
        return;
      }
      writeOut(runAnalyze(inputPath));
    });

  program
    .command('validate')
    .description('Validate a local skill deterministically. Nothing is executed.')
    .argument('[path]', 'Path to a SKILL.md file or a directory containing one')
    .usage('<path>')
    .action((inputPath: string | undefined) => {
      if (inputPath === undefined || inputPath.length === 0) {
        program.error("error: missing required argument 'path'", { exitCode: 1 });
        return;
      }

      const { report, result } = runValidate(inputPath);
      writeOut(report);

      // A completed validation is a normal outcome, so the report stays on
      // stdout; only the status code distinguishes pass from failure (2).
      process.exitCode = result.valid ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
    });

  program
    .command('compat')
    .description(
      'Check a local skill against the pinned DeepSeek Harness contract. Nothing is executed.',
    )
    .argument('[path]', 'Path to a SKILL.md file or a directory containing one')
    .usage('<path>')
    .action((inputPath: string | undefined) => {
      if (inputPath === undefined || inputPath.length === 0) {
        program.error("error: missing required argument 'path'", { exitCode: 1 });
        return;
      }

      const { report, result } = runCompat(inputPath);
      writeOut(report);

      // Compatibility reuses the existing semantics: passing, including passing
      // with warnings, is 0; an incompatible skill is a completed check that
      // failed, which is 2.
      process.exitCode = result.compatible ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
    });

  program
    .command('normalize')
    .description('Emit the canonical Universal Skill IR for a structurally valid local skill.')
    .argument('[path]', 'Path to a SKILL.md file or a directory containing one')
    .usage('<path>')
    .option('--ir-version <version>', 'IR schema version to emit; defaults to 1')
    .option('--source <source>', 'Explicit source adapter; omit for the generic local path')
    .action(
      (inputPath: string | undefined, commandOptions: { irVersion?: string; source?: string }) => {
        if (inputPath === undefined || inputPath.length === 0) {
          program.error("error: missing required argument 'path'", { exitCode: 1 });
          return;
        }

        // An explicit, non-numeric version is a usage error rather than a silent
        // fallback to a default: guessing which schema a caller meant would produce
        // a document they did not ask for.
        let irVersion: number | undefined;
        if (commandOptions.irVersion !== undefined) {
          const parsed = Number(commandOptions.irVersion);
          if (!Number.isInteger(parsed)) {
            program.error(`error: option '--ir-version <version>' expects an integer`, {
              exitCode: 1,
            });
            return;
          }
          irVersion = parsed;
        }

        // stdout carries the IR document only, so a redirect produces valid JSON.
        process.exitCode = runNormalize(inputPath, {
          writeOut,
          writeErr,
          ...(irVersion === undefined ? {} : { irVersion }),
          ...(commandOptions.source === undefined ? {} : { source: commandOptions.source }),
        });
      },
    );

  program
    .command('assess')
    .description('Report whether a skill would convert, without writing anything.')
    .argument('[path]', 'Path to a SKILL.md file or a directory containing one')
    .usage('<path>')
    .option('--source <source>', 'Explicit source adapter; omit for the generic local path')
    .requiredOption('--target <target>', 'Assessment target; only "dsh" is supported')
    .action(
      (inputPath: string | undefined, commandOptions: { source?: string; target: string }) => {
        if (inputPath === undefined || inputPath.length === 0) {
          program.error("error: missing required argument 'path'", { exitCode: 1 });
          return;
        }

        process.exitCode = runAssess(inputPath, commandOptions.target, {
          writeOut,
          writeErr,
          ...(commandOptions.source === undefined ? {} : { source: commandOptions.source }),
        });
      },
    );

  program
    .command('convert')
    .description('Convert a local skill into a pinned-target package. Nothing is executed.')
    .argument('[path]', 'Path to a SKILL.md file or a directory containing one')
    .usage('<path>')
    .option('--source <source>', 'Explicit source adapter; omit for the generic local path')
    .requiredOption('--target <target>', 'Conversion target; only "dsh" is supported')
    .requiredOption('--out <directory>', 'Output directory; must not already exist')
    .action(
      (
        inputPath: string | undefined,
        commandOptions: { source?: string; target: string; out: string },
      ) => {
        if (inputPath === undefined || inputPath.length === 0) {
          program.error("error: missing required argument 'path'", { exitCode: 1 });
          return;
        }

        process.exitCode = runConvert(inputPath, commandOptions.target, commandOptions.out, {
          writeOut,
          writeErr,
          ...(commandOptions.source === undefined ? {} : { source: commandOptions.source }),
        });
      },
    );

  return program;
}

/**
 * Routes a command's output to the given sinks, recursively.
 *
 * Commander copies the output configuration when a subcommand is *created*, so
 * configuring only the root after the fact leaves subcommands writing to the
 * real process streams. That makes `runCli`'s sinks unreliable — a captured run
 * would report an empty stderr for a usage error such as a missing required
 * option — so every command is configured explicitly.
 *
 * @param command Command to configure, including its subcommands.
 * @param sinks Output sinks.
 */
export function applyOutputConfiguration(
  command: Command,
  sinks: { readonly writeOut: (text: string) => void; readonly writeErr: (text: string) => void },
): void {
  command.configureOutput(sinks);
  for (const subcommand of command.commands) {
    applyOutputConfiguration(subcommand, sinks);
  }
}

/**
 * Renders the root help text exactly as a user sees it from `--help`.
 *
 * `Command.helpInformation()` omits text added with `addHelpText`, so the footer
 * is appended here, followed by the blank line Commander appends after each help
 * chunk. Provided for callers that route help themselves.
 *
 * @returns The root help text.
 */
export function renderRootHelp(): string {
  const packageInfo = readPackageInfo();
  return `${createProgram().helpInformation()}\n${buildRootHelpFooter(packageInfo.nodeRequirement)}\n\n`;
}
