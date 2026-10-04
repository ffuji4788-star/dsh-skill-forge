/**
 * The `normalize` command through the real CLI runner: stdout purity, exit codes
 * and the generic-validation gate as seen by a user.
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

describe('normalize success', () => {
  it('exits 0 and writes only a JSON document to stdout', async () => {
    const { exitCode, stdout, stderr } = await run('normalize', 'fixtures/normalize/minimal');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(() => JSON.parse(stdout) as unknown).not.toThrow();
  });

  it('produces the documented canonical shape', async () => {
    const { stdout } = await run('normalize', 'fixtures/normalize/minimal');
    const parsed = JSON.parse(stdout) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'name',
      'description',
      'instructions',
      'resources',
      'source',
    ]);
    expect(parsed['schemaVersion']).toBe(1);
    expect(parsed['name']).toBe('normalize-minimal');
    expect(parsed['source']).toEqual({
      format: 'generic-local-skill',
      entryFile: 'SKILL.md',
      extraFrontmatter: {},
    });
  });

  it('emits a final newline and two-space indentation', async () => {
    const { stdout } = await run('normalize', 'fixtures/normalize/minimal');

    expect(stdout.endsWith('\n')).toBe(true);
    expect(stdout).toContain('\n  "name":');
    expect(stdout).not.toContain('\r');
  });

  it('keeps stdout pure JSON with no header or status text', async () => {
    const { stdout } = await run('normalize', 'fixtures/normalize/minimal');

    expect(stdout.trimStart().startsWith('{')).toBe(true);
    // A success message or report heading would break `normalize x > file.json`.
    expect(stdout).not.toContain('Success');
    expect(stdout).not.toContain('Normalized');
    expect(stdout).not.toContain('Result:');
    expect(stdout).not.toContain('Skill Analysis');
    expect(() => JSON.parse(stdout) as unknown).not.toThrow();
  });

  it('accepts a direct SKILL.md path', async () => {
    const { exitCode, stdout } = await run('normalize', 'fixtures/normalize/minimal/SKILL.md');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect((JSON.parse(stdout) as Record<string, unknown>)['name']).toBe('normalize-minimal');
  });

  it('accepts an absolute path', async () => {
    const absolute = path.join(process.cwd(), 'fixtures', 'normalize', 'minimal');

    expect((await run('normalize', absolute)).exitCode).toBe(EXIT_SUCCESS);
  });

  it('accepts the leading terminator that pnpm forwards', async () => {
    const { exitCode } = await run('--', 'normalize', 'fixtures/normalize/minimal');

    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it('preserves extra frontmatter and resource references', async () => {
    const extra = await run('normalize', 'fixtures/normalize/with-extra-frontmatter');
    const resources = await run('normalize', 'fixtures/normalize/with-resources');

    const extraIr = JSON.parse(extra.stdout) as { source: { extraFrontmatter: unknown } };
    expect(extraIr.source.extraFrontmatter).toHaveProperty('author', 'Alice');

    const resourceIr = JSON.parse(resources.stdout) as { resources: string[] };
    expect(resourceIr.resources).toEqual(['assets/data.json', 'reference.md']);
  });

  it('writes byte-identical output on repeated invocations', async () => {
    const first = await run('normalize', 'fixtures/normalize/nested-extra-frontmatter');
    const second = await run('normalize', 'fixtures/normalize/nested-extra-frontmatter');

    expect(second.stdout).toBe(first.stdout);
  });
});

describe('normalize refusal and fatal errors', () => {
  it('exits 2 with no partial JSON when generic validation fails', async () => {
    const { exitCode, stdout, stderr } = await run(
      'normalize',
      'fixtures/normalize/generic-invalid',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toBe('');
    expect(stderr).toContain('cannot be normalized because generic validation failed');
    expect(stderr).toContain('MISSING_NAME');
  });

  it('exits 1 for invalid YAML and emits no document', async () => {
    const { exitCode, stdout, stderr } = await run('normalize', 'fixtures/invalid-yaml');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Invalid YAML frontmatter');
  });

  it('exits 1 for a missing path', async () => {
    const { exitCode, stdout, stderr } = await run('normalize', 'fixtures/does-not-exist');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Path does not exist');
  });

  it('exits 1 for an ambiguous directory', async () => {
    const { exitCode, stdout, stderr } = await run('normalize', 'fixtures/ambiguous-markdown');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain('Ambiguous skill entry');
  });

  it('exits 1 when the path argument is missing', async () => {
    const { exitCode, stdout, stderr } = await run('normalize');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stdout).toBe('');
    expect(stderr).toContain("error: missing required argument 'path'");
  });

  it('keeps exit codes stable across repeated in-process runs', async () => {
    const pass = await run('normalize', 'fixtures/normalize/minimal');
    const refuse = await run('normalize', 'fixtures/normalize/generic-invalid');
    const again = await run('normalize', 'fixtures/normalize/minimal');

    expect([pass.exitCode, refuse.exitCode, again.exitCode]).toEqual([
      EXIT_SUCCESS,
      EXIT_VALIDATION_FAILED,
      EXIT_SUCCESS,
    ]);
  });
});

describe('command surface after Phase 4', () => {
  it('advertises analyze, validate, compat and normalize only', async () => {
    const { stdout } = await run('--help');

    for (const present of ['analyze', 'validate', 'compat', 'normalize']) {
      expect(stdout).toContain(present);
    }
    for (const absent of ['convert', 'import', 'install', 'migrate']) {
      expect(stdout).not.toContain(`${absent} `);
    }
  });

  it('documents the required path form in the normalize help', async () => {
    const { exitCode, stdout } = await run('normalize', '--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Usage: dsh-forge normalize <path>');
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
});
