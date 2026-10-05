import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli/program.js';
import { readPackageInfo } from '../src/utils/package-info.js';

describe('createProgram', () => {
  it('creates a Command instance', () => {
    expect(createProgram()).toBeInstanceOf(Command);
  });

  it('uses the package version, so --version cannot drift from package.json', () => {
    expect(createProgram().version()).toBe(readPackageInfo().version);
  });

  it('names the executable dsh-forge and describes it from package.json', () => {
    const program = createProgram();

    expect(program.name()).toBe('dsh-forge');
    expect(program.description()).toBe(readPackageInfo().description);
  });

  it('documents --help and --version in the generated help text', () => {
    const help = createProgram().helpInformation();

    expect(help).toContain('Usage: dsh-forge');
    expect(help).toContain('-h, --help');
    expect(help).toContain('-v, --version');
  });

  it('contains the package description in the generated help text', () => {
    expect(createProgram().helpInformation()).toContain(readPackageInfo().description);
  });

  it('describes the --version option in the generated help text', () => {
    expect(createProgram().helpInformation()).toContain('Print the dsh-forge version and exit.');
  });

  // Note: the Node.js requirement is printed by the `addHelpText('after', ...)`
  // footer, which `helpInformation()` does not include. It is asserted against
  // the rendered `--help` output in tests/run-cli.test.ts instead.
  it('derives the documented Node.js requirement from the package metadata', () => {
    expect(readPackageInfo().nodeRequirement).toBe('>=20.19.0');
  });

  it('registers exactly the six implemented commands', () => {
    const commands = createProgram().commands;

    expect(commands.map((command) => command.name())).toEqual([
      'analyze',
      'validate',
      'compat',
      'normalize',
      'assess',
      'convert',
    ]);
  });
});
