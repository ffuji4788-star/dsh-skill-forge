/**
 * The DSH target adapter: rendering Universal Skill IR v1 into `SKILL.md`.
 *
 * The emitter must never hand-build YAML, so the adversarial cases here are
 * values that break naive `name: ${value}` interpolation.
 */
import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../src/parsers/frontmatter-parser.js';
import { buildParsedSkill } from '../src/schemas/skill.js';
import type { SkillIR } from '../src/ir/skill-ir.js';
import {
  DSH_ENTRY_FILENAME,
  renderDshFrontmatter,
  renderDshSkillMarkdown,
} from '../src/targets/dsh/dsh-target-adapter.js';
import { validateDshCompatibility } from '../src/targets/dsh/dsh-compatibility-validator.js';
import { validateBasicSkill } from '../src/validators/basic-skill-validator.js';

function irWith(overrides: Partial<SkillIR> = {}): SkillIR {
  return {
    schemaVersion: 1,
    name: 'example-skill',
    description: 'An example skill.',
    instructions: '# Example\n\nBody.\n',
    resources: [],
    source: { format: 'generic-local-skill', entryFile: 'SKILL.md', extraFrontmatter: {} },
    ...overrides,
  };
}

/** Renders and re-parses, returning the round-tripped field values. */
function roundTrip(
  name: string,
  description: string,
): { name: unknown; description: unknown; body: string } {
  const rendered = renderDshFrontmatter(name, description);
  const parsed = parseFrontmatter(`${rendered}\nBody\n`);

  return {
    name: parsed.frontmatter['name'],
    description: parsed.frontmatter['description'],
    body: parsed.body,
  };
}

describe('frontmatter rendering', () => {
  it('emits a well-formed frontmatter block', () => {
    const rendered = renderDshFrontmatter('example-skill', 'An example.');

    expect(rendered.startsWith('---\n')).toBe(true);
    expect(rendered.endsWith('---\n')).toBe(true);
    expect(rendered).not.toContain('\r');
  });

  it('renders the documented field order', () => {
    const rendered = renderDshFrontmatter('example-skill', 'An example.');
    const lines = rendered.split('\n');

    expect(lines[1]).toBe('name: example-skill');
    expect(lines[2]).toBe('description: An example.');
  });
});

describe('YAML value round-trip', () => {
  it.each([
    ['a plain value', 'simple description'],
    ['a colon', 'note: this is important'],
    ['a trailing colon', 'ends with a colon:'],
    ['a double quote', 'she said "hello"'],
    ['a single quote', "it's fine"],
    ['both quote kinds', 'a "quote" and a \'quote\''],
    ['a hash', 'issue #42 is fixed'],
    ['a leading hash', '#not a comment'],
    ['a yaml list marker', '- not a list'],
    ['a leading space', ' leading space'],
    ['a trailing space', 'trailing space '],
    ['a yaml document marker', '---'],
    ['a block scalar marker', '|'],
    ['a flow sequence marker', '[a, b]'],
    ['a mapping marker', '{a: 1}'],
    ['a percent directive', '%YAML 1.2'],
    ['an ampersand', '&anchor'],
    ['an asterisk', '*alias'],
    ['a question mark', '? maybe'],
    ['a backslash', 'C:\\path\\to\\file'],
    ['a tab', 'tab\there'],
    ['unicode', '描述：日本語のテキスト'],
    ['emoji', 'rocket 🚀 and sparkles ✨'],
    ['a newline', 'first line\nsecond line'],
    ['a long value', 'x'.repeat(400)],
  ])('round-trips %s', (_label, description) => {
    const result = roundTrip('example-skill', description);

    expect(result.name).toBe('example-skill');
    expect(result.description).toBe(description);
  });

  it('round-trips an empty description without inventing content', () => {
    expect(roundTrip('example-skill', '').description).toBe('');
  });

  it('keeps a description that looks like YAML structure as data', () => {
    expect(roundTrip('example-skill', 'key: value\nother: thing').description).toBe(
      'key: value\nother: thing',
    );
  });

  it('produces identical output for identical input', () => {
    expect(renderDshFrontmatter('a-skill', 'body: text')).toBe(
      renderDshFrontmatter('a-skill', 'body: text'),
    );
  });
});

describe('SKILL.md rendering', () => {
  it('uses the pinned entry file name', () => {
    expect(DSH_ENTRY_FILENAME).toBe('SKILL.md');
    expect(renderDshSkillMarkdown(irWith()).path).toBe('SKILL.md');
  });

  it('preserves the instructions verbatim', () => {
    const instructions = '\n\n#  Head\n\n\n\n   indented\ttab\n\n';
    const rendered = renderDshSkillMarkdown(irWith({ instructions }));

    expect(rendered.content.endsWith(instructions)).toBe(true);
  });

  it('preserves a leading blank line in the body', () => {
    const rendered = renderDshSkillMarkdown(irWith({ instructions: '\n# Title\n' }));

    expect(rendered.content).toContain('---\n\n# Title\n');
  });

  it('ends with exactly one newline', () => {
    const rendered = renderDshSkillMarkdown(irWith({ instructions: 'Body' }));

    expect(rendered.content.endsWith('\n')).toBe(true);
    expect(rendered.content.endsWith('\n\n')).toBe(false);
  });

  it('does not reformat emphasis, lists or code fences', () => {
    const instructions = '*em*\n\n- a\n- b\n\n```ts\nconst x=1;\n```\n';
    const rendered = renderDshSkillMarkdown(irWith({ instructions }));

    expect(rendered.content.endsWith(instructions)).toBe(true);
  });

  it('emits only LF line endings', () => {
    const rendered = renderDshSkillMarkdown(irWith({ instructions: '# Body\r\n' }));

    expect(rendered.content).not.toContain('\r');
  });
});

describe('self-generated package is clean', () => {
  function generatedSkill(overrides: Partial<SkillIR> = {}) {
    const rendered = renderDshSkillMarkdown(irWith(overrides));
    const { frontmatter, body } = parseFrontmatter(rendered.content);

    return buildParsedSkill({
      frontmatter,
      body,
      entryFile: 'SKILL.md',
      sourceType: 'file',
      resources: [],
    });
  }

  it('passes generic validation', () => {
    expect(validateBasicSkill(generatedSkill()).valid).toBe(true);
  });

  it('is DSH compatible with zero errors and zero warnings', () => {
    const result = validateDshCompatibility(generatedSkill());

    expect(result.status).toBe('COMPATIBLE');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('stays compatible for adversarial descriptions', () => {
    for (const description of [
      'note: colon',
      'quote " and \'',
      'unicode 描述 🚀',
      'trailing space ',
      'multi\nline',
    ]) {
      const result = validateDshCompatibility(generatedSkill({ description }));

      expect(result.status).toBe('COMPATIBLE');
      expect(result.warnings).toEqual([]);
    }
  });
});
