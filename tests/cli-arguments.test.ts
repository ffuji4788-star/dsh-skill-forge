/**
 * Covers how the CLI reacts to operands and flags at the argument-parsing level.
 *
 * Flags must stay flags, an operand must be rejected by name, and the `--`
 * terminator that pnpm forwards (as in `pnpm dev -- --help`) must be removed
 * before parsing without turning flags into operands.
 */
import type { Command, CommanderError } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { createProgram, stripOptionTerminator } from '../src/cli/program.js';
import { readPackageInfo } from '../src/utils/package-info.js';

function parse(argv: readonly string[]): Promise<Command> {
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return program.parseAsync(stripOptionTerminator(argv), { from: 'user' });
}

async function parseAndCaptureError(argv: readonly string[]): Promise<CommanderError> {
  try {
    await parse(argv);
  } catch (error) {
    return error as CommanderError;
  }
  throw new Error(`Expected parsing ${JSON.stringify(argv)} to fail, but it succeeded.`);
}

describe('stripOptionTerminator', () => {
  it('removes the leading terminator that pnpm forwards', () => {
    expect(stripOptionTerminator(['--', '--help'])).toEqual(['--help']);
  });

  it('removes the leading terminator before a command and its argument', () => {
    expect(stripOptionTerminator(['--', 'analyze', 'fixtures/valid-skill'])).toEqual([
      'analyze',
      'fixtures/valid-skill',
    ]);
  });

  it('leaves an argument list without a terminator unchanged', () => {
    expect(stripOptionTerminator(['--help'])).toEqual(['--help']);
  });

  it('returns an empty list for an empty argument list', () => {
    expect(stripOptionTerminator([])).toEqual([]);
  });

  it('does not strip an interior terminator, which may belong to a user argument', () => {
    expect(stripOptionTerminator(['analyze', '--', '--weird-path'])).toEqual([
      'analyze',
      '--',
      '--weird-path',
    ]);
  });

  it('does not strip arguments that merely contain dashes', () => {
    expect(stripOptionTerminator(['--verbose-ish', '--'])).toEqual(['--verbose-ish', '--']);
  });
});

describe('flag parsing', () => {
  it('treats --help as a flag', async () => {
    const error = await parseAndCaptureError(['--help']);

    expect(error.code).toBe('commander.helpDisplayed');
  });

  it('treats --version as a flag', async () => {
    const error = await parseAndCaptureError(['--version']);

    expect(error.code).toBe('commander.version');
  });

  it('treats a terminator followed by --help as a flag', async () => {
    const error = await parseAndCaptureError(['--', '--help']);

    expect(error.code).toBe('commander.helpDisplayed');
  });

  it('treats a terminator followed by --version as a flag', async () => {
    const error = await parseAndCaptureError(['--', '--version']);

    expect(error.code).toBe('commander.version');
  });

  it('reports the package version through --version', async () => {
    const writeOut = vi.fn();
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeOut, writeErr: () => {} });

    await expect(program.parseAsync(['--version'], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.version',
    });

    expect(writeOut).toHaveBeenCalledWith(`${readPackageInfo().version}\n`);
  });
});

describe('operand rejection', () => {
  // `analyze` and `validate` are real commands, so only unimplemented commands
  // are rejected here.
  it.each([
    ['convert', ['convert']],
    ['import', ['import']],
    ['convert after a terminator', ['--', 'convert']],
  ])('rejects %s with a message naming it', async (_label, argv) => {
    const error = await parseAndCaptureError(argv);

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('unknown command');
    expect(error.message).toContain(argv[argv.length - 1]);
  });
});
