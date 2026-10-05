import { runCodexSurveyCli } from './survey-codex-corpus.js';

process.exitCode = runCodexSurveyCli(process.argv.slice(2));
