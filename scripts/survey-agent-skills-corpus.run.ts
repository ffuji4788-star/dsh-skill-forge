/**
 * Development-only corpus survey runner.
 *
 * Reads a local, already-pinned checkout of a skills repository. It never fetches
 * anything, never executes anything it finds, and never writes into the corpus.
 *
 *   pnpm survey:agent-skills -- <checkout>/skills [--out <snapshot.json>]
 */
import path from 'node:path';

import { parseSurveyArgs, runSurveyCli } from './survey-agent-skills-corpus.js';

const parsed = parseSurveyArgs(process.argv.slice(2));

if ('error' in parsed) {
  process.stderr.write(`dsh-forge survey: ${parsed.error}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = runSurveyCli({
    skillsRoot: path.resolve(parsed.skillsRoot),
    ...(parsed.outPath === undefined ? {} : { outPath: path.resolve(parsed.outPath) }),
    writeOut: (text) => void process.stdout.write(text),
    writeErr: (text) => void process.stderr.write(text),
  });
}
