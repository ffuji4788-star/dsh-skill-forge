/**
 * The dev-time corpus survey entry point.
 *
 * The logic lives in `src/survey/corpus-survey.ts` so tests can call it directly;
 * this module only handles argument parsing and output.
 *
 * Usage:
 *   pnpm survey:agent-skills -- <checkout>/skills [--out <snapshot.json>]
 *
 * Nothing is fetched and nothing in the corpus is executed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  renderSurveyReport,
  serializeSnapshot,
  surveyCorpus,
  toSnapshot,
} from '../src/survey/corpus-survey.js';
import {
  ANTHROPIC_SKILLS_COMMIT,
  ANTHROPIC_SKILLS_REPOSITORY,
} from '../src/sources/agent-skills/agent-skills-contract.js';

/** Default snapshot destination, relative to the process cwd. */
export const DEFAULT_SNAPSHOT_PATH = path.join(
  'docs',
  'data',
  `anthropic-skills-${ANTHROPIC_SKILLS_COMMIT.slice(0, 7)}-survey.json`,
);

export interface SurveyCliOptions {
  /** Directory whose immediate children are skill directories. */
  readonly skillsRoot: string;
  /** Snapshot destination, or `undefined` to skip writing one. */
  readonly outPath?: string;
  /** Sink for the human-readable report. */
  readonly writeOut: (text: string) => void;
  /** Sink for progress notes. */
  readonly writeErr: (text: string) => void;
}

/**
 * Runs a survey and writes the report and optional snapshot.
 *
 * @param options Survey configuration and sinks.
 * @returns The process exit code.
 */
export function runSurveyCli(options: SurveyCliOptions): number {
  const report = surveyCorpus({ skillsRoot: options.skillsRoot });

  options.writeOut(renderSurveyReport(report));

  if (options.outPath !== undefined) {
    const snapshot = toSnapshot(report, {
      repository: ANTHROPIC_SKILLS_REPOSITORY,
      commit: ANTHROPIC_SKILLS_COMMIT,
      surveyRoot: 'skills',
    });
    mkdirSync(path.dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, serializeSnapshot(snapshot), { encoding: 'utf8' });
    options.writeErr(`snapshot written to ${options.outPath}\n`);
  }

  return 0;
}

/**
 * Parses `--out <path>` (and its `--out=<path>` form) out of an argument list.
 *
 * A leading `--` is dropped, because `pnpm <script> -- <args>` forwards the
 * terminator itself into `process.argv`.
 *
 * @param argv Arguments after the script name.
 * @returns The parsed options, or an error message.
 */
export function parseSurveyArgs(
  argv: readonly string[],
): { readonly skillsRoot: string; readonly outPath?: string } | { readonly error: string } {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let skillsRoot: string | undefined;
  let outPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? '';
    if (argument === '--out') {
      outPath = args[index + 1];
      if (outPath === undefined || outPath.length === 0) {
        return { error: "option '--out' expects a path" };
      }
      index += 1;
      continue;
    }
    if (argument.startsWith('--out=')) {
      outPath = argument.slice('--out='.length);
      continue;
    }
    if (argument.startsWith('-')) {
      return { error: `unknown option '${argument}'` };
    }
    if (skillsRoot !== undefined) {
      return { error: 'only one corpus path may be given' };
    }
    skillsRoot = argument;
  }

  if (skillsRoot === undefined || skillsRoot.length === 0) {
    return { error: 'a corpus path is required: survey:agent-skills -- <checkout>/skills' };
  }

  return outPath === undefined ? { skillsRoot } : { skillsRoot, outPath };
}
