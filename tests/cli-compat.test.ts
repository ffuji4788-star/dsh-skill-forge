/**
 * The `compat` command through the real CLI runner: exit codes, output streams,
 * and the deliberate separation between generic validation and target
 * compatibility.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { runCompat } from '../src/cli/compat-command.js';
import { runValidate } from '../src/cli/validate-command.js';
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

describe('compat exit codes', () => {
  it('exits 0 for a compatible skill', async () => {
    const { exitCode, stdout, stderr } = await run('compat', 'fixtures/dsh/compatible-minimal');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: COMPATIBLE');
    expect(stdout).toContain('Errors: 0');
  });

  it('exits 0 when compatible with every optional field', async () => {
    const { exitCode, stdout } = await run('compat', 'fixtures/dsh/compatible-full');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Result: COMPATIBLE');
  });

  it('exits 0 when compatible with warnings', async () => {
    const { exitCode, stdout, stderr } = await run('compat', 'fixtures/dsh/unknown-key');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: COMPATIBLE_WITH_WARNINGS');
    expect(stdout).toContain('DSH_IGNORED_FRONTMATTER_KEY');
  });

  it('exits 0 for an empty body, which the pinned contract accepts', async () => {
    const { exitCode, stdout } = await run('compat', 'fixtures/dsh/empty-body');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Result: COMPATIBLE_WITH_WARNINGS');
    expect(stdout).toContain('DSH_EMPTY_CONTENT');
  });

  it('exits 2 for an invalid invocation value', async () => {
    const { exitCode, stdout, stderr } = await run(
      'compat',
      'fixtures/dsh/invalid-invocation-value',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: INCOMPATIBLE');
    expect(stdout).toContain('DSH_INVALID_INVOCATION_VALUE');
  });

  it('exits 2 for a legacy invocation key', async () => {
    const { exitCode, stdout } = await run('compat', 'fixtures/dsh/legacy-invocation-key');

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('Result: INCOMPATIBLE');
    expect(stdout).toContain('DSH_LEGACY_INVOCATION_KEY');
  });

  it('exits 1 for invalid YAML, which is fatal rather than a target issue', async () => {
    const { exitCode, stdout, stderr } = await run('compat', 'fixtures/invalid-yaml');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Invalid YAML frontmatter');
    expect(stdout).not.toContain('Result:');
  });

  it('exits 1 for a missing path', async () => {
    const { exitCode, stdout, stderr } = await run('compat', 'fixtures/does-not-exist');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Path does not exist');
  });

  it('exits 1 for an ambiguous directory', async () => {
    const { exitCode, stderr } = await run('compat', 'fixtures/ambiguous-markdown');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('Ambiguous skill entry');
  });

  it('exits 1 when the path argument is missing', async () => {
    const { exitCode, stdout, stderr } = await run('compat');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain("error: missing required argument 'path'");
    expect(stderr).not.toContain('unexpected failure');
  });

  it('keeps exit codes stable across repeated in-process runs', async () => {
    const first = await run('compat', 'fixtures/dsh/compatible-minimal');
    const fail = await run('compat', 'fixtures/dsh/legacy-invocation-key');
    const second = await run('compat', 'fixtures/dsh/compatible-minimal');

    expect([first.exitCode, fail.exitCode, second.exitCode]).toEqual([
      EXIT_SUCCESS,
      EXIT_VALIDATION_FAILED,
      EXIT_SUCCESS,
    ]);
  });
});

describe('compat input handling', () => {
  it('accepts a direct SKILL.md path', async () => {
    const { exitCode, stdout } = await run('compat', 'fixtures/dsh/compatible-minimal/SKILL.md');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Entry File: SKILL.md');
  });

  it('accepts an absolute path', async () => {
    const absolute = path.join(process.cwd(), 'fixtures', 'dsh', 'compatible-minimal');

    expect((await run('compat', absolute)).exitCode).toBe(EXIT_SUCCESS);
  });

  it('accepts the leading terminator that pnpm forwards', async () => {
    const { exitCode, stdout } = await run('--', 'compat', 'fixtures/dsh/compatible-minimal');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Result: COMPATIBLE');
  });

  it('states the pinned target, contract and discovery caveat', async () => {
    const { stdout } = await run('compat', 'fixtures/dsh/compatible-minimal');

    expect(stdout).toContain('Target: DeepSeek Harness');
    expect(stdout).toMatch(/Contract: deepseek-ai\/deepseek-harness@[0-9a-f]{12}/);
    expect(stdout).toContain('not verified');
  });

  it('does not leak absolute machine paths', async () => {
    const { stdout } = await run('compat', 'fixtures/dsh/legacy-invocation-key');

    expect(stdout).not.toContain(process.cwd());
    expect(stdout).toContain('Entry File: SKILL.md');
  });
});

describe('generic validation and target compatibility stay separate', () => {
  it('accepts a whitespace description that generic validation rejects', () => {
    const target = path.join(process.cwd(), 'fixtures', 'dsh', 'whitespace-description');

    const compat = runCompat(target, { cwd: process.cwd() });
    const generic = runValidate(target, { cwd: process.cwd() });

    expect(compat.result.status).toBe('COMPATIBLE');
    expect(generic.result.valid).toBe(false);
    expect(generic.result.errors.map((issue) => issue.code)).toContain('EMPTY_DESCRIPTION');
  });

  it('reports an empty body as a generic error but only a target warning', async () => {
    const target = path.join(process.cwd(), 'fixtures', 'dsh', 'empty-body');

    const compat = runCompat(target, { cwd: process.cwd() });
    const generic = runValidate(target, { cwd: process.cwd() });

    expect(compat.result.compatible).toBe(true);
    expect(generic.result.valid).toBe(false);
    expect(generic.result.errors.map((issue) => issue.code)).toContain('EMPTY_BODY');
  });

  it('treats an unknown key as a generic warning and a target warning alike', () => {
    const target = path.join(process.cwd(), 'fixtures', 'dsh', 'unknown-key');

    const compat = runCompat(target, { cwd: process.cwd() });
    const generic = runValidate(target, { cwd: process.cwd() });

    expect(compat.result.compatible).toBe(true);
    expect(generic.result.valid).toBe(true);
    expect(compat.result.warnings.length).toBeGreaterThan(0);
    expect(generic.result.warnings.length).toBeGreaterThan(0);
  });
});

describe('command surface after Phase 3', () => {
  it('advertises analyze, validate and compat only', async () => {
    const { stdout } = await run('--help');

    expect(stdout).toContain('analyze');
    expect(stdout).toContain('validate');
    expect(stdout).toContain('compat');
    for (const absent of ['publish', 'import', 'install', 'migrate']) {
      expect(stdout).not.toContain(`${absent} `);
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
    const { exitCode, stderr } = await run('publish');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('unknown command');
  });

  it('documents the required path form in the compat help', async () => {
    const { exitCode, stdout } = await run('compat', '--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Usage: dsh-forge compat <path>');
  });
});
