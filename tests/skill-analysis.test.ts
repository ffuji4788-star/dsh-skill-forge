/**
 * Analysis over the real fixtures: the fixture directory is the input, and the
 * assertions read the rendered report the CLI prints.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeBasicSkill, isKebabCase } from '../src/analyzers/basic-skill-analyzer.js';
import { runAnalyze } from '../src/cli/analyze-command.js';
import { loadLocalSkill } from '../src/importers/local-importer.js';
import { parseFrontmatter } from '../src/parsers/frontmatter-parser.js';
import { buildParsedSkill } from '../src/schemas/skill.js';

const repositoryRoot = process.cwd();
const fixturesRoot = path.join(repositoryRoot, 'fixtures');

function analyzeFixture(name: string): string {
  return runAnalyze(path.join(fixturesRoot, name), { cwd: repositoryRoot });
}

describe('isKebabCase', () => {
  it.each([
    ['example-skill', true],
    ['skill2', true],
    ['a-b-c', true],
    ['Invalid_Name', false],
    ['Invalid-Name', false],
    ['invalid name', false],
    ['-leading', false],
    ['trailing-', false],
    ['double--hyphen', false],
    ['', false],
  ])('accepts or rejects %s', (name, expected) => {
    expect(isKebabCase(name)).toBe(expected);
  });
});

describe('analyzeBasicSkill', () => {
  it('reports counts, frontmatter keys and passing checks for a valid skill', () => {
    const analysis = analyzeBasicSkill(loadLocalSkill(path.join(fixturesRoot, 'valid-skill')));

    expect(analysis.name).toBe('example-skill');
    expect(analysis.description).toContain('minimal example skill');
    expect(analysis.sourceType).toBe('directory');
    expect(analysis.checks.name.passed).toBe(true);
    expect(analysis.checks.description.passed).toBe(true);
    expect(analysis.checks.kebabCase.passed).toBe(true);
    expect(analysis.bodyLength).toBeGreaterThan(0);
    expect(analysis.frontmatterKeys).toEqual(['name', 'description']);
  });

  it('fails the name check when frontmatter has no name', () => {
    const analysis = analyzeBasicSkill(loadLocalSkill(path.join(fixturesRoot, 'missing-name')));

    expect(analysis.name).toBeUndefined();
    expect(analysis.checks.name.passed).toBe(false);
    expect(analysis.checks.name.message).toContain('missing');
    expect(analysis.checks.description.passed).toBe(true);
  });

  it('fails the description check when frontmatter has no description', () => {
    const analysis = analyzeBasicSkill(
      loadLocalSkill(path.join(fixturesRoot, 'missing-description')),
    );

    expect(analysis.description).toBeUndefined();
    expect(analysis.checks.description.passed).toBe(false);
    expect(analysis.checks.name.passed).toBe(true);
  });

  it('fails the kebab-case check for a non-kebab-case name', () => {
    const analysis = analyzeBasicSkill(loadLocalSkill(path.join(fixturesRoot, 'invalid-name')));

    expect(analysis.name).toBe('Invalid_Name');
    expect(analysis.checks.name.passed).toBe(true);
    expect(analysis.checks.kebabCase.passed).toBe(false);
    expect(analysis.checks.kebabCase.message).toContain('Invalid_Name');
  });

  it('marks the kebab-case check not applicable when there is no name', () => {
    const analysis = analyzeBasicSkill(loadLocalSkill(path.join(fixturesRoot, 'missing-name')));

    expect(analysis.checks.kebabCase.passed).toBe(false);
    expect(analysis.checks.kebabCase.message).toContain('no name');
  });

  it('reports no frontmatter keys and no name for a document without frontmatter', () => {
    const { frontmatter, body } = parseFrontmatter('# Untitled\n\nNo metadata at all.\n');
    const analysis = analyzeBasicSkill(
      buildParsedSkill({
        frontmatter,
        body,
        entryFile: path.join(fixturesRoot, 'inline.md'),
        sourceType: 'file',
        resources: [],
      }),
    );

    expect(analysis.frontmatterKeys).toEqual([]);
    expect(analysis.name).toBeUndefined();
    expect(analysis.checks.name.passed).toBe(false);
    expect(analysis.checks.kebabCase.passed).toBe(false);
    expect(analysis.bodyLength).toBeGreaterThan(0);
  });
});

describe('analyze report rendering', () => {
  it('prints every documented field for a valid skill', () => {
    const report = analyzeFixture('valid-skill');

    expect(report).toContain('Skill Analysis');
    expect(report).toContain('Name: example-skill');
    expect(report).toContain('Entry File: fixtures/valid-skill/SKILL.md');
    expect(report).toContain('Resources: 2');
    expect(report).toMatch(/Body Length: \d+/);
    expect(report).toContain('Frontmatter Keys: name, description');
    expect(report).toContain('Basic Checks:');
    expect(report).toContain('  Name: PASS');
    expect(report).toContain('  Description: PASS');
    expect(report).toContain('  Kebab Case: PASS');
    expect(report).toContain('  extra/config.json');
    expect(report).toContain('  reference.md');
  });

  it('shows (none) for values the skill does not declare', () => {
    const report = analyzeFixture('missing-name');

    expect(report).toContain('Name: (none)');
    expect(report).toContain('  Name: FAIL');
    expect(report).toContain('  Description: PASS');
  });

  it('reports the failure reason for a non-kebab-case name', () => {
    const report = analyzeFixture('invalid-name');

    expect(report).toContain('  Kebab Case: FAIL');
    expect(report).toContain('is not kebab-case');
  });

  it('shows a relative entry file path, not an absolute machine path', () => {
    const report = analyzeFixture('valid-skill');

    expect(report).not.toContain(repositoryRoot);
    expect(report).toContain('fixtures/valid-skill/SKILL.md');
  });

  it('omits the resource section when a skill has no resources', () => {
    const report = analyzeFixture('missing-description');

    expect(report).toContain('Resources: 0');
    expect(report).not.toContain('Resource Files:');
  });
});
