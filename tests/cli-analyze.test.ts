/**
 * The `analyze` command through the real CLI runner: exit codes, output streams
 * and the `--help` / `--version` regression.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { readPackageInfo } from '../src/utils/package-info.js';

const fixturesRoot = path.join(process.cwd(), 'fixtures');

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

describe('analyze command', () => {
  it('analyzes a skill directory with exit code 0', async () => {
    const { exitCode, stdout, stderr } = await run('analyze', 'fixtures/valid-skill');

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Skill Analysis');
    expect(stdout).toContain('Name: example-skill');
    expect(stdout).toContain('  Kebab Case: PASS');
  });

  it('analyzes a SKILL.md file path directly', async () => {
    const { exitCode, stdout } = await run('analyze', 'fixtures/valid-skill/SKILL.md');

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Name: example-skill');
    expect(stdout).toContain('Entry File: SKILL.md');
  });

  it('analyzes an absolute path', async () => {
    const { exitCode, stdout } = await run('analyze', path.join(fixturesRoot, 'markdown-entry'));

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Name: markdown-entry');
  });

  it('accepts the leading terminator that pnpm forwards', async () => {
    const { exitCode, stdout } = await run('--', 'analyze', 'fixtures/valid-skill');

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Name: example-skill');
  });

  it('exits 1 with a readable error for a missing path', async () => {
    const { exitCode, stdout, stderr } = await run('analyze', 'fixtures/definitely-not-here');

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('dsh-forge:');
    expect(stderr).toContain('Path does not exist');
  });

  it('exits 1 for invalid YAML frontmatter', async () => {
    const { exitCode, stdout, stderr } = await run('analyze', 'fixtures/invalid-yaml');

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Invalid YAML frontmatter');
  });

  it('exits 1 for an ambiguous Markdown directory and lists the candidates', async () => {
    const { exitCode, stdout, stderr } = await run('analyze', 'fixtures/ambiguous-markdown');

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Ambiguous skill entry');
    expect(stderr).toContain('alpha.md');
    expect(stderr).toContain('beta.md');
  });

  it('exits 1 with an actionable error when the path argument is missing', async () => {
    const { exitCode, stdout, stderr } = await run('analyze');

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain("error: missing required argument 'path'");
    // The message is printed by the analyze action itself, so the failure is
    // reported as a usage error and never as an unexpected failure.
    expect(stderr).not.toContain('unexpected failure');
  });

  it('reports missing name and description through failing checks but still analyzes', async () => {
    const missingName = await run('analyze', 'fixtures/missing-name');
    const missingDescription = await run('analyze', 'fixtures/missing-description');

    expect(missingName.exitCode).toBe(0);
    expect(missingName.stdout).toContain('  Name: FAIL');
    expect(missingName.stdout).toContain('  Description: PASS');

    expect(missingDescription.exitCode).toBe(0);
    expect(missingDescription.stdout).toContain('  Description: FAIL');
    expect(missingDescription.stdout).toContain('  Name: PASS');
  });

  it('reports a non-kebab-case name as a failing check', async () => {
    const { exitCode, stdout } = await run('analyze', 'fixtures/invalid-name');

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Name: Invalid_Name');
    expect(stdout).toContain('  Kebab Case: FAIL');
  });
});

describe('phase 1 command surface', () => {
  it('still prints help with exit code 0', async () => {
    const { exitCode, stdout, stderr } = await run('--help');

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: dsh-forge');
    expect(stdout).toContain('analyze');
    expect(stderr).toBe('');
  });

  it('still prints the version with exit code 0', async () => {
    const { exitCode, stdout, stderr } = await run('--version');

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(readPackageInfo().version);
    expect(stderr).toBe('');
  });

  it('advertises analyze and validate, and no unimplemented command', async () => {
    const { stdout } = await run('--help');

    expect(stdout).toContain('analyze');
    expect(stdout).toContain('validate');
    for (const absent of ['publish', 'import', 'install']) {
      expect(stdout).not.toContain(`${absent} `);
    }
  });

  it('documents the required path form in the analyze help, on stdout', async () => {
    const { exitCode, stdout, stderr } = await run('analyze', '--help');

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: dsh-forge analyze <path>');
    // Help is informational: it must not be reported as a failure or written to
    // the error stream.
    expect(stderr).toBe('');
    expect(stdout).not.toContain('unexpected failure');
  });

  it('rejects an unknown command with exit code 1', async () => {
    const { exitCode, stderr } = await run('publish');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown command');
  });
});
