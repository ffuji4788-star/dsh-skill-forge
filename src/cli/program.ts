/**
 * Builds the `dsh-forge` command-line interface.
 *
 * Phase 3 registers exactly three commands: `analyze` describes a local skill,
 * `validate` checks its structure, and `compat` checks it against the pinned
 * DeepSeek Harness contract. No conversion, import or model-provider command
 * exists.
 */
import { Command } from 'commander';

import { EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../utils/exit-codes.js';
import { describeNodeRequirement, readPackageInfo } from '../utils/package-info.js';
import { runAnalyze } from './analyze-command.js';
import { runCompat } from './compat-command.js';
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
  Phase 3 (local analysis, deterministic validation and pinned DeepSeek Harness
  compatibility). \`analyze\`, \`validate\` and \`compat\` exist so far.`,
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
 * @returns A configured, not-yet-parsed Commander program.
 */
export function createProgram(writeOut: (text: string) => void = () => {}): Command {
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

  return program;
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
