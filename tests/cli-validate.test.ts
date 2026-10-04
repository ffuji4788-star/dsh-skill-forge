/**
 * The `validate` command through the real CLI runner: exit codes, output streams
 * and the distinction between a validation failure and a fatal error.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';
import { readPackageInfo } from '../src/utils/package-info.js';

interface CapturedRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(...argv: string[]): Promise<CapturedRun> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli({
    argv,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr };
}

describe('validate exit codes', () => {
  it('exits 0 for a valid skill', async () => {
    const { exitCode, stdout, stderr } = await run('validate', 'fixtures/validate-valid');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: PASS');
    expect(stdout).toContain('Errors: 0');
    expect(stdout).toContain('Warnings: 0');
  });

  it('exits 0 when there are warnings only', async () => {
    const { exitCode, stdout, stderr } = await run(
      'validate',
      'fixtures/validate-warning-unknown-key',
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: PASS');
    expect(stdout).toContain('Warnings: 2');
    expect(stdout).toContain('UNKNOWN_FRONTMATTER_KEY');
  });

  it('exits 2 for a validation failure', async () => {
    const { exitCode, stdout, stderr } = await run('validate', 'fixtures/validate-missing-name');

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    // The report is a normal outcome and stays on stdout.
    expect(stdout).toContain('Result: FAIL');
    expect(stdout).toContain('MISSING_NAME');
    expect(stderr).toBe('');
  });

  it('exits 2 with both errors and warnings reported', async () => {
    const { exitCode, stdout } = await run('validate', 'fixtures/validate-multiple-errors');

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('Errors: 2');
    expect(stdout).toContain('Warnings: 1');
  });

  it('exits 1 for invalid YAML, which is fatal rather than a validation issue', async () => {
    const { exitCode, stdout, stderr } = await run('validate', 'fixtures/invalid-yaml');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Invalid YAML frontmatter');
    // A fatal error never becomes a validation report.
    expect(stderr).not.toContain('INVALID_YAML');
    expect(stdout).not.toContain('Result:');
  });

  it('exits 1 for ambiguous Markdown', async () => {
    const { exitCode, stdout, stderr } = await run('validate', 'fixtures/ambiguous-markdown');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Ambiguous skill entry');
  });

  it('exits 1 for a missing path', async () => {
    const { exitCode, stdout, stderr } = await run('validate', 'fixtures/does-not-exist');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Path does not exist');
  });

  it('exits 1 when the path argument is missing', async () => {
    const { exitCode, stdout, stderr } = await run('validate');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain("error: missing required argument 'path'");
    expect(stderr).not.toContain('unexpected failure');
  });

  it('keeps exit codes stable across repeated in-process runs', async () => {
    const pass = await run('validate', 'fixtures/validate-valid');
    const fail = await run('validate', 'fixtures/validate-missing-name');
    const passAgain = await run('validate', 'fixtures/validate-valid');

    expect([pass.exitCode, fail.exitCode, passAgain.exitCode]).toEqual([
      EXIT_SUCCESS,
      EXIT_VALIDATION_FAILED,
      EXIT_SUCCESS,
    ]);
  });
});

describe('validate input handling', () => {
  it('accepts a direct SKILL.md path', async () => {
    const { exitCode, stdout } = await run('validate', 'fixtures/validate-valid/SKILL.md');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Entry File: SKILL.md');
  });

  it('accepts an absolute path', async () => {
    const absolute = path.join(process.cwd(), 'fixtures', 'validate-valid');
    const { exitCode } = await run('validate', absolute);

    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it('accepts the leading terminator that pnpm forwards', async () => {
    const { exitCode, stdout } = await run('--', 'validate', 'fixtures/validate-valid');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Result: PASS');
  });

  it('does not leak absolute machine paths in the report', async () => {
    const { stdout } = await run('validate', 'fixtures/validate-missing-name');

    expect(stdout).not.toContain(process.cwd());
    expect(stdout).toContain('Entry File: SKILL.md');
  });
});

describe('command surface after Phase 2', () => {
  it('advertises analyze and validate only', async () => {
    const { stdout } = await run('--help');

    expect(stdout).toContain('analyze');
    expect(stdout).toContain('validate');
    for (const absent of ['convert', 'convert-skill', 'import ', 'install ']) {
      expect(stdout).not.toContain(absent);
    }
  });

  it('still prints help with exit code 0', async () => {
    const { exitCode, stderr } = await run('--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
  });

  it('still prints the version with exit code 0', async () => {
    const { exitCode, stdout } = await run('--version');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout.trim()).toBe(readPackageInfo().version);
  });

  it('rejects an unknown command with exit code 1', async () => {
    const { exitCode, stderr } = await run('convert');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('unknown command');
  });

  it('documents the required path form in the validate help', async () => {
    const { exitCode, stdout } = await run('validate', '--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Usage: dsh-forge validate <path>');
  });
});
