/**
 * Deterministic normalization into Universal Skill IR v1.
 *
 * These tests attack the properties the IR claims: determinism, loss
 * preservation, portability, content fidelity and the generic validation gate.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCompat } from '../src/cli/compat-command.js';
import { runValidate } from '../src/cli/validate-command.js';
import {
  normalizeResourcePath,
  normalizeSkill,
  SkillNotNormalizableError,
  toLf,
  toNormalizeResult,
} from '../src/ir/normalize-skill.js';
import { serializeSkillIR } from '../src/ir/serialize-skill-ir.js';
import { validateSkillIR } from '../src/ir/skill-ir.js';
import { loadLocalSkill } from '../src/importers/local-importer.js';
import { parseFrontmatter } from '../src/parsers/frontmatter-parser.js';
import { buildParsedSkill, type ParsedSkill } from '../src/schemas/skill.js';

const repositoryRoot = process.cwd();
const normalizeFixtures = path.join(repositoryRoot, 'fixtures', 'normalize');

function normalizeFixture(name: string): ReturnType<typeof normalizeSkill> {
  return normalizeSkill(path.join(normalizeFixtures, name), { cwd: repositoryRoot });
}

/** Builds a skill from inline content, for cases a fixture cannot express. */
function skillFrom(frontmatterYaml: string, body = '# Body\n'): ParsedSkill {
  const { frontmatter, body: parsedBody } = parseFrontmatter(
    `---\n${frontmatterYaml}\n---\n${body}`,
  );

  return buildParsedSkill({
    frontmatter,
    body: parsedBody,
    entryFile: path.join(normalizeFixtures, 'inline', 'SKILL.md'),
    sourceType: 'file',
    resources: [],
  });
}

describe('minimal normalization', () => {
  it('produces IR that satisfies its own schema', () => {
    const { ir } = normalizeFixture('minimal');

    expect(validateSkillIR(ir)).toEqual([]);
    expect(ir.schemaVersion).toBe(1);
    expect(ir.name).toBe('normalize-minimal');
    expect(ir.description).toContain('smallest skill');
  });

  it('carries the body through as instructions without trimming', () => {
    const { ir } = normalizeFixture('minimal');

    expect(ir.instructions.startsWith('\n# Normalize Minimal')).toBe(true);
    expect(ir.instructions.endsWith('\n')).toBe(true);
  });

  it('has an empty extra frontmatter object when nothing extra is declared', () => {
    expect(normalizeFixture('minimal').ir.source.extraFrontmatter).toEqual({});
  });

  it('records the generic format and a relative entry file', () => {
    const { ir } = normalizeFixture('minimal');

    expect(ir.source.format).toBe('generic-local-skill');
    expect(ir.source.entryFile).toBe('SKILL.md');
  });
});

describe('loss preservation', () => {
  it('preserves every non-core frontmatter field verbatim', () => {
    const { ir } = normalizeFixture('with-extra-frontmatter');

    expect(ir.source.extraFrontmatter).toEqual({
      author: 'Alice',
      deprecated: null,
      'disable-model-invocation': true,
      reviewed: true,
      tags: ['alpha', 'beta'],
      version: 3,
      whenToUse: 'When checking that source frontmatter survives normalization.',
    });
  });

  it('never repeats the universal core fields in extra frontmatter', () => {
    const { ir } = normalizeFixture('with-extra-frontmatter');

    expect(ir.source.extraFrontmatter).not.toHaveProperty('name');
    expect(ir.source.extraFrontmatter).not.toHaveProperty('description');
  });

  it('preserves nested objects and nested arrays', () => {
    const { ir } = normalizeFixture('nested-extra-frontmatter');

    expect(ir.source.extraFrontmatter).toEqual({
      counts: [3, 1, 2],
      metadata: {
        alpha: 'first',
        nested: { alpha: 2, list: ['z', 'a', 'm'], zulu: 1 },
        zeta: 'last',
      },
    });
  });

  it('keeps every JSON value kind intact', () => {
    const { ir } = toNormalizeResult(
      skillFrom(
        [
          'name: kinds-skill',
          'description: d',
          'text: hello',
          'count: 7',
          'ratio: 1.5',
          'flag: false',
          'nothing: null',
          'list: [1, two, false]',
          'nested:',
          '  inner: [true, null]',
        ].join('\n'),
      ),
    );

    expect(ir.source.extraFrontmatter).toEqual({
      count: 7,
      flag: false,
      list: [1, 'two', false],
      nested: { inner: [true, null] },
      nothing: null,
      ratio: 1.5,
      text: 'hello',
    });
  });

  it('does not interpret source-specific keys semantically', () => {
    // No target or source adapter exists yet, so the raw key must survive as-is.
    const { ir } = normalizeFixture('with-extra-frontmatter');
    const extra = ir.source.extraFrontmatter;

    expect(extra).toHaveProperty('disable-model-invocation');
    expect(extra).not.toHaveProperty('invocation');
    expect(JSON.stringify(ir)).not.toContain('modelInvocable');
  });
});

describe('canonical ordering', () => {
  it('sorts object keys recursively', () => {
    const { ir } = normalizeFixture('nested-extra-frontmatter');

    expect(Object.keys(ir.source.extraFrontmatter)).toEqual(['counts', 'metadata']);
    const metadata = ir.source.extraFrontmatter['metadata'] as Record<string, unknown>;
    expect(Object.keys(metadata)).toEqual(['alpha', 'nested', 'zeta']);
  });

  it('preserves array order', () => {
    const { ir } = normalizeFixture('nested-extra-frontmatter');

    expect(ir.source.extraFrontmatter['counts']).toEqual([3, 1, 2]);
  });

  it('produces identical output for the same frontmatter written in a different order', () => {
    const forward = normalizeFixture('deterministic-order');
    const reversed = normalizeFixture('deterministic-order-reversed');

    expect(serializeSkillIR(reversed.ir)).toBe(serializeSkillIR(forward.ir));
  });
});

describe('instructions content fidelity', () => {
  it('normalizes CRLF to LF', () => {
    const { ir } = normalizeFixture('crlf');

    expect(ir.instructions).not.toContain('\r');
    expect(ir.instructions).toContain('# Normalize CRLF');
  });

  it('normalizes a lone CR to LF', () => {
    expect(toLf('a\rb\r\nc\n')).toBe('a\nb\nc\n');
  });

  it('does not trim or reflow the body', () => {
    const body = '\n\n#  Title\n\n\n\n   indented\ttab\n\n';
    const { ir } = toNormalizeResult(skillFrom('name: fidelity-skill\ndescription: d', body));

    expect(ir.instructions).toBe(body);
  });

  it('preserves a trailing newline exactly as written', () => {
    const withNewline = toNormalizeResult(skillFrom('name: n-skill\ndescription: d', 'Body\n')).ir;
    const withoutNewline = toNormalizeResult(skillFrom('name: n-skill\ndescription: d', 'Body')).ir;

    expect(withNewline.instructions).toBe('Body\n');
    expect(withoutNewline.instructions).toBe('Body');
  });
});

describe('resources', () => {
  it('lists resources as relative, /-separated, sorted paths', () => {
    const { ir } = normalizeFixture('with-resources');

    expect(ir.resources).toEqual(['assets/data.json', 'reference.md']);
    expect(ir.resources.every((resource) => !resource.includes('\\'))).toBe(true);
    expect(ir.resources.every((resource) => !path.isAbsolute(resource))).toBe(true);
  });

  it('never embeds resource contents', () => {
    const { ir } = normalizeFixture('with-resources');
    const serialized = serializeSkillIR(ir);

    expect(serialized).not.toContain('Static reference text');
    expect(serialized).not.toContain('A nested resource');
  });

  it.each([
    ['an absolute POSIX path', '/etc/passwd'],
    ['an absolute Windows path', 'C:\\Users\\Alice\\skill\\secret.md'],
    ['a traversal segment', '../outside.md'],
    ['a Windows traversal segment', '..\\outside.md'],
    ['a current-directory segment', './reference.md'],
    ['an empty path', ''],
    ['a control character', 'assets/data\u0000.json'],
    ['a newline in the name', 'assets/da\nta.json'],
  ])('drops %s instead of emitting a leaky reference', (_label, resource) => {
    expect(normalizeResourcePath(resource)).toBeUndefined();
  });

  it('converts Windows separators to /', () => {
    expect(normalizeResourcePath('assets\\data.json')).toBe('assets/data.json');
  });

  it('sorts resources so filesystem enumeration order cannot leak through', () => {
    const { ir } = toNormalizeResult(
      buildParsedSkill({
        frontmatter: { name: 'order-skill', description: 'd' },
        body: 'Body\n',
        entryFile: path.join(normalizeFixtures, 'inline', 'SKILL.md'),
        sourceType: 'directory',
        resources: ['z.md', 'a/b.md', 'a/a.md', 'm.md'],
      }),
    );

    expect(ir.resources).toEqual(['a/a.md', 'a/b.md', 'm.md', 'z.md']);
  });

  it('deduplicates resources that normalize to the same path', () => {
    const { ir } = toNormalizeResult(
      buildParsedSkill({
        frontmatter: { name: 'dedupe-skill', description: 'd' },
        body: 'Body\n',
        entryFile: path.join(normalizeFixtures, 'inline', 'SKILL.md'),
        sourceType: 'directory',
        resources: ['a/b.md', 'a\\b.md'],
      }),
    );

    expect(ir.resources).toEqual(['a/b.md']);
  });
});

describe('portability and privacy', () => {
  it('contains no absolute path, working directory or root path', () => {
    for (const fixture of ['minimal', 'with-resources', 'with-extra-frontmatter']) {
      const serialized = serializeSkillIR(normalizeFixture(fixture).ir);

      expect(serialized).not.toContain(repositoryRoot);
      expect(serialized).not.toContain(tmpdir());
      expect(serialized).not.toContain('C:\\Users');
      expect(serialized).not.toContain('/home/');
      expect(serialized).not.toContain('rootPath');
      expect(serialized).not.toContain('entryFile": "fixtures');
    }
  });

  it('keeps the entry file relative even when the input was an absolute path', () => {
    const absolute = path.join(normalizeFixtures, 'with-resources');

    expect(normalizeSkill(absolute).ir.source.entryFile).toBe('SKILL.md');
  });
});

describe('determinism', () => {
  it('produces deeply equal IR across repeated runs', () => {
    const first = normalizeFixture('nested-extra-frontmatter').ir;
    const second = normalizeFixture('nested-extra-frontmatter').ir;

    expect(second).toEqual(first);
  });

  it('produces byte-identical serialization across 100 runs', () => {
    const baseline = serializeSkillIR(normalizeFixture('nested-extra-frontmatter').ir);

    for (let run = 0; run < 100; run += 1) {
      expect(serializeSkillIR(normalizeFixture('nested-extra-frontmatter').ir)).toBe(baseline);
    }
  });

  it('is independent of the order resources were created on disk', () => {
    const originalOrder = path.join(tmpdir(), `ir-order-a-${process.pid}`);
    const reversedOrder = path.join(tmpdir(), `ir-order-b-${process.pid}`);

    try {
      for (const [root, files] of [
        [originalOrder, ['a.md', 'b.md', 'c.md']],
        [reversedOrder, ['c.md', 'b.md', 'a.md']],
      ] as const) {
        mkdirSync(root, { recursive: true });
        writeFileSync(
          path.join(root, 'SKILL.md'),
          '---\nname: order-skill\ndescription: Same skill, different creation order.\n---\n\nBody.\n',
        );
        for (const file of files) {
          writeFileSync(path.join(root, file), `# ${file}\n`);
        }
      }

      const first = serializeSkillIR(normalizeSkill(originalOrder).ir);
      const second = serializeSkillIR(normalizeSkill(reversedOrder).ir);

      expect(second).toBe(first);
    } finally {
      rmSync(originalOrder, { recursive: true, force: true });
      rmSync(reversedOrder, { recursive: true, force: true });
    }
  });
});

describe('generic validation gate', () => {
  it('refuses to normalize a skill that fails generic validation', () => {
    expect(() => normalizeFixture('generic-invalid')).toThrow(SkillNotNormalizableError);
  });

  it('reports the generic issues rather than a partial IR', () => {
    try {
      normalizeFixture('generic-invalid');
      throw new Error('expected normalizeSkill to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillNotNormalizableError);
      const refusal = error as SkillNotNormalizableError;
      expect(refusal.validation.valid).toBe(false);
      expect(refusal.validation.errors.map((issue) => issue.code)).toContain('MISSING_NAME');
    }
  });

  it('gate is the generic validator, not target compatibility', () => {
    // This skill is DSH-compatible but fails generic structure: a
    // whitespace-only description is accepted upstream but rejected here.
    const target = path.join(repositoryRoot, 'fixtures', 'dsh', 'whitespace-description');

    expect(runCompat(target, { cwd: repositoryRoot }).result.compatible).toBe(true);
    expect(runValidate(target, { cwd: repositoryRoot }).result.valid).toBe(false);
    expect(() => normalizeSkill(target, { cwd: repositoryRoot })).toThrow(
      SkillNotNormalizableError,
    );
  });

  it('normalizes a skill that passes generic validation', () => {
    expect(normalizeFixture('minimal').validation.valid).toBe(true);
  });
});

describe('normalization does not modify its input', () => {
  it('leaves the skill directory byte-identical and mtime-stable', () => {
    const target = path.join(normalizeFixtures, 'with-resources');
    const before = {
      entries: readdirSync(target).sort(),
      skill: readFileSync(path.join(target, 'SKILL.md'), 'utf8'),
      mtime: statSync(path.join(target, 'SKILL.md')).mtimeMs,
    };

    normalizeSkill(target);
    normalizeSkill(target);

    expect(readdirSync(target).sort()).toEqual(before.entries);
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe(before.skill);
    expect(statSync(path.join(target, 'SKILL.md')).mtimeMs).toBe(before.mtime);
  });

  it('does not execute resources', () => {
    const marker = path.join(repositoryRoot, 'fixtures', 'script-resources', 'INVALID-SKILL.md');

    expect(existsSync(marker)).toBe(false);
    normalizeSkill(path.join(repositoryRoot, 'fixtures', 'script-resources'));
    expect(existsSync(marker)).toBe(false);
  });
});

describe('IR neutrality', () => {
  it('uses no platform-specific vocabulary in the IR module', () => {
    const irFiles = readdirSync(path.join(repositoryRoot, 'src', 'ir'));

    expect(irFiles.length).toBeGreaterThan(0);
    for (const file of irFiles) {
      const contents = readFileSync(
        path.join(repositoryRoot, 'src', 'ir', file),
        'utf8',
      ).toLowerCase();
      for (const term of ['deepseek', 'claude', 'codex', 'opencode', 'dsh_', 'dshemitter']) {
        expect(contents).not.toContain(term);
      }
    }
  });

  it('loads a skill fixture without reloading the tree itself', () => {
    // Sanity check that normalization consumes ParsedSkill.resources as provided.
    const skill = loadLocalSkill(path.join(normalizeFixtures, 'with-resources'));

    expect(skill.resources).toEqual(['assets/data.json', 'reference.md']);
  });
});
