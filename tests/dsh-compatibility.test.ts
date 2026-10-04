/**
 * The pinned DSH compatibility contract.
 *
 * Every expectation here was derived from the upstream source and official tests
 * at the pinned commit, not from documentation alone. Cases where the pinned
 * contract is *more lenient* than the generic validator are asserted explicitly,
 * because that difference is the whole point of a target profile.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCompat } from '../src/cli/compat-command.js';
import { loadLocalSkill } from '../src/importers/local-importer.js';
import { parseFrontmatter } from '../src/parsers/frontmatter-parser.js';
import { buildParsedSkill, type ParsedSkill } from '../src/schemas/skill.js';
import {
  DSH_COMPATIBILITY_CODES,
  validateDshCompatibility,
} from '../src/targets/dsh/dsh-compatibility-validator.js';

const repositoryRoot = process.cwd();
const dshFixtures = path.join(repositoryRoot, 'fixtures', 'dsh');

function compatFixture(name: string): ReturnType<typeof runCompat> {
  return runCompat(path.join(dshFixtures, name), { cwd: repositoryRoot });
}

/** Builds a skill from inline frontmatter, for cases a fixture cannot express. */
function skillFrom(frontmatterYaml: string, body = '# Body\n'): ParsedSkill {
  const { frontmatter, body: parsedBody } = parseFrontmatter(
    `---\n${frontmatterYaml}\n---\n${body}`,
  );

  return buildParsedSkill({
    frontmatter,
    body: parsedBody,
    entryFile: path.join(dshFixtures, 'inline', 'SKILL.md'),
    sourceType: 'file',
    resources: [],
  });
}

function codes(skill: ParsedSkill, severity: 'error' | 'warning'): string[] {
  const result = validateDshCompatibility(skill);
  return (severity === 'error' ? result.errors : result.warnings).map((issue) => issue.code);
}

describe('compatible skills', () => {
  it('accepts a minimal skill with only name and description', () => {
    const { result, report } = compatFixture('compatible-minimal');

    expect(result.status).toBe('COMPATIBLE');
    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
    expect(report).toContain('Result: COMPATIBLE');
    expect(report).toContain('Errors: 0');
    expect(report).toContain('Warnings: 0');
  });

  it('accepts every optional field the contract supports', () => {
    const { result } = compatFixture('compatible-full');

    expect(result.status).toBe('COMPATIBLE');
    expect(result.issues).toEqual([]);
  });

  it('accepts a flat Markdown skill', () => {
    const { result, report } = compatFixture('compatible-flat');

    expect(result.status).toBe('COMPATIBLE');
    expect(report).toContain('Entry File: dsh-flat.md');
  });

  it('accepts an object metadata value', () => {
    expect(compatFixture('metadata-valid').result.status).toBe('COMPATIBLE');
  });

  it('accepts a non-empty string whenToUse', () => {
    expect(compatFixture('when-to-use-valid').result.status).toBe('COMPATIBLE');
  });

  it('accepts a whitespace-only description, which the pinned contract allows', () => {
    // Upstream `stringField` only requires `value.length > 0`. The generic
    // validator rejects this skill; compatibility must not.
    const { result } = compatFixture('whitespace-description');

    expect(result.status).toBe('COMPATIBLE');
    expect(result.errors).toEqual([]);
  });

  it('accepts an empty body', () => {
    const { result } = compatFixture('empty-body');

    expect(result.compatible).toBe(true);
    expect(result.status).toBe('COMPATIBLE_WITH_WARNINGS');
    expect(result.warnings.map((issue) => issue.code)).toContain(
      DSH_COMPATIBILITY_CODES.emptyContent,
    );
  });
});

describe('warnings that do not break compatibility', () => {
  it('warns about unknown frontmatter keys and stays compatible', () => {
    const { result, report } = compatFixture('unknown-key');

    expect(result.status).toBe('COMPATIBLE_WITH_WARNINGS');
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.message)).toEqual([
      'frontmatter key "author" is ignored by the pinned DSH contract',
      'frontmatter key "version" is ignored by the pinned DSH contract',
    ]);
    expect(report).toContain('DSH_IGNORED_FRONTMATTER_KEY');
  });

  it('warns when metadata is a sequence instead of an object', () => {
    const { result } = compatFixture('metadata-invalid');

    expect(result.compatible).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      DSH_COMPATIBILITY_CODES.ignoredMetadata,
    ]);
  });

  it('warns when whenToUse is not a usable string', () => {
    const { result } = compatFixture('when-to-use-invalid');

    expect(result.compatible).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      DSH_COMPATIBILITY_CODES.ignoredWhenToUse,
    ]);
  });

  it.each([
    ['null', 'metadata: null'],
    ['a string', 'metadata: not-an-object'],
    ['a number', 'metadata: 42'],
    ['a boolean', 'metadata: true'],
  ])('warns when metadata is %s', (_label, frontmatter) => {
    const skill = skillFrom(`name: meta-skill\ndescription: d\n${frontmatter}`);

    expect(codes(skill, 'warning')).toEqual([DSH_COMPATIBILITY_CODES.ignoredMetadata]);
    expect(codes(skill, 'error')).toEqual([]);
  });

  it.each([
    ['a number', 'whenToUse: 42'],
    ['a boolean', 'whenToUse: true'],
    ['a mapping', 'whenToUse: {a: 1}'],
    ['an empty string', 'whenToUse: ""'],
    ['null', 'whenToUse: null'],
  ])('warns when whenToUse is %s', (_label, frontmatter) => {
    const skill = skillFrom(`name: when-skill\ndescription: d\n${frontmatter}`);

    expect(codes(skill, 'warning')).toEqual([DSH_COMPATIBILITY_CODES.ignoredWhenToUse]);
    expect(codes(skill, 'error')).toEqual([]);
  });

  it('reports both ignored metadata and ignored whenToUse together', () => {
    const { result } = compatFixture('multiple-compat-issues');

    expect(result.compatible).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      DSH_COMPATIBILITY_CODES.ignoredWhenToUse,
      DSH_COMPATIBILITY_CODES.ignoredMetadata,
      DSH_COMPATIBILITY_CODES.ignoredFrontmatterKey,
    ]);
  });
});

describe('incompatible skills', () => {
  it('rejects an invocation value the contract does not accept', () => {
    const { result, report } = compatFixture('invalid-invocation-value');

    expect(result.status).toBe('INCOMPATIBLE');
    expect(result.errors.map((issue) => issue.code)).toEqual([
      DSH_COMPATIBILITY_CODES.invalidInvocationValue,
    ]);
    expect(report).toContain('DSH_INVALID_INVOCATION_VALUE');
    expect(report).toContain('must be a boolean');
  });

  it('rejects a legacy invocation key and names the canonical replacement', () => {
    const { result } = compatFixture('legacy-invocation-key');

    expect(result.status).toBe('INCOMPATIBLE');
    expect(result.errors.map((issue) => issue.code)).toEqual([
      DSH_COMPATIBILITY_CODES.legacyInvocationKey,
    ]);
    expect(result.errors[0]?.message).toContain('use "disable-model-invocation"');
  });

  it.each(['disableModelInvocation', 'modelInvocable', 'userInvocable'])(
    'does not also report the legacy key %s as merely ignored',
    (legacy) => {
      // Reporting the same key as both an unsupported error and an "ignored"
      // warning contradicts itself and sends the reader two messages.
      const skill = skillFrom(`name: legacy-skill\ndescription: d\n${legacy}: true`);

      expect(codes(skill, 'error')).toEqual([DSH_COMPATIBILITY_CODES.legacyInvocationKey]);
      expect(codes(skill, 'warning')).toEqual([]);
    },
  );

  it('still warns about other unknown keys alongside a legacy key error', () => {
    const skill = skillFrom(
      'name: legacy-skill\ndescription: d\ndisableModelInvocation: true\nauthor: x',
    );

    expect(codes(skill, 'error')).toEqual([DSH_COMPATIBILITY_CODES.legacyInvocationKey]);
    expect(codes(skill, 'warning')).toEqual([DSH_COMPATIBILITY_CODES.ignoredFrontmatterKey]);
  });

  it.each([
    ['missing name', 'description: d', DSH_COMPATIBILITY_CODES.missingName],
    ['an empty name', 'name: ""\ndescription: d', DSH_COMPATIBILITY_CODES.missingName],
    ['a whitespace name', 'name: "  "\ndescription: d', DSH_COMPATIBILITY_CODES.invalidName],
    ['a non-string name', 'name: 123\ndescription: d', DSH_COMPATIBILITY_CODES.invalidNameType],
    ['null name', 'name: null\ndescription: d', DSH_COMPATIBILITY_CODES.missingName],
  ])('rejects %s', (_label, frontmatter, expectedCode) => {
    const skill = skillFrom(frontmatter);

    expect(codes(skill, 'error')).toEqual([expectedCode]);
  });

  it.each([
    ['missing description', 'name: good-name', DSH_COMPATIBILITY_CODES.missingDescription],
    [
      'an empty description',
      'name: good-name\ndescription: ""',
      DSH_COMPATIBILITY_CODES.missingDescription,
    ],
    [
      'a non-string description',
      'name: good-name\ndescription: 42',
      DSH_COMPATIBILITY_CODES.invalidDescriptionType,
    ],
    [
      'null description',
      'name: good-name\ndescription: null',
      DSH_COMPATIBILITY_CODES.missingDescription,
    ],
  ])('rejects %s', (_label, frontmatter, expectedCode) => {
    const skill = skillFrom(frontmatter);

    expect(codes(skill, 'error')).toEqual([expectedCode]);
  });

  it.each([
    ['MySkill', 'MySkill'],
    ['underscore', 'my_skill'],
    ['space', 'my skill'],
    ['double hyphen', 'my--skill'],
    ['leading hyphen', '-my-skill'],
    ['trailing hyphen', 'my-skill-'],
    ['dot', 'my.skill'],
    ['forward slash', 'my/skill'],
    ['backslash', 'my\\skill'],
    ['upper case', 'MY-SKILL'],
    ['single dot', '.'],
    ['double dot', '..'],
    ['traversal', '../escape'],
    ['unicode letters', 'café-skill'],
    ['emoji', 'skill-🚀'],
  ])('rejects the name %j (%s)', (_label, name) => {
    // Values are single-quoted so YAML does not interpret backslash escapes.
    const skill = skillFrom(`name: '${name}'\ndescription: d`);

    expect(codes(skill, 'error')).toEqual([DSH_COMPATIBILITY_CODES.invalidName]);
  });

  it.each([
    ['a', 'a'],
    ['a1', 'a1'],
    // Quoted: a bare `1` is a YAML number, not a string, and the pinned
    // `stringField` only accepts strings.
    ['1', '"1"'],
    ['1-a', '1-a'],
    ['skill-2', 'skill-2'],
    ['a-b-c', 'a-b-c'],
  ])('accepts the name %j', (_label, name) => {
    const skill = skillFrom(`name: ${name}\ndescription: d`);

    expect(codes(skill, 'error')).toEqual([]);
  });

  it('rejects an unquoted numeric name because YAML makes it a number', () => {
    const skill = skillFrom('name: 1\ndescription: d');

    expect(codes(skill, 'error')).toEqual([DSH_COMPATIBILITY_CODES.invalidNameType]);
  });
});

describe('determinism', () => {
  it('produces identical issues across repeated runs', () => {
    const skill = loadLocalSkill(path.join(dshFixtures, 'multiple-compat-issues'));
    const first = validateDshCompatibility(skill);
    const second = validateDshCompatibility(skill);

    expect(second).toEqual(first);
  });

  it('produces identical reports across repeated runs', () => {
    expect(compatFixture('multiple-compat-issues').report).toBe(
      compatFixture('multiple-compat-issues').report,
    );
  });

  it('orders issues independent of frontmatter document order', () => {
    const first = skillFrom('name: bad-name\ndescription: d\nzeta: 1\nalpha: 2');
    const reversed = skillFrom('name: bad-name\ndescription: d\nalpha: 2\nzeta: 1');

    expect(codes(first, 'warning')).toEqual(codes(reversed, 'warning'));
  });

  it('keeps errors before warnings in the combined issue list', () => {
    const result = validateDshCompatibility(skillFrom('name: Bad_Name\ndescription: d\nauthor: x'));

    expect(result.issues[0]?.severity).toBe('error');
    expect(result.issues.at(-1)?.severity).toBe('warning');
  });
});
