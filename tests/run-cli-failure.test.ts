/**
 * Verifies the CLI error boundary: an unexpected (non-Commander) failure must be
 * reported on stderr with a readable message and a non-zero exit code, instead
 * of crashing the process or being swallowed.
 */
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

const { createProgramMock } = vi.hoisted(() => ({
  createProgramMock: vi.fn(),
}));

vi.mock('../src/cli/program.js', () => ({
  createProgram: createProgramMock,
  // `runCli` also imports this helper; the mock must provide it, and the real
  // implementation is pure so it is safe to keep. It matches the real behaviour
  // of removing only the leading terminator that pnpm forwards.
  stripOptionTerminator: (argv: readonly string[]): string[] =>
    argv[0] === '--' ? argv.slice(1) : [...argv],
}));

describe('runCli failure handling', () => {
  it('reports an unexpected failure with its message and exits with code 1', async () => {
    const { runCli } = await import('../src/cli/run.js');

    const throwingProgram = new Command().name('dsh-forge');
    throwingProgram.parseAsync = () => Promise.reject(new Error('simulated crash'));
    createProgramMock.mockReturnValue(throwingProgram);

    let stdout = '';
    let stderr = '';
    const exitCode = await runCli({
      // Not a help request, so the run reaches the injected failure.
      argv: ['analyze', 'some-path'],
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    // The message itself is asserted by substring: module runners such as Vite
    // append their own wrapper to `Error.message`, which is out of this code's
    // control, while the prefix and the newline are not.
    expect(stderr.startsWith('dsh-forge: unexpected failure: ')).toBe(true);
    expect(stderr).toContain('simulated crash');
    expect(stderr.endsWith('\n')).toBe(true);
  });
});
