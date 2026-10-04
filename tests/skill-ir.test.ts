/**
 * Universal Skill IR v1 schema.
 *
 * The schema is the only place the IR contract is enforced, so these tests
 * attack it directly: a value that "looks about right" must be rejected.
 */
import { describe, expect, it } from 'vitest';

import {
  GENERIC_LOCAL_SKILL_FORMAT,
  isSkillIR,
  KNOWN_SOURCE_FORMATS,
  SKILL_IR_SCHEMA_VERSION,
  validateSkillIR,
  type SkillIR,
} from '../src/ir/skill-ir.js';
import { serializeSkillIR } from '../src/ir/serialize-skill-ir.js';

const validIr: SkillIR = {
  schemaVersion: 1,
  name: 'example-skill',
  description: 'An example skill.',
  instructions: '# Example\n\nBody.\n',
  resources: ['reference.md', 'assets/data.json'],
  source: {
    format: GENERIC_LOCAL_SKILL_FORMAT,
    entryFile: 'SKILL.md',
    extraFrontmatter: { author: 'Alice' },
  },
};

function withChange(change: Record<string, unknown>): unknown {
  return { ...validIr, ...change };
}

describe('valid IR', () => {
  it('accepts a well-formed document', () => {
    expect(validateSkillIR(validIr)).toEqual([]);
    expect(isSkillIR(validIr)).toBe(true);
  });

  it('pins schemaVersion to 1 as a literal', () => {
    expect(SKILL_IR_SCHEMA_VERSION).toBe(1);
  });

  it('accepts only the generic local format in Phase 4', () => {
    expect(KNOWN_SOURCE_FORMATS).toEqual([GENERIC_LOCAL_SKILL_FORMAT]);
    expect(GENERIC_LOCAL_SKILL_FORMAT).toBe('generic-local-skill');
  });
});

describe('schemaVersion', () => {
  it.each([[2], [0], ['1'], [null], [undefined]])('rejects %j', (version) => {
    expect(validateSkillIR(withChange({ schemaVersion: version }))).toContain(
      'schemaVersion must be 1',
    );
  });
});

describe('required string fields', () => {
  it.each(['name', 'description', 'instructions'])('rejects a missing %s', (field) => {
    const value: Record<string, unknown> = { ...validIr };
    delete value[field];

    expect(validateSkillIR(value)).toContain(`${field} must be a string`);
  });

  it.each(['name', 'description', 'instructions'])('rejects a non-string %s', (field) => {
    expect(validateSkillIR(withChange({ [field]: 42 }))).toContain(`${field} must be a string`);
  });

  it.each(['name', 'description'])('rejects an empty %s', (field) => {
    expect(validateSkillIR(withChange({ [field]: '' }))).toContain(`${field} must not be empty`);
  });

  it('allows empty instructions, which the generic gate already rejected', () => {
    // The gate prevents this in practice; the schema stays permissive about the
    // string's content and only requires the field to exist.
    expect(validateSkillIR(withChange({ instructions: '' }))).toEqual([]);
  });
});

describe('resources', () => {
  it.each([
    ['an absolute POSIX path', '/etc/passwd'],
    ['an absolute Windows path', 'C:/Users/Alice/skill/reference.md'],
    ['a drive-relative path', 'C:reference.md'],
    ['a traversal segment', '../outside.md'],
    ['a Windows traversal segment', '..\\outside.md'],
    ['a backslash separator', 'assets\\data.json'],
    ['a current-directory segment', './reference.md'],
    ['an empty path', ''],
    ['a control character', 'assets/data\u0000.json'],
  ])('rejects %s', (_label, resource) => {
    const errors = validateSkillIR(withChange({ resources: [resource] }));

    expect(errors.some((error) => error.includes('skill-root-relative'))).toBe(true);
  });

  it('rejects a non-string entry', () => {
    expect(validateSkillIR(withChange({ resources: [42] }))).toContain(
      'resources[0] must be a string',
    );
  });

  it('rejects a non-array value', () => {
    expect(validateSkillIR(withChange({ resources: 'reference.md' }))).toContain(
      'resources must be an array',
    );
  });

  it('accepts an empty resource list', () => {
    expect(validateSkillIR(withChange({ resources: [] }))).toEqual([]);
  });
});

describe('source envelope', () => {
  it('rejects a missing source object', () => {
    expect(validateSkillIR(withChange({ source: null }))).toContain('source must be an object');
  });

  it('rejects an unknown format', () => {
    const errors = validateSkillIR(
      withChange({ source: { ...validIr.source, format: 'claude-code' } }),
    );

    expect(errors.some((error) => error.includes('is not a known format'))).toBe(true);
  });

  it('rejects an absolute entryFile', () => {
    const errors = validateSkillIR(
      withChange({ source: { ...validIr.source, entryFile: 'C:/Users/Alice/skill/SKILL.md' } }),
    );

    expect(errors.some((error) => error.includes('skill-root-relative'))).toBe(true);
  });

  it('rejects name or description duplicated into extraFrontmatter', () => {
    expect(
      validateSkillIR(
        withChange({ source: { ...validIr.source, extraFrontmatter: { name: 'other' } } }),
      ),
    ).toContain('source.extraFrontmatter must not repeat the universal core fields');

    expect(
      validateSkillIR(
        withChange({ source: { ...validIr.source, extraFrontmatter: { description: 'other' } } }),
      ),
    ).toContain('source.extraFrontmatter must not repeat the universal core fields');
  });

  it('rejects extra frontmatter that is not JSON-safe', () => {
    const errors = validateSkillIR(
      withChange({
        source: { ...validIr.source, extraFrontmatter: { fn: () => 1 } },
      }),
    );

    expect(errors).toContain('source.extraFrontmatter must contain only JSON-safe values');
  });
});

describe('serializer refuses invalid input', () => {
  it('throws instead of emitting a document that is not valid IR', () => {
    const broken = { ...validIr, schemaVersion: 2 } as unknown as SkillIR;

    expect(() => serializeSkillIR(broken)).toThrow(/Refusing to serialize invalid/);
  });
});
