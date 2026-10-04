/**
 * The Agent Skills source contract.
 *
 * Every expectation here is derived from the pinned reference validator
 * (`skills-ref/src/skills_ref/validator.py` at
 * `69ef37e9424c0a7ea9dd2293b559e43ec8176379`) and the specification, not from
 * intuition about what a "Claude skill" looks like.
 */
import { describe, expect, it } from 'vitest';

import {
  AGENT_SKILLS_CODES,
  validateAgentSkillFrontmatter,
} from '../src/sources/agent-skills/agent-skills-validator.js';
import {
  AGENT_SKILLS_ALLOWED_FIELDS,
  AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH,
  AGENT_SKILLS_MAX_DESCRIPTION_LENGTH,
  AGENT_SKILLS_MAX_NAME_LENGTH,
  AGENT_SKILLS_UPSTREAM_COMMIT,
  ANTHROPIC_SKILLS_COMMIT,
} from '../src/sources/agent-skills/agent-skills-contract.js';

/** Builds valid frontmatter, overridden per test. */
function frontmatter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'example-skill', description: 'An example.', ...overrides };
}

function codesOf(input: Record<string, unknown>, directoryName?: string): string[] {
  return validateAgentSkillFrontmatter(input, directoryName).issues.map((issue) => issue.code);
}

describe('contract provenance', () => {
  it('pins the primary and secondary sources by full commit', () => {
    expect(AGENT_SKILLS_UPSTREAM_COMMIT).toHaveLength(40);
    expect(ANTHROPIC_SKILLS_COMMIT).toHaveLength(40);
  });

  it('allows exactly the six specified fields', () => {
    expect([...AGENT_SKILLS_ALLOWED_FIELDS].sort()).toEqual([
      'allowed-tools',
      'compatibility',
      'description',
      'license',
      'metadata',
      'name',
    ]);
  });
});

describe('valid skills', () => {
  it('accepts name and description alone', () => {
    expect(validateAgentSkillFrontmatter(frontmatter()).valid).toBe(true);
  });

  it('accepts every optional field', () => {
    const result = validateAgentSkillFrontmatter(
      frontmatter({
        license: 'Apache-2.0',
        compatibility: 'Requires git',
        metadata: { author: 'example-org', version: '1.0' },
        'allowed-tools': 'Bash(git:*) Read',
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts an empty compatibility string, as the reference does', () => {
    expect(validateAgentSkillFrontmatter(frontmatter({ compatibility: '' })).valid).toBe(true);
  });

  it('accepts an empty metadata mapping', () => {
    expect(validateAgentSkillFrontmatter(frontmatter({ metadata: {} })).valid).toBe(true);
  });

  it('accepts a Unicode lowercase name when the directory matches', () => {
    expect(validateAgentSkillFrontmatter(frontmatter({ name: '数据处理' }), '数据处理').valid).toBe(
      true,
    );
  });
});

describe('name contract', () => {
  it('rejects a missing name', () => {
    const input = frontmatter();
    delete input['name'];
    expect(codesOf(input)).toContain(AGENT_SKILLS_CODES.missingName);
  });

  it('rejects a non-string name', () => {
    expect(codesOf(frontmatter({ name: 42 }))).toContain(AGENT_SKILLS_CODES.invalidNameType);
  });

  it('rejects an empty name', () => {
    expect(codesOf(frontmatter({ name: '' }))).toContain(AGENT_SKILLS_CODES.emptyName);
  });

  it('rejects a whitespace-only name', () => {
    expect(codesOf(frontmatter({ name: '   ' }))).toContain(AGENT_SKILLS_CODES.emptyName);
  });

  it('accepts a name at exactly the 64 character limit', () => {
    const name = 'a'.repeat(AGENT_SKILLS_MAX_NAME_LENGTH);
    expect(codesOf({ name, description: 'd' })).not.toContain(AGENT_SKILLS_CODES.nameTooLong);
  });

  it('rejects a name one character over the limit', () => {
    const name = 'a'.repeat(AGENT_SKILLS_MAX_NAME_LENGTH + 1);
    expect(codesOf({ name, description: 'd' })).toContain(AGENT_SKILLS_CODES.nameTooLong);
  });

  it('rejects an uppercase name', () => {
    expect(codesOf(frontmatter({ name: 'PDF-Processing' }))).toContain(
      AGENT_SKILLS_CODES.nameNotLowercase,
    );
  });

  it('rejects a leading hyphen', () => {
    expect(codesOf(frontmatter({ name: '-pdf' }))).toContain(AGENT_SKILLS_CODES.nameHyphenEdge);
  });

  it('rejects a trailing hyphen', () => {
    expect(codesOf(frontmatter({ name: 'pdf-' }))).toContain(AGENT_SKILLS_CODES.nameHyphenEdge);
  });

  it('rejects consecutive hyphens', () => {
    expect(codesOf(frontmatter({ name: 'pdf--processing' }))).toContain(
      AGENT_SKILLS_CODES.nameConsecutiveHyphens,
    );
  });

  it('rejects underscores and spaces', () => {
    expect(codesOf(frontmatter({ name: 'pdf_processing' }))).toContain(
      AGENT_SKILLS_CODES.nameInvalidCharacters,
    );
    expect(codesOf(frontmatter({ name: 'pdf processing' }))).toContain(
      AGENT_SKILLS_CODES.nameInvalidCharacters,
    );
  });

  it('accepts a Unicode lowercase name that the reference accepts', () => {
    // `isalnum()` is true for these, so the reference validator allows them.
    expect(codesOf({ name: 'café', description: 'd' })).not.toContain(
      AGENT_SKILLS_CODES.nameInvalidCharacters,
    );
  });

  it('treats an NFKC-compatible name as equal to its composed form', () => {
    // "é" decomposed versus composed: both normalize to the same NFKC string.
    expect(codesOf({ name: 'cafe\u0301', description: 'd' })).not.toContain(
      AGENT_SKILLS_CODES.nameInvalidCharacters,
    );
  });

  it('accepts the number categories Python counts as alphanumeric', () => {
    // Superscript two (No), Arabic-Indic digits (Nd) and circled one (No) are all
    // `isalnum()` in the reference; NFKC folds the last two into plain digits.
    for (const name of ['x\u00b2', '\u0660\u0661', '\u2460']) {
      expect(codesOf({ name, description: 'd' })).not.toContain(
        AGENT_SKILLS_CODES.nameInvalidCharacters,
      );
    }
  });

  it('accepts a letter added after Unicode 15, documenting the version skew', () => {
    // U+1C8A CYRILLIC SMALL LETTER TJE was assigned in Unicode 16.0, which the
    // JavaScript runtime uses, and is unassigned in the Unicode 15.0 tables the
    // pinned Python 3.12 ships. The adapter therefore follows its own runtime
    // rather than pretending to a fixed Unicode version, and the direction is
    // asserted so a future Unicode upgrade cannot silently change it.
    const lateLetter = '\u1c8a';
    const accepted = codesOf({ name: lateLetter, description: 'd' });
    const runtimeUnicode = Number.parseInt(process.versions.unicode ?? '0', 10);

    if (runtimeUnicode >= 16) {
      expect(accepted).not.toContain(AGENT_SKILLS_CODES.nameInvalidCharacters);
    } else {
      // On an older runtime the same character is correctly refused.
      expect(accepted).toContain(AGENT_SKILLS_CODES.nameInvalidCharacters);
    }
  });
});

describe('name and directory match', () => {
  it('accepts a matching directory name', () => {
    expect(validateAgentSkillFrontmatter({ name: 'foo', description: 'd' }, 'foo').valid).toBe(
      true,
    );
  });

  it('rejects a mismatched directory name', () => {
    const result = validateAgentSkillFrontmatter({ name: 'foo', description: 'd' }, 'bar');

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([
      AGENT_SKILLS_CODES.nameDirectoryMismatch,
    ]);
  });

  it('compares the NFKC-normalized directory name', () => {
    // The reference normalizes the directory name and compares it to the
    // already-normalized skill name.
    expect(
      validateAgentSkillFrontmatter({ name: 'café', description: 'd' }, 'cafe\u0301').valid,
    ).toBe(true);
  });

  it('skips the directory check when no directory is known', () => {
    expect(validateAgentSkillFrontmatter({ name: 'foo', description: 'd' }).valid).toBe(true);
  });
});

describe('description contract', () => {
  it('rejects a missing description', () => {
    expect(codesOf({ name: 'example-skill' })).toContain(AGENT_SKILLS_CODES.missingDescription);
  });

  it('rejects a non-string description', () => {
    expect(codesOf(frontmatter({ description: 42 }))).toContain(
      AGENT_SKILLS_CODES.invalidDescriptionType,
    );
  });

  it('rejects an empty description', () => {
    expect(codesOf(frontmatter({ description: '' }))).toContain(
      AGENT_SKILLS_CODES.emptyDescription,
    );
  });

  it('rejects a whitespace-only description', () => {
    expect(codesOf(frontmatter({ description: '   \n  ' }))).toContain(
      AGENT_SKILLS_CODES.emptyDescription,
    );
  });

  it('accepts a description at exactly the 1024 character limit', () => {
    const description = 'd'.repeat(AGENT_SKILLS_MAX_DESCRIPTION_LENGTH);
    expect(codesOf(frontmatter({ description }))).not.toContain(
      AGENT_SKILLS_CODES.descriptionTooLong,
    );
  });

  it('rejects a description one character over the limit', () => {
    const description = 'd'.repeat(AGENT_SKILLS_MAX_DESCRIPTION_LENGTH + 1);
    expect(codesOf(frontmatter({ description }))).toContain(AGENT_SKILLS_CODES.descriptionTooLong);
  });

  it('accepts colons, quotes, Unicode and angle brackets', () => {
    // Angle brackets are a divergence: the Anthropic helper forbids them and the
    // specification and reference validator do not.
    for (const description of [
      'note: this is important',
      'she said "hello"',
      "it's fine",
      '描述：日本語',
      'rocket 🚀',
      'use <tag> syntax',
      'a < b and c > d',
    ]) {
      expect(validateAgentSkillFrontmatter(frontmatter({ description })).valid).toBe(true);
    }
  });
});

describe('compatibility contract', () => {
  it('rejects a non-string compatibility', () => {
    expect(codesOf(frontmatter({ compatibility: 42 }))).toContain(
      AGENT_SKILLS_CODES.invalidCompatibilityType,
    );
  });

  it('accepts compatibility at exactly the 500 character limit', () => {
    const compatibility = 'c'.repeat(AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH);
    expect(codesOf(frontmatter({ compatibility }))).not.toContain(
      AGENT_SKILLS_CODES.compatibilityTooLong,
    );
  });

  it('rejects compatibility over the limit', () => {
    const compatibility = 'c'.repeat(AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH + 1);
    expect(codesOf(frontmatter({ compatibility }))).toContain(
      AGENT_SKILLS_CODES.compatibilityTooLong,
    );
  });
});

describe('optional field types', () => {
  it('rejects a non-string license', () => {
    expect(codesOf(frontmatter({ license: 42 }))).toContain(AGENT_SKILLS_CODES.invalidLicenseType);
  });

  it('rejects a non-string allowed-tools', () => {
    expect(codesOf(frontmatter({ 'allowed-tools': ['Read'] }))).toContain(
      AGENT_SKILLS_CODES.invalidAllowedToolsType,
    );
  });

  it('rejects a metadata list', () => {
    expect(codesOf(frontmatter({ metadata: ['a'] }))).toContain(
      AGENT_SKILLS_CODES.invalidMetadataType,
    );
  });

  it('rejects a metadata string', () => {
    expect(codesOf(frontmatter({ metadata: 'author=me' }))).toContain(
      AGENT_SKILLS_CODES.invalidMetadataType,
    );
  });

  it('rejects a non-string metadata value', () => {
    expect(codesOf(frontmatter({ metadata: { version: 1.0 } }))).toContain(
      AGENT_SKILLS_CODES.invalidMetadataValue,
    );
  });
});

describe('unknown fields', () => {
  it('rejects a single unknown field', () => {
    const result = validateAgentSkillFrontmatter(frontmatter({ foo: 'bar' }));

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe(AGENT_SKILLS_CODES.unknownFrontmatterKey);
    expect(result.errors[0]?.message).toContain('foo');
  });

  it('reports unknown fields in deterministic sorted order before other issues', () => {
    const result = validateAgentSkillFrontmatter({ zeta: 1, alpha: 2, description: 'd' });
    const unknown = result.issues.filter(
      (issue) => issue.code === AGENT_SKILLS_CODES.unknownFrontmatterKey,
    );

    expect(unknown.map((issue) => issue.message)).toEqual([
      expect.stringContaining('alpha'),
      expect.stringContaining('zeta'),
    ]);
    // Unknown fields are reported before the missing name.
    expect(result.issues[0]?.code).toBe(AGENT_SKILLS_CODES.unknownFrontmatterKey);
  });

  it('treats an unknown field as an error, never a warning', () => {
    const result = validateAgentSkillFrontmatter(frontmatter({ foo: 'bar' }));

    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(false);
  });

  it('accepts nested keys inside metadata, as both implementations do', () => {
    expect(
      validateAgentSkillFrontmatter(frontmatter({ metadata: { anything: 'goes', deep: 'value' } }))
        .valid,
    ).toBe(true);
  });
});

describe('issue ordering', () => {
  it('is stable and independent of key order in the source', () => {
    const first = codesOf({ zoo: 1, name: 'Bad', description: '' });
    const second = codesOf({ description: '', name: 'Bad', zoo: 1 });

    expect(second).toEqual(first);
  });

  it('reports every problem at once rather than only the first', () => {
    const codes = codesOf({ name: 'A--B', description: 42, compatibility: 7, foo: 1 });

    expect(codes).toEqual([
      AGENT_SKILLS_CODES.unknownFrontmatterKey,
      AGENT_SKILLS_CODES.nameNotLowercase,
      AGENT_SKILLS_CODES.nameConsecutiveHyphens,
      AGENT_SKILLS_CODES.invalidDescriptionType,
      AGENT_SKILLS_CODES.invalidCompatibilityType,
    ]);
  });
});
