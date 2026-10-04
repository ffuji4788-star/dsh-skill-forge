/**
 * Universal Skill IR v2: schema, semantic lifting, canonical serialization, and
 * the v1 stability promise.
 */
import { describe, expect, it } from 'vitest';

import { loadAgentSkill } from '../src/sources/agent-skills/agent-skills-source-adapter.js';
import { validateBasicSkill } from '../src/validators/basic-skill-validator.js';
import { toSkillIR, toLf } from '../src/ir/normalize-skill.js';
import { toSkillIRV2, GENERIC_PROVENANCE } from '../src/ir/normalize-skill-v2.js';
import { serializeSkillIR } from '../src/ir/serialize-skill-ir.js';
import { serializeSkillIRV2 } from '../src/ir/serialize-skill-ir-v2.js';
import { validatePortableSemantics, toSerializedSemantics } from '../src/ir/portable-semantics.js';
import {
  AGENT_SKILLS_FORMAT,
  GENERIC_LOCAL_SKILL_FORMAT,
  SKILL_IR_V2_SCHEMA_VERSION,
  validateSkillIRV2,
  type SkillIRV2,
} from '../src/ir/skill-ir-v2.js';
import { loadLocalSkill } from '../src/importers/local-importer.js';
import path from 'node:path';

const repositoryRoot = process.cwd();
const agentFixture = (name: string): string =>
  path.join(repositoryRoot, 'fixtures', 'sources', 'agent-skills', name);

/** Loads an Agent Skills fixture and lifts it to v2. */
function v2FromAgent(fixture: string): SkillIRV2 {
  const loaded = loadAgentSkill(agentFixture(fixture), repositoryRoot);
  if (!loaded.ok) {
    throw new Error(`fixture ${fixture} did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return toSkillIRV2(
    loaded.skill,
    { format: AGENT_SKILLS_FORMAT, semantics: loaded.semantics ?? {} },
    loaded.sourceRoot,
  );
}

function minimalV2(overrides: Partial<SkillIRV2> = {}): SkillIRV2 {
  return {
    schemaVersion: 2,
    name: 'example-skill',
    description: 'An example.',
    instructions: '# Example\n',
    resources: [],
    semantics: {},
    source: { format: GENERIC_LOCAL_SKILL_FORMAT, entryFile: 'SKILL.md', extraFrontmatter: {} },
    ...overrides,
  };
}

describe('IR v2 schema', () => {
  it('accepts a minimal document with empty semantics', () => {
    expect(validateSkillIRV2(minimalV2())).toEqual([]);
  });

  it('accepts semantics with all portable fields', () => {
    const ir = minimalV2({
      semantics: {
        license: 'Apache-2.0',
        compatibility: 'Requires git',
        metadata: { author: 'example-org' },
      },
    });

    expect(validateSkillIRV2(ir)).toEqual([]);
  });

  it('requires schemaVersion 2', () => {
    expect(validateSkillIRV2({ ...minimalV2(), schemaVersion: 1 })).toContain(
      'schemaVersion must be 2',
    );
  });

  it('requires semantics to be present', () => {
    const ir = minimalV2();
    const withoutSemantics = { ...ir } as Record<string, unknown>;
    delete withoutSemantics['semantics'];

    expect(validateSkillIRV2(withoutSemantics)).toContain(
      'semantics must be present (use {} when the source offers none)',
    );
  });

  it('rejects a non-object semantics', () => {
    expect(validateSkillIRV2({ ...minimalV2(), semantics: 'none' })).toContain(
      'semantics must be an object',
    );
  });

  it('rejects an unknown semantic field', () => {
    const problems = validateSkillIRV2({
      ...minimalV2(),
      semantics: { toolPermissions: 'Read' },
    });

    expect(problems.some((problem) => problem.includes('toolPermissions'))).toBe(true);
  });

  it('rejects a non-string license', () => {
    expect(validateSkillIRV2({ ...minimalV2(), semantics: { license: 42 } })).toContain(
      'semantics.license must be a string',
    );
  });

  it('rejects a non-string compatibility', () => {
    expect(validateSkillIRV2({ ...minimalV2(), semantics: { compatibility: ['git'] } })).toContain(
      'semantics.compatibility must be a string',
    );
  });

  it('rejects a metadata array', () => {
    expect(validateSkillIRV2({ ...minimalV2(), semantics: { metadata: ['a'] } })).toContain(
      'semantics.metadata must be an object',
    );
  });

  it('rejects a non-string metadata value', () => {
    const problems = validateSkillIRV2({
      ...minimalV2(),
      semantics: { metadata: { version: 1.0 } },
    });

    expect(problems).toContain('semantics.metadata.version must be a string');
  });

  it('rejects an unknown source.format', () => {
    const problems = validateSkillIRV2({
      ...minimalV2(),
      source: { format: 'claude', entryFile: 'SKILL.md', extraFrontmatter: {} },
    });

    expect(problems).toContain('source.format "claude" is not a known v2 provenance');
  });

  it('accepts both known provenances', () => {
    for (const format of [GENERIC_LOCAL_SKILL_FORMAT, AGENT_SKILLS_FORMAT]) {
      const ir = minimalV2({
        source: { format, entryFile: 'SKILL.md', extraFrontmatter: {} },
      });
      expect(validateSkillIRV2(ir)).toEqual([]);
    }
  });

  it('rejects an absolute entryFile', () => {
    const problems = validateSkillIRV2({
      ...minimalV2(),
      source: { format: AGENT_SKILLS_FORMAT, entryFile: '/etc/SKILL.md', extraFrontmatter: {} },
    });

    expect(problems.some((problem) => problem.includes('skill-root-relative'))).toBe(true);
  });

  it('rejects an unsafe resource path', () => {
    expect(validateSkillIRV2({ ...minimalV2(), resources: ['../escape.md'] })).toContain(
      'resources[0] "../escape.md" must be a skill-root-relative path without traversal',
    );
  });

  it('rejects extraFrontmatter that repeats a promoted semantic', () => {
    const problems = validateSkillIRV2({
      ...minimalV2(),
      semantics: { license: 'Apache-2.0' },
      source: {
        format: AGENT_SKILLS_FORMAT,
        entryFile: 'SKILL.md',
        extraFrontmatter: { license: 'Apache-2.0' },
      },
    });

    expect(problems).toContain(
      'source.extraFrontmatter must not repeat promoted semantics: license',
    );
  });

  it('rejects extraFrontmatter that repeats the core fields', () => {
    const problems = validateSkillIRV2({
      ...minimalV2(),
      source: {
        format: AGENT_SKILLS_FORMAT,
        entryFile: 'SKILL.md',
        extraFrontmatter: { name: 'x' },
      },
    });

    expect(problems).toContain('source.extraFrontmatter must not repeat the universal core fields');
  });

  it('rejects a missing name and an empty description', () => {
    const problems = validateSkillIRV2({ ...minimalV2(), name: '', description: '' });
    expect(problems).toContain('name must not be empty');
    expect(problems).toContain('description must not be empty');
  });
});

describe('portable semantics', () => {
  it('accepts an empty object', () => {
    expect(validatePortableSemantics({})).toEqual([]);
  });

  it('omits absent fields rather than serializing null', () => {
    const converted = toSerializedSemantics({ license: 'MIT' });

    expect(converted).toEqual({ value: { license: 'MIT' } });
  });

  it('sorts metadata keys canonically', () => {
    const converted = toSerializedSemantics({ metadata: { zeta: '1', alpha: '2' } });

    expect(Object.keys((converted as { value: Record<string, unknown> }).value)).toEqual([
      'metadata',
    ]);
    expect(
      Object.keys(
        (converted as { value: Record<string, Record<string, string>> }).value['metadata'] ?? {},
      ),
    ).toEqual(['alpha', 'zeta']);
  });

  it('preserves values exactly, including empty and whitespace strings', () => {
    const metadata = { empty: '', padded: '  x  ', quoted: '"q"', yes: 'yes', one: '1' };
    const converted = toSerializedSemantics({ metadata });

    expect((converted as { value: { metadata: Record<string, string> } }).value.metadata).toEqual(
      metadata,
    );
  });

  it('refuses a non-string value', () => {
    const converted = toSerializedSemantics({ metadata: { n: '1' } as Record<string, string> });
    expect(converted).toEqual({ value: { metadata: { n: '1' } } });
  });
});

describe('semantic lifting from Agent Skills', () => {
  it('lifts nothing from a minimal skill', () => {
    const ir = v2FromAgent('pdf-processing');

    expect(ir.semantics).toEqual({});
    expect(ir.source.extraFrontmatter).toEqual({});
  });

  it('lifts license and removes it from the source envelope', () => {
    const ir = v2FromAgent('with-license');

    expect(ir.semantics).toEqual({ license: 'Apache-2.0' });
    expect(ir.source.extraFrontmatter).toEqual({});
  });

  it('lifts compatibility and removes it from the source envelope', () => {
    const ir = v2FromAgent('with-compatibility-check');

    expect(ir.semantics).toEqual({
      compatibility: 'Requires git, docker and access to the internet',
    });
    expect(ir.source.extraFrontmatter).toEqual({});
  });

  it('lifts metadata verbatim and removes it from the source envelope', () => {
    const ir = v2FromAgent('with-metadata-check');

    expect(ir.semantics).toEqual({ metadata: { author: 'example-org', version: '1.0' } });
    expect(ir.source.extraFrontmatter).toEqual({});
  });

  it('lifts all three together', () => {
    const ir = v2FromAgent('with-all-optionals-check');

    // Strict key comparison: an unexpected key present with an `undefined` value
    // would still be a leak, and `toEqual` would hide it.
    expect(Object.keys(ir.semantics).sort()).toEqual(['compatibility', 'license', 'metadata']);
    expect(ir.semantics['license']).toBe('Proprietary. LICENSE.txt has complete terms');
    expect(ir.semantics['compatibility']).toBe('Designed for Claude Code (or similar products)');
    expect(ir.semantics['metadata']).toEqual({ author: 'example-org', version: '1.0' });
    // allowed-tools is the only field left in the envelope: it was never promoted.
    expect(ir.source.extraFrontmatter).toEqual({ 'allowed-tools': 'Bash(git:*) Read' });
  });

  it('never promotes allowed-tools', () => {
    const ir = v2FromAgent('with-allowed-tools-check');

    expect(ir.semantics).toEqual({});
    expect(ir.source.extraFrontmatter).toEqual({ 'allowed-tools': 'Bash(git:*) Bash(jq:*) Read' });
  });

  it('does not duplicate a lifted field in the envelope', () => {
    for (const fixture of ['with-license', 'with-compatibility-check', 'with-metadata-check']) {
      const ir = v2FromAgent(fixture);
      for (const field of Object.keys(ir.semantics)) {
        expect(ir.source.extraFrontmatter).not.toHaveProperty(field);
      }
    }
  });

  it('records the agent-skills provenance', () => {
    expect(v2FromAgent('pdf-processing').source.format).toBe(AGENT_SKILLS_FORMAT);
  });

  it('keeps a nested extra field that was not promoted', () => {
    const ir = v2FromAgent('with-all-optionals-check');
    expect(ir.source.extraFrontmatter['allowed-tools']).toBe('Bash(git:*) Read');
  });
});

describe('generic provenance interprets nothing', () => {
  it('produces empty semantics and keeps every extra key in the envelope', () => {
    const skill = loadLocalSkill(
      path.join(repositoryRoot, 'fixtures', 'convert', 'with-extra-frontmatter'),
    );
    const ir = toSkillIRV2(skill, GENERIC_PROVENANCE, path.dirname(skill.entryFile));

    // The generic path has no source contract, so it cannot know that a key
    // named `metadata` means metadata.
    expect(ir.semantics).toEqual({});
    expect(ir.source.extraFrontmatter).toEqual({ author: 'Alice', version: 2 });
  });

  it('does not lift a metadata-shaped generic key', () => {
    const skill = loadLocalSkill(
      path.join(repositoryRoot, 'fixtures', 'sources', 'agent-skills', 'with-metadata-check'),
    );
    const ir = toSkillIRV2(skill, GENERIC_PROVENANCE, path.dirname(skill.entryFile));

    expect(ir.semantics).toEqual({});
    expect(ir.source.extraFrontmatter).toHaveProperty('metadata');
  });
});

describe('v2 serialization', () => {
  it('uses a fixed top-level field order', () => {
    const text = serializeSkillIRV2(minimalV2());
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);

    expect(keys).toEqual([
      'schemaVersion',
      'name',
      'description',
      'instructions',
      'resources',
      'semantics',
      'source',
    ]);
  });

  it('ends with exactly one newline and uses two-space indent', () => {
    const text = serializeSkillIRV2(minimalV2());

    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).toContain('\n  "name"');
    expect(text).not.toContain('\r');
  });

  it('is deterministic across key insertion order', () => {
    const first = serializeSkillIRV2(minimalV2({ semantics: { metadata: { b: '2', a: '1' } } }));
    const second = serializeSkillIRV2(minimalV2({ semantics: { metadata: { a: '1', b: '2' } } }));

    expect(second).toBe(first);
  });

  it('refuses to serialize an invalid document', () => {
    const wrongVersion = { ...minimalV2(), schemaVersion: 1 } as unknown as SkillIRV2;
    expect(() => serializeSkillIRV2(wrongVersion)).toThrow(/Refusing to serialize invalid IR v2/);
  });
});

describe('v1 remains frozen', () => {
  it('v1 and v2 agree on the core fields for the same skill', () => {
    const loaded = loadAgentSkill(agentFixture('pdf-processing'), repositoryRoot);
    if (!loaded.ok) throw new Error('fixture failed');

    const v1 = toSkillIR(loaded.skill, loaded.sourceRoot);
    const v2 = toSkillIRV2(
      loaded.skill,
      { format: AGENT_SKILLS_FORMAT, semantics: loaded.semantics ?? {} },
      loaded.sourceRoot,
    );

    expect(v2.name).toBe(v1.name);
    expect(v2.description).toBe(v1.description);
    expect(v2.instructions).toBe(v1.instructions);
    expect(v2.resources).toEqual(v1.resources);
    expect(v2.source.entryFile).toBe(v1.source.entryFile);
  });

  it('keeps v1 schemaVersion at 1 and its provenance list unchanged', () => {
    const loaded = loadLocalSkill(path.join(repositoryRoot, 'fixtures', 'normalize', 'minimal'));
    const v1 = toSkillIR(loaded, path.dirname(loaded.entryFile));

    expect(v1.schemaVersion).toBe(1);
    expect(v1.source.format).toBe(GENERIC_LOCAL_SKILL_FORMAT);
    expect(serializeSkillIR(v1)).toContain('"schemaVersion": 1');
    expect(serializeSkillIR(v1)).not.toContain('semantics');
  });

  it('keeps v1 free of any semantic vocabulary', () => {
    // An Agent Skills skill normalized through v1 must keep its interpreted
    // fields as raw source data: v1 has no semantics object at all.
    const loaded = loadAgentSkill(agentFixture('with-license'), repositoryRoot);
    if (!loaded.ok) throw new Error('fixture failed');

    const v1 = toSkillIR(loaded.skill, loaded.sourceRoot);
    expect(v1.source.extraFrontmatter).toEqual({ license: 'Apache-2.0' });
    expect(serializeSkillIR(v1)).not.toContain('semantics');
  });

  it('keeps validateBasicSkill untouched by v2 semantics', () => {
    const loaded = loadAgentSkill(agentFixture('with-metadata-check'), repositoryRoot);
    if (!loaded.ok) throw new Error('fixture failed');

    const validation = validateBasicSkill(loaded.skill);
    // The generic rules know only name and description, so metadata is an
    // ordinary warning. Target-specific truth belongs to the target contract.
    expect(validation.valid).toBe(true);
    expect(validation.warnings.map((issue) => issue.code)).toEqual(['UNKNOWN_FRONTMATTER_KEY']);
  });

  it('keeps the v1 body normalization rule', () => {
    expect(toLf('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

describe('IR v2 constants', () => {
  it('declares schema version 2', () => {
    expect(SKILL_IR_V2_SCHEMA_VERSION).toBe(2);
  });
});
