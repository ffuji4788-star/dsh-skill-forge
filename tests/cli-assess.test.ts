/**
 * The `assess` command, and its parity with a real conversion.
 *
 * The property that matters: an assessment must never claim a skill converts when
 * it would not, and never claim a refusal that does not exist. Both commands are
 * driven here through the real CLI, so the report a user sees is what is compared.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { CONVERSION_CODES } from '../src/schemas/conversion.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-assess-cli-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

/** Every fixture pair used for the parity matrix. */
const PARITY_CASES: readonly {
  readonly label: string;
  readonly path: string;
  readonly source: boolean;
}[] = [
  { label: 'agent minimal', path: 'fixtures/sources/agent-skills/pdf-processing', source: true },
  { label: 'agent metadata', path: 'fixtures/sources/agent-skills/metadata-skill', source: true },
  { label: 'agent resources', path: 'fixtures/sources/agent-skills/data-analysis', source: true },
  { label: 'agent license', path: 'fixtures/sources/agent-skills/with-license', source: true },
  {
    label: 'agent compatibility',
    path: 'fixtures/sources/agent-skills/with-compatibility-check',
    source: true,
  },
  {
    label: 'agent allowed-tools',
    path: 'fixtures/sources/agent-skills/with-allowed-tools-check',
    source: true,
  },
  { label: 'generic minimal', path: 'fixtures/convert/minimal', source: false },
  { label: 'generic resource', path: 'fixtures/convert/with-resource', source: false },
  { label: 'generic directory', path: 'fixtures/convert/with-directory-resource', source: false },
  { label: 'generic binary', path: 'fixtures/convert/with-binary-resource', source: false },
  { label: 'generic script', path: 'fixtures/convert/with-script-resource', source: false },
  {
    label: 'generic extra frontmatter',
    path: 'fixtures/convert/with-extra-frontmatter',
    source: false,
  },
];

describe('assess and convert never disagree', () => {
  it.each(PARITY_CASES.map((entry) => [entry.label, entry.path, entry.source] as const))(
    'agrees on %s',
    async (label, fixturePath, usesSource) => {
      const sourceArgs = usesSource ? ['--source', 'agent-skills'] : [];
      const out = path.join(temporaryRoot(), 'generated');

      const assessed = await run('assess', fixturePath, ...sourceArgs, '--target', 'dsh');
      const converted = await run(
        'convert',
        fixturePath,
        ...sourceArgs,
        '--target',
        'dsh',
        '--out',
        out,
      );

      const assessConvertible = assessed.exitCode === EXIT_SUCCESS;
      const convertSucceeded = converted.exitCode === EXIT_SUCCESS;

      expect(assessConvertible).toBe(convertSucceeded);
      if (assessConvertible) {
        expect(assessed.stdout).toContain('Result:\nCONVERTIBLE');
        expect(existsSync(path.join(out, 'SKILL.md'))).toBe(true);
      } else {
        expect(assessed.stdout).toContain('Convertible:\nNO');
      }
      void label;
    },
  );
});

describe('assess verdicts', () => {
  it('reports a minimal Agent Skill as convertible with exit 0', async () => {
    const { exitCode, stdout, stderr } = await run(
      'assess',
      'fixtures/sources/agent-skills/pdf-processing',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('DSH Skill Assessment');
    expect(stdout).toContain('CONVERTIBLE');
    expect(stdout).toContain('Source Contract:\nPASS');
    expect(stdout).toContain('Convertible:\nYES');
  });

  it('reports a license refusal at exit 2 with the stage named', async () => {
    const { exitCode, stdout } = await run(
      'assess',
      'fixtures/sources/agent-skills/with-license',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unsupportedTargetSemantic);
    expect(stdout).toContain('stage: SEMANTIC');
    expect(stdout).toContain('- license');
    expect(stdout).toContain('Semantics:\nREFUSED');
  });

  it('reports allowed-tools as unmapped source data', async () => {
    const { exitCode, stdout } = await run(
      'assess',
      'fixtures/sources/agent-skills/with-allowed-tools-check',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unmappedSourceFrontmatter);
    expect(stdout).not.toContain(CONVERSION_CODES.unsupportedTargetSemantic);
  });

  it('reports an invalid source contract as SOURCE_INVALID and skips later stages', async () => {
    const { exitCode, stdout } = await run(
      'assess',
      'fixtures/sources/agent-skills/unknown-key-check',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('SOURCE_INVALID');
    expect(stdout).toContain('IR:\nSKIPPED');
    expect(stdout).toContain('Semantics:\nSKIPPED');
  });

  it('reports an unsupported target at the TARGET stage', async () => {
    const { exitCode, stdout } = await run(
      'assess',
      'fixtures/sources/agent-skills/pdf-processing',
      '--source',
      'agent-skills',
      '--target',
      'claude',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('Target Contract:\nREFUSED');
    expect(stdout).toContain(CONVERSION_CODES.unsupportedTarget);
    expect(stdout).toContain('stage: TARGET');
  });

  it('reports the same code as convert for an unsupported target', async () => {
    // Phase 8 renamed the mislabeled `UNSUPPORTED_RESOURCE` code this refusal
    // used; assess and convert must agree on it.
    const assessed = await run('assess', 'fixtures/convert/minimal', '--target', 'claude');
    const converted = await run(
      'convert',
      'fixtures/convert/minimal',
      '--target',
      'claude',
      '--out',
      path.join(temporaryRoot(), 'generated'),
    );

    expect(assessed.stdout).toContain(CONVERSION_CODES.unsupportedTarget);
    expect(converted.stdout).toContain(CONVERSION_CODES.unsupportedTarget);
    expect(converted.exitCode).toBe(EXIT_VALIDATION_FAILED);
  });

  it('reports an unknown source', async () => {
    const { exitCode, stdout } = await run(
      'assess',
      'fixtures/convert/minimal',
      '--source',
      'claude',
      '--target',
      'dsh',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('SOURCE_INVALID');
    expect(stdout).toContain('UNKNOWN_SOURCE');
  });
});

describe('assess writes nothing', () => {
  it('leaves no output, staging or temp directory behind', async () => {
    const parent = temporaryRoot();
    const before = readdirSync(parent).sort();

    await run(
      'assess',
      'fixtures/sources/agent-skills/with-license',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
    );

    expect(readdirSync(parent).sort()).toEqual(before);
    expect(readdirSync(parent)).toEqual([]);
  });

  it('leaves the assessed skill byte-identical and mtime-stable', async () => {
    const dir = path.join(repositoryRoot, 'fixtures', 'sources', 'agent-skills', 'data-analysis');
    const snapshot = (): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .map((entry) => path.join(entry.parentPath, entry.name))
        .filter((entry) => statSync(entry).isFile())
        .map(
          (file) => `${path.relative(dir, file)}:${statSync(file).size}:${statSync(file).mtimeMs}`,
        )
        .sort();

    const before = snapshot();
    await run('assess', dir, '--source', 'agent-skills', '--target', 'dsh');

    expect(snapshot()).toEqual(before);
  });

  it('does not print the absolute source path', async () => {
    const { stdout } = await run(
      'assess',
      'fixtures/sources/agent-skills/metadata-skill',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
    );

    expect(stdout).not.toContain(repositoryRoot);
    expect(stdout).not.toContain(tmpdir());
  });

  it('produces byte-identical stdout across repeated runs', async () => {
    const args = [
      'assess',
      'fixtures/sources/agent-skills/with-all-optionals-check',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
    ];
    const first = await run(...args);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await run(...args)).stdout).toBe(first.stdout);
    }
  });
});

describe('assess command surface', () => {
  it('rejects a missing path argument', async () => {
    const { exitCode, stderr } = await run('assess', '--target', 'dsh');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain("error: missing required argument 'path'");
  });

  it('rejects a missing --target', async () => {
    const { exitCode, stderr } = await run('assess', 'fixtures/convert/minimal');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain("required option '--target <target>' not specified");
  });

  it('has no --out option', async () => {
    const { exitCode, stderr } = await run(
      'assess',
      'fixtures/convert/minimal',
      '--target',
      'dsh',
      '--out',
      'somewhere',
    );

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain("unknown option '--out'");
  });

  it('exits 1 for a missing source path', async () => {
    const { exitCode, stderr } = await run('assess', 'fixtures/does-not-exist', '--target', 'dsh');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('Path does not exist');
  });

  it('exits 1 for malformed YAML', async () => {
    const { exitCode, stderr } = await run('assess', 'fixtures/invalid-yaml', '--target', 'dsh');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('Invalid YAML frontmatter');
  });

  it('documents itself in help', async () => {
    const { exitCode, stdout } = await run('assess', '--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Usage: dsh-forge assess <path>');
    expect(stdout).toContain('--target <target>');
    expect(stdout).toContain('without writing anything');
  });

  it('appears in the root help', async () => {
    const { stdout } = await run('--help');

    expect(stdout).toContain('assess [options] [path]');
  });
});
