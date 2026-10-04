/**
 * The `normalize` command's IR version and source selection.
 *
 * The promise under test: v1 is the default and is byte-stable, v2 appears only
 * when requested, and neither the version nor the source is ever inferred.
 */
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { DEFAULT_IR_VERSION, SUPPORTED_IR_VERSIONS } from '../src/cli/normalize-command.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';

async function run(
  ...argv: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

const genericFixture = 'fixtures/normalize/minimal';
const agentFixture = 'fixtures/sources/agent-skills/with-metadata-check';

describe('IR version selection', () => {
  it('defaults to v1', () => {
    expect(DEFAULT_IR_VERSION).toBe(1);
    expect(SUPPORTED_IR_VERSIONS).toEqual([1, 2]);
  });

  it('emits v1 with no flag', async () => {
    const { exitCode, stdout } = await run('normalize', genericFixture);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1 });
  });

  it('emits byte-identical v1 for an explicit --ir-version 1', async () => {
    const implicit = await run('normalize', genericFixture);
    const explicit = await run('normalize', genericFixture, '--ir-version', '1');

    expect(explicit.exitCode).toBe(EXIT_SUCCESS);
    expect(explicit.stdout).toBe(implicit.stdout);
  });

  it('emits v2 only when asked', async () => {
    const v1 = await run('normalize', genericFixture);
    const v2 = await run('normalize', genericFixture, '--ir-version', '2');

    expect(v2.exitCode).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(v2.stdout) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(2);
    expect(parsed['semantics']).toEqual({});
    expect(v2.stdout).not.toBe(v1.stdout);
  });

  it('does not switch to v2 just because a source is named', async () => {
    const { exitCode, stdout } = await run('normalize', agentFixture, '--source', 'agent-skills');

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(1);
    // v1 has no semantics object, so the interpreted field stays raw source data.
    expect(parsed).not.toHaveProperty('semantics');
    expect((parsed['source'] as Record<string, unknown>)['extraFrontmatter']).toEqual({
      metadata: { author: 'example-org', version: '1.0' },
    });
  });

  it('refuses an unsupported IR version deterministically', async () => {
    const { exitCode, stdout, stderr } = await run(
      'normalize',
      genericFixture,
      '--ir-version',
      '3',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toBe('');
    expect(stderr).toContain('unsupported IR version 3');
    expect(stderr).toContain('1, 2');
  });

  it('rejects a non-numeric IR version as a usage error', async () => {
    const { exitCode, stderr } = await run('normalize', genericFixture, '--ir-version', 'latest');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain("option '--ir-version <version>' expects an integer");
  });

  it('has no "latest" alias', async () => {
    const { exitCode } = await run('normalize', genericFixture, '--ir-version', 'latest');
    expect(exitCode).not.toBe(EXIT_SUCCESS);
  });
});

describe('v2 semantic lifting through the CLI', () => {
  it('lifts metadata for an Agent Skill and removes it from the envelope', async () => {
    const { exitCode, stdout } = await run(
      'normalize',
      agentFixture,
      '--source',
      'agent-skills',
      '--ir-version',
      '2',
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(2);
    expect(parsed['semantics']).toEqual({ metadata: { author: 'example-org', version: '1.0' } });
    expect((parsed['source'] as Record<string, unknown>)['extraFrontmatter']).toEqual({});
    expect((parsed['source'] as Record<string, unknown>)['format']).toBe('agent-skills');
  });

  it('keeps allowed-tools in the envelope at v2', async () => {
    const { stdout } = await run(
      'normalize',
      'fixtures/sources/agent-skills/with-allowed-tools-check',
      '--source',
      'agent-skills',
      '--ir-version',
      '2',
    );

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['semantics']).toEqual({});
    expect((parsed['source'] as Record<string, unknown>)['extraFrontmatter']).toEqual({
      'allowed-tools': 'Bash(git:*) Bash(jq:*) Read',
    });
  });

  it('lifts license and compatibility at v2', async () => {
    const license = await run(
      'normalize',
      'fixtures/sources/agent-skills/with-license',
      '--source',
      'agent-skills',
      '--ir-version',
      '2',
    );
    const compatibility = await run(
      'normalize',
      'fixtures/sources/agent-skills/with-compatibility-check',
      '--source',
      'agent-skills',
      '--ir-version',
      '2',
    );

    expect((JSON.parse(license.stdout) as Record<string, unknown>)['semantics']).toEqual({
      license: 'Apache-2.0',
    });
    expect((JSON.parse(compatibility.stdout) as Record<string, unknown>)['semantics']).toEqual({
      compatibility: 'Requires git, docker and access to the internet',
    });
  });

  it('does not lift anything for the generic path even at v2', async () => {
    const { stdout } = await run(
      'normalize',
      'fixtures/convert/with-extra-frontmatter',
      '--ir-version',
      '2',
    );

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['semantics']).toEqual({});
    expect((parsed['source'] as Record<string, unknown>)['extraFrontmatter']).toEqual({
      author: 'Alice',
      version: 2,
    });
  });

  it('refuses an unknown source', async () => {
    const { exitCode, stderr } = await run(
      'normalize',
      genericFixture,
      '--source',
      'claude',
      '--ir-version',
      '2',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stderr).toContain('UNKNOWN_SOURCE');
  });

  it('refuses a source package that is not an Agent Skills directory', async () => {
    const { exitCode, stderr } = await run(
      'normalize',
      'fixtures/sources/agent-skills/pdf-processing/SKILL.md',
      '--source',
      'agent-skills',
      '--ir-version',
      '2',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stderr).toContain('SOURCE_PACKAGE_SHAPE_INVALID');
  });

  it('produces deterministic v2 output across runs', async () => {
    const first = await run(agentFixture, '--source', 'agent-skills', '--ir-version', '2');
    const second = await run(agentFixture, '--source', 'agent-skills', '--ir-version', '2');
    void first;

    expect(second.stdout).toBe(
      (await run(agentFixture, '--source', 'agent-skills', '--ir-version', '2')).stdout,
    );
  });
});

describe('v1 output stability', () => {
  it('keeps v1 output identical across every existing fixture', async () => {
    const fixtures = [
      'fixtures/normalize/minimal',
      'fixtures/normalize/with-extra-frontmatter',
      'fixtures/normalize/with-resources',
      'fixtures/normalize/crlf',
      'fixtures/convert/minimal',
      'fixtures/convert/with-resource',
    ];

    for (const fixture of fixtures) {
      const implicit = await run('normalize', fixture);
      const explicit = await run('normalize', fixture, '--ir-version', '1');

      expect(implicit.exitCode).toBe(EXIT_SUCCESS);
      expect(explicit.stdout).toBe(implicit.stdout);

      const parsed = JSON.parse(implicit.stdout) as Record<string, unknown>;
      expect(parsed['schemaVersion']).toBe(1);
      expect(parsed).not.toHaveProperty('semantics');
    }
  });

  it('still refuses a generically invalid skill with no partial document', async () => {
    const { exitCode, stdout, stderr } = await run(
      'normalize',
      'fixtures/normalize/generic-invalid',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toBe('');
    expect(stderr).toContain('generic validation failed');
  });

  it('still refuses a generically invalid skill at v2 as well', async () => {
    const { exitCode, stdout } = await run(
      'normalize',
      'fixtures/normalize/generic-invalid',
      '--ir-version',
      '2',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toBe('');
  });

  it('keeps malformed YAML fatal in both versions', async () => {
    for (const version of ['1', '2']) {
      const { exitCode, stderr } = await run(
        'normalize',
        'fixtures/invalid-yaml',
        '--ir-version',
        version,
      );

      expect(exitCode).toBe(EXIT_FATAL);
      expect(stderr).toContain('Invalid YAML frontmatter');
    }
  });
});

describe('command surface', () => {
  it('documents both new options', async () => {
    const { exitCode, stdout } = await run('normalize', '--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('--ir-version <version>');
    expect(stdout).toContain('--source <source>');
    expect(stdout).toContain('defaults to 1');
  });

  it('keeps help and version working', async () => {
    expect((await run('--help')).exitCode).toBe(EXIT_SUCCESS);
    expect((await run('--version')).exitCode).toBe(EXIT_SUCCESS);
  });

  it('rejects an unknown command with exit code 1', async () => {
    const { exitCode, stderr } = await run('publish');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('unknown command');
  });
});
