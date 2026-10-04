/**
 * Phase 1 `analyze` regression coverage, including the shared-name-rule refactor
 * that Phase 2 introduced.
 *
 * The importer and security boundaries are covered by `local-importer.test.ts`
 * and `security.test.ts`; this suite pins the behaviour `analyze` must keep.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isKebabCase } from '../src/analyzers/basic-skill-analyzer.js';
import { runAnalyze } from '../src/cli/analyze-command.js';
import { runCli } from '../src/cli/run.js';
import { findSkillNameProblem } from '../src/utils/skill-name.js';

const repositoryRoot = process.cwd();
const fixturesRoot = path.join(repositoryRoot, 'fixtures');

function analyzeFixture(name: string): string {
  return runAnalyze(path.join(fixturesRoot, name), { cwd: repositoryRoot });
}

describe('analyze behaviour is unchanged', () => {
  it('reports a valid skill exactly as before', () => {
    const report = analyzeFixture('valid-skill');

    expect(report).toContain('Name: example-skill');
    expect(report).toContain('Entry File: SKILL.md');
    expect(report).toContain('Resources: 2');
    expect(report).toContain('Frontmatter Keys: name, description');
    expect(report).toContain('  Name: PASS');
    expect(report).toContain('  Description: PASS');
    expect(report).toContain('  Kebab Case: PASS');
  });

  it('still shows (none) and FAIL for a skill without a name', () => {
    const report = analyzeFixture('missing-name');

    expect(report).toContain('Name: (none)');
    expect(report).toContain('  Name: FAIL');
    expect(report).toContain('  Kebab Case: FAIL (not applicable (no name to check))');
  });

  it('keeps the kebab-case failure wording from Phase 1', () => {
    const report = analyzeFixture('invalid-name');

    expect(report).toContain('  Kebab Case: FAIL');
    expect(report).toMatch(/"Invalid_Name" .*is not kebab-case/);
  });

  it('still exits 0 for a skill whose checks fail, because analyze is not a validator', async () => {
    let stdout = '';
    const exitCode = await runCli({
      argv: ['analyze', 'fixtures/missing-name'],
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('  Name: FAIL');
  });

  it('still exits 1 for invalid YAML', async () => {
    let stderr = '';
    const exitCode = await runCli({
      argv: ['analyze', 'fixtures/invalid-yaml'],
      stdout: () => {},
      stderr: (text) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid YAML frontmatter');
  });
});

describe('shared name rule serves both commands', () => {
  it('is re-exported by the analyzer for existing callers', () => {
    expect(isKebabCase('example-skill')).toBe(true);
    expect(isKebabCase('Invalid_Name')).toBe(false);
  });

  it('agrees with the analyzer on every boundary case', () => {
    const cases = [
      ['my-skill', true],
      ['MySkill', false],
      ['my_skill', false],
      ['my--skill', false],
      ['-my-skill', false],
      ['my-skill-', false],
      ['my.skill', false],
      ['my/skill', false],
      ['my\\skill', false],
      ['.', false],
      ['..', false],
      ['../escape', false],
    ] as const;

    for (const [name, expected] of cases) {
      // The analyzer's check and the shared problem finder must never disagree.
      expect(isKebabCase(name)).toBe(expected);
      expect(findSkillNameProblem(name) === undefined).toBe(expected);
    }
  });

  it('reports a specific reason for every rejected name', () => {
    for (const name of ['my/skill', 'my\\skill', '.', '..', 'bad\u0000name', 'My_Skill']) {
      expect(findSkillNameProblem(name)).toBeTypeOf('string');
    }
  });
});

describe('Windows path handling and boundaries', () => {
  it('accepts a forward-slash path on every platform', () => {
    const posixStyle = `${fixturesRoot.split(path.sep).join('/')}/valid-skill`;

    expect(analyzeFixture('valid-skill')).toBe(runAnalyze(posixStyle, { cwd: repositoryRoot }));
  });

  it('resolves a traversal-style path without escaping the intended directory', () => {
    const traversed = runAnalyze(path.join(fixturesRoot, 'valid-skill', '..', 'valid-skill'), {
      cwd: repositoryRoot,
    });

    expect(traversed).toContain('Name: example-skill');
  });

  it('still refuses an ambiguous directory', async () => {
    let stderr = '';
    const exitCode = await runCli({
      argv: ['analyze', 'fixtures/ambiguous-markdown'],
      stdout: () => {},
      stderr: (text) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Ambiguous skill entry');
  });

  it('still refuses a path that does not exist', async () => {
    let stderr = '';
    const exitCode = await runCli({
      argv: ['analyze', 'fixtures/does-not-exist'],
      stdout: () => {},
      stderr: (text) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Path does not exist');
  });
});
