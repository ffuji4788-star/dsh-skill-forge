/**
 * The deterministic validator, exercised through the real `runValidate` path so
 * the importer, parser and validator are covered together.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runValidate } from '../src/cli/validate-command.js';
import { loadLocalSkill } from '../src/importers/local-importer.js';
import { parseFrontmatter } from '../src/parsers/frontmatter-parser.js';
import { buildParsedSkill, type ParsedSkill } from '../src/schemas/skill.js';
import {
  KNOWN_FRONTMATTER_KEYS,
  VALIDATION_CODES,
  validateBasicSkill,
} from '../src/validators/basic-skill-validator.js';

const repositoryRoot = process.cwd();
const fixturesRoot = path.join(repositoryRoot, 'fixtures');

function validateFixture(name: string): ReturnType<typeof runValidate> {
  return runValidate(path.join(fixturesRoot, name), { cwd: repositoryRoot });
}

/** Builds a skill from inline content, for cases a file cannot express cleanly. */
function skillFrom(content: string): ParsedSkill {
  const { frontmatter, body } = parseFrontmatter(content);

  return buildParsedSkill({
    frontmatter,
    body,
    entryFile: path.join(fixturesRoot, 'inline', 'SKILL.md'),
    sourceType: 'file',
    resources: [],
  });
}

describe('valid skill', () => {
  it('passes with no errors and no warnings', () => {
    const { result, report } = validateFixture('validate-valid');

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(report).toContain('Result: PASS');
    expect(report).toContain('Name: validate-valid');
    expect(report).toContain('Entry File: SKILL.md');
    expect(report).not.toContain('Errors\n');
    expect(report).not.toContain('Warnings\n');
  });

  it('accepts a direct SKILL.md path', () => {
    const fromDirectory = validateFixture('validate-valid');
    const fromFile = runValidate(path.join(fixturesRoot, 'validate-valid', 'SKILL.md'), {
      cwd: repositoryRoot,
    });

    expect(fromFile.result.valid).toBe(true);
    expect(fromFile.report).toBe(fromDirectory.report);
  });
});

describe('unknown frontmatter keys', () => {
  it('warns without failing validation', () => {
    const { result, report } = validateFixture('validate-warning-unknown-key');

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      VALIDATION_CODES.unknownFrontmatterKey,
      VALIDATION_CODES.unknownFrontmatterKey,
    ]);
    expect(report).toContain('Result: PASS');
    expect(report).toContain('Warnings: 2');
    expect(report).toContain('UNKNOWN_FRONTMATTER_KEY: Unknown frontmatter key: author');
    expect(report).toContain('UNKNOWN_FRONTMATTER_KEY: Unknown frontmatter key: version');
  });

  it('orders unknown keys alphabetically regardless of document order', () => {
    const inDocumentOrder = skillFrom(
      '---\nname: keys-skill\ndescription: d\nzulu: 1\nalpha: 2\n---\nBody\n',
    );
    const reversed = skillFrom(
      '---\nname: keys-skill\ndescription: d\nalpha: 2\nzulu: 1\n---\nBody\n',
    );

    const first = validateBasicSkill(inDocumentOrder).warnings.map((issue) => issue.message);
    const second = validateBasicSkill(reversed).warnings.map((issue) => issue.message);

    expect(first).toEqual(['Unknown frontmatter key: alpha', 'Unknown frontmatter key: zulu']);
    expect(second).toEqual(first);
  });

  it('only understands name and description', () => {
    expect([...KNOWN_FRONTMATTER_KEYS].sort()).toEqual(['description', 'name']);
  });
});

describe('name rules', () => {
  it('fails when name is absent', () => {
    const { result, report } = validateFixture('validate-missing-name');

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.missingName]);
    expect(report).toContain('Result: FAIL');
    expect(report).toContain('MISSING_NAME: Missing required field: name');
  });

  it('fails when name is not kebab-case', () => {
    const { result, report } = validateFixture('validate-invalid-name');

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.invalidName]);
    expect(report).toContain('INVALID_NAME');
    expect(report).toContain('"Invalid_Name" is not kebab-case');
  });

  it.each([
    ['my_skill', 'underscore'],
    ['My Skill', 'space'],
    ['my--skill', 'double hyphen'],
    ['-my-skill', 'leading hyphen'],
    ['my-skill-', 'trailing hyphen'],
    ['my.skill', 'dot'],
    ['.', 'single dot'],
    ['..', 'double dot'],
    ['my/skill', 'forward slash'],
    ['../escape', 'traversal'],
    ['foo/../bar', 'traversal with separator'],
    ['MY-SKILL', 'upper case'],
  ])('fails for %j (%s)', (name) => {
    const result = validateBasicSkill(
      skillFrom(`---\nname: "${name}"\ndescription: A description.\n---\nBody\n`),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.invalidName]);
  });

  it('reports a control character in a name', () => {
    // `\t` inside double quotes is a YAML escape that decodes to a real tab, so
    // the validator sees a control character in the name.
    const result = validateBasicSkill(
      skillFrom('---\nname: "bad\\tname"\ndescription: A description.\n---\nBody\n'),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe(VALIDATION_CODES.invalidName);
    expect(result.errors[0]?.message).toContain('control characters');
  });

  it('reports a backslash in a name written as a single-quoted scalar', () => {
    // A backslash cannot be written inside a double-quoted YAML scalar (`\s` is
    // an invalid escape there), so YAML authors use a single-quoted scalar. The
    // validator must still see the backslash and reject it.
    const result = validateBasicSkill(
      skillFrom("---\nname: 'my\\\\skill'\ndescription: A description.\n---\nBody\n"),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.invalidName]);
    expect(result.errors[0]?.message).toContain('path separator');
  });

  it('fails when name is whitespace only', () => {
    const result = validateBasicSkill(
      skillFrom('---\nname: "  "\ndescription: A description.\n---\nBody\n'),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.emptyName]);
  });

  it.each([
    ['a number', 'name: 123'],
    ['a boolean', 'name: true'],
    ['null', 'name: null'],
    ['a mapping', 'name: {a: 1}'],
    ['a sequence', 'name: [a, b]'],
  ])('reports a non-string name (%s) as unusable rather than missing', (_label, frontmatter) => {
    const result = validateBasicSkill(
      skillFrom(`---\n${frontmatter}\ndescription: d\n---\nBody\n`),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.invalidNameType]);
    // The field is present but unusable, so the message must not claim it is missing.
    expect(result.errors[0]?.message).toContain('must be a string');
    expect(result.errors[0]?.message).not.toContain('Missing');
  });
});

describe('description rules', () => {
  it('fails when description is absent', () => {
    const { result, report } = validateFixture('validate-missing-description');

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.missingDescription]);
    expect(report).toContain('MISSING_DESCRIPTION: Missing required field: description');
  });

  it('fails when description is whitespace only', () => {
    const { result, report } = validateFixture('validate-whitespace-description');

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.emptyDescription]);
    expect(report).toContain('must not be empty or whitespace only');
  });

  it.each([
    ['spaces', '   '],
    ['tabs', '\t\t'],
    ['newline only', '\\n'],
  ])('fails when description is %s', (_label, value) => {
    const result = validateBasicSkill(
      skillFrom(`---\nname: some-skill\ndescription: "${value}"\n---\nBody\n`),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.emptyDescription]);
  });

  it('does not judge description quality', () => {
    const result = validateBasicSkill(
      skillFrom('---\nname: terse-skill\ndescription: ok\n---\nBody\n'),
    );

    expect(result.valid).toBe(true);
  });

  it.each([
    ['a number', 'description: 42'],
    ['a boolean', 'description: false'],
    ['null', 'description: null'],
    ['a mapping', 'description: {a: 1}'],
    ['a sequence', 'description: [a, b]'],
  ])(
    'reports a non-string description (%s) as unusable rather than missing',
    (_label, frontmatter) => {
      const result = validateBasicSkill(
        skillFrom(`---\nname: good-name\n${frontmatter}\n---\nBody\n`),
      );

      expect(result.valid).toBe(false);
      expect(result.errors.map((issue) => issue.code)).toEqual([
        VALIDATION_CODES.invalidDescriptionType,
      ]);
      expect(result.errors[0]?.message).toContain('must be a string');
      expect(result.errors[0]?.message).not.toContain('Missing');
    },
  );

  it('still reports a genuinely absent description as missing', () => {
    const result = validateBasicSkill(skillFrom('---\nname: good-name\n---\nBody\n'));

    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.missingDescription]);
  });
});

describe('body rules', () => {
  it('fails when the body is empty', () => {
    const { result, report } = validateFixture('validate-empty-body');

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.emptyBody]);
    expect(report).toContain('EMPTY_BODY: Skill body must not be empty');
  });

  it.each([
    ['spaces', '   '],
    ['a newline', '\n'],
    ['tabs', '\t\t'],
    ['a mix of whitespace', ' \n\t '],
  ])('fails when the body is only %s', (_label, whitespace) => {
    const result = validateBasicSkill(
      skillFrom(`---\nname: body-skill\ndescription: A description.\n---\n${whitespace}\n`),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.emptyBody]);
  });

  it('passes for a body that is a single word', () => {
    const result = validateBasicSkill(
      skillFrom('---\nname: body-skill\ndescription: A description.\n---\nHi\n'),
    );

    expect(result.valid).toBe(true);
  });
});

describe('multiple issues', () => {
  it('reports every error and warning together', () => {
    const { result, report } = validateFixture('validate-multiple-errors');

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([
      VALIDATION_CODES.invalidName,
      VALIDATION_CODES.emptyDescription,
    ]);
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      VALIDATION_CODES.unknownFrontmatterKey,
    ]);
    expect(result.issues).toHaveLength(3);
    expect(report).toContain('Errors: 2');
    expect(report).toContain('Warnings: 1');
  });

  it('orders issues deterministically: name, description, body, then keys', () => {
    const skill = skillFrom('---\nzeta: 1\nalpha: 2\n---\n');

    const order = validateBasicSkill(skill).issues.map((issue) => issue.code);

    expect(order).toEqual([
      VALIDATION_CODES.missingName,
      VALIDATION_CODES.missingDescription,
      VALIDATION_CODES.emptyBody,
      VALIDATION_CODES.unknownFrontmatterKey,
      VALIDATION_CODES.unknownFrontmatterKey,
    ]);
  });

  it('produces identical issues across repeated runs', () => {
    const first = validateBasicSkill(
      loadLocalSkill(path.join(fixturesRoot, 'validate-multiple-errors')),
    );
    const second = validateBasicSkill(
      loadLocalSkill(path.join(fixturesRoot, 'validate-multiple-errors')),
    );

    expect(second.issues).toEqual(first.issues);
    expect(second).toEqual(first);
  });

  it('produces identical reports across repeated runs', () => {
    expect(validateFixture('validate-multiple-errors').report).toBe(
      validateFixture('validate-multiple-errors').report,
    );
  });
});

describe('validator is read-only', () => {
  it('leaves the skill directory byte-identical', () => {
    const target = path.join(fixturesRoot, 'validate-valid');

    const before = {
      files: readdirSync(target).sort(),
      contents: readFileSync(path.join(target, 'SKILL.md'), 'utf8'),
      mtime: statSync(path.join(target, 'SKILL.md')).mtimeMs,
    };

    runValidate(target, { cwd: repositoryRoot });
    runValidate(target, { cwd: repositoryRoot });

    expect(readdirSync(target).sort()).toEqual(before.files);
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe(before.contents);
    expect(statSync(path.join(target, 'SKILL.md')).mtimeMs).toBe(before.mtime);
  });

  it('does not execute resources beside a skill', () => {
    const marker = path.join(fixturesRoot, 'script-resources', 'INVALID-SKILL.md');

    expect(existsSync(marker)).toBe(false);
    runValidate(path.join(fixturesRoot, 'script-resources'), { cwd: repositoryRoot });
    expect(existsSync(marker)).toBe(false);
  });
});
