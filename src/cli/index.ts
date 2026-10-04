#!/usr/bin/env node
/**
 * Executable entry point of the `dsh-forge` CLI.
 *
 * Contains only process wiring; the behaviour lives in `run.ts` so that it stays
 * testable without spawning a process.
 */
import { runCli } from './run.js';

process.exitCode = await runCli({ argv: process.argv.slice(2) });
