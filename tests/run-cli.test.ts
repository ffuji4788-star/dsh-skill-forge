import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { describeNodeRequirement, readPackageInfo } from '../src/utils/package-info.js';

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

describe('runCli', () => {
  it('prints the package version and exits successfully for --version', async () => {
    const { exitCode, stdout, stderr } = await run('--version');

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(readPackageInfo().version);
    expect(stderr).toBe('');
  });

  it('prints the package version for the -v alias', async () => {
    const { exitCode, stdout } = await run('-v');

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(readPackageInfo().version);
  });

  it('prints usage, options and the Node.js requirement for --help', async () => {
    const { exitCode, stdout, stderr } = await run('--help');
    const { nodeRequirement } = readPackageInfo();

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: dsh-forge');
    expect(stdout).toContain('-h, --help');
    expect(stdout).toContain('-v, --version');
    expect(stdout).toContain('never executes');
    // Derived from package.json engines rather than hard-coded here. If the
    // package declares no requirement this compares against an empty string,
    // which cannot accidentally pass because the footer then prints a pointer to
    // package.json instead of a requirement.
    expect(nodeRequirement).toBe('>=20.19.0');
    expect(stdout).toContain(describeNodeRequirement(nodeRequirement ?? ''));
    expect(stderr).toBe('');
  });

  it('prints the same help for the -h alias', async () => {
    const long = await run('--help');
    const short = await run('-h');

    expect(short.exitCode).toBe(0);
    expect(short.stdout).toBe(long.stdout);
  });

  it('rejects an unimplemented command with a message that names it', async () => {
    const { exitCode, stdout, stderr } = await run('convert');

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain("unknown command 'convert'");
  });

  // `pnpm dev -- --help` forwards the terminator itself, so this is the exact
  // argument list the documented command produces.
  it('handles the terminator that pnpm forwards for --help', async () => {
    const { exitCode, stdout, stderr } = await run('--', '--help');

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: dsh-forge');
    expect(stderr).toBe('');
  });

  it('handles the terminator that pnpm forwards for --version', async () => {
    const { exitCode, stdout } = await run('--', '--version');

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(readPackageInfo().version);
  });

  it('does not let a benign exit code leak as a failure', async () => {
    const { exitCode } = await run('--help');

    expect(exitCode).toBe(0);
  });
});
