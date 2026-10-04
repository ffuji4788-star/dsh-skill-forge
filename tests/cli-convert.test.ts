/**
 * The `convert` command through the real CLI runner.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';
import { readPackageInfo } from '../src/utils/package-info.js';

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-convert-cli-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

describe('convert success', () => {
  it('converts a minimal skill with exit code 0', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout, stderr } = await run(
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('DSH Conversion');
    expect(stdout).toContain('Result: SUCCESS');
    expect(stdout).toContain('Files: 1');
    expect(stdout).toContain('deepseek-ai/deepseek-harness@5badb15009ae');
    expect(existsSync(path.join(out, 'SKILL.md'))).toBe(true);
  });

  it('converts a skill with resources', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/convert/with-resource',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('reference.md');
    expect(existsSync(path.join(out, 'reference.md'))).toBe(true);
  });

  it('accepts the leading terminator that pnpm forwards', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await run(
      '--',
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it('does not print the absolute source root', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { stdout } = await run(
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(stdout).not.toContain(repositoryRoot);
    expect(stdout).toContain('Source: fixtures/convert/minimal');
  });
});

describe('convert refusal', () => {
  it('exits 2 for unmapped source frontmatter and creates no output', async () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    const { exitCode, stdout, stderr } = await run(
      'convert',
      'fixtures/convert/with-extra-frontmatter',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stderr).toBe('');
    expect(stdout).toContain('Conversion Refused');
    expect(stdout).toContain('UNMAPPED_SOURCE_FRONTMATTER');
    expect(stdout).toContain('- author');
    expect(stdout).toContain('- version');
    expect(stdout).toContain('No output was created.');
    expect(existsSync(out)).toBe(false);
  });

  it('exits 2 when the output already exists and leaves it untouched', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    mkdirSync(out);
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('OUTPUT_ALREADY_EXISTS');
    expect(existsSync(out)).toBe(true);
  });

  it('exits 2 when the source fails generic validation', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/normalize/generic-invalid',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('REFUSED');
    expect(existsSync(out)).toBe(false);
  });

  it('exits 2 for an unsupported target', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'claude',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('Unsupported target');
    expect(existsSync(out)).toBe(false);
  });

  it('does not report a refusal as an unexpected failure', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { stderr } = await run(
      'convert',
      'fixtures/convert/with-extra-frontmatter',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(stderr).not.toContain('unexpected failure');
  });
});

describe('convert fatal errors', () => {
  it('exits 1 for invalid YAML and creates no output', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stderr } = await run(
      'convert',
      'fixtures/invalid-yaml',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('Invalid YAML frontmatter');
    expect(existsSync(out)).toBe(false);
  });

  it('exits 1 for a missing source path', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stderr } = await run(
      'convert',
      'fixtures/does-not-exist',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('Path does not exist');
    expect(existsSync(out)).toBe(false);
  });

  it('exits 1 for an ambiguous source directory', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stderr } = await run(
      'convert',
      'fixtures/ambiguous-markdown',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('Ambiguous skill entry');
  });

  it('exits 1 when the path argument is missing', async () => {
    const { exitCode, stderr } = await run('convert', '--target', 'dsh', '--out', 'x');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain("error: missing required argument 'path'");
  });

  it('reports missing required options on the captured stderr, not the process stream', async () => {
    // A subcommand's output configuration is copied at creation time, so a
    // regression here shows up as a silent failure with empty streams.
    const missingOut = await run('convert', 'fixtures/convert/minimal', '--target', 'dsh');
    const missingTarget = await run('convert', 'fixtures/convert/minimal', '--out', 'unused');

    expect(missingOut.exitCode).toBe(EXIT_FATAL);
    expect(missingOut.stdout).toBe('');
    expect(missingOut.stderr).toContain("required option '--out <directory>' not specified");

    expect(missingTarget.exitCode).toBe(EXIT_FATAL);
    expect(missingTarget.stderr).toContain("required option '--target <target>' not specified");
  });

  it('exits 1 when --out is missing', async () => {
    const { exitCode, stderr } = await run(
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'dsh',
    );

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain("required option '--out <directory>' not specified");
  });
  it('exits 1 when --target is missing', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stderr } = await run('convert', 'fixtures/convert/minimal', '--out', out);

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain("required option '--target <target>' not specified");
  });
});

describe('command surface after Phase 5', () => {
  it('advertises analyze, validate, compat, normalize and convert only', async () => {
    const { stdout } = await run('--help');

    for (const present of ['analyze', 'validate', 'compat', 'normalize', 'convert']) {
      expect(stdout).toContain(present);
    }
    for (const absent of ['import', 'install', 'migrate', 'publish']) {
      expect(stdout).not.toContain(`${absent} `);
    }
  });

  it('documents the required path form in the convert help', async () => {
    const { exitCode, stdout } = await run('convert', '--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Usage: dsh-forge convert <path>');
    expect(stdout).toContain('--target <target>');
    expect(stdout).toContain('--out <directory>');
  });

  it('still prints help with exit code 0', async () => {
    expect((await run('--help')).exitCode).toBe(EXIT_SUCCESS);
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
});

describe('regression: earlier commands still work', () => {
  it('keeps exit codes stable across a mixed sequence', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const analyze = await run('analyze', 'fixtures/valid-skill');
    const validate = await run('validate', 'fixtures/validate-valid');
    const compat = await run('compat', 'fixtures/dsh/compatible-minimal');
    const normalize = await run('normalize', 'fixtures/normalize/minimal');
    const convert = await run(
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect([
      analyze.exitCode,
      validate.exitCode,
      compat.exitCode,
      normalize.exitCode,
      convert.exitCode,
    ]).toEqual([EXIT_SUCCESS, EXIT_SUCCESS, EXIT_SUCCESS, EXIT_SUCCESS, EXIT_SUCCESS]);
    expect(readFileSync(path.join(out, 'SKILL.md'), 'utf8')).toContain('convert-minimal');
  });
});
