/**
 * The Agent Skills source adapter: package shape, entry selection, contract
 * enforcement, and the generic-IR divergence.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_SKILLS_PACKAGE_CODES,
  findAgentSkillEntry,
  loadAgentSkill,
} from '../src/sources/agent-skills/agent-skills-source-adapter.js';
import { AGENT_SKILLS_CODES } from '../src/sources/agent-skills/agent-skills-validator.js';
import { toSkillIR } from '../src/ir/normalize-skill.js';
import { validateBasicSkill, VALIDATION_CODES } from '../src/validators/basic-skill-validator.js';

const repositoryRoot = process.cwd();
const fixtureRoot = path.join(repositoryRoot, 'fixtures', 'sources', 'agent-skills');
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-agent-skills-'));
  temporaryRoots.push(root);
  return root;
}

/** Creates a directory named `name` holding the given files. */
function skillDirectory(name: string, files: Record<string, string>): string {
  const parent = temporaryRoot();
  const root = path.join(parent, name);
  mkdirSync(root, { recursive: true });

  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  return root;
}
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Whether the filesystem distinguishes `SKILL.md` from `skill.md`. */
const caseSensitiveFilesystem = ((): boolean => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-case-'));
  temporaryRoots.push(root);
  writeFileSync(path.join(root, 'Probe.md'), 'x');
  return !existsSync(path.join(root, 'probe.md'));
})();

describe('package shape', () => {
  it('accepts a directory with SKILL.md', () => {
    const result = loadAgentSkill(path.join(fixtureRoot, 'pdf-processing'), repositoryRoot);

    expect(result.ok).toBe(true);
  });

  it('refuses a bare Markdown file instead of falling back to generic mode', () => {
    const result = loadAgentSkill(
      path.join(fixtureRoot, 'pdf-processing', 'SKILL.md'),
      repositoryRoot,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        AGENT_SKILLS_PACKAGE_CODES.shapeInvalid,
      ]);
      expect(result.selection).toBe('package-shape');
    }
  });

  it('refuses a directory whose only Markdown is not an entry name', () => {
    const root = skillDirectory('random-entry', { 'README.md': '# Not a skill\n' });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        AGENT_SKILLS_PACKAGE_CODES.missingEntry,
      ]);
    }
  });

  it('refuses an empty directory', () => {
    const root = skillDirectory('empty-skill', {});
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        AGENT_SKILLS_PACKAGE_CODES.missingEntry,
      ]);
    }
  });

  it('accepts skill.md as the entry', () => {
    const root = skillDirectory('lowercase-entry', {
      'skill.md': '---\nname: lowercase-entry\ndescription: d\n---\n\nBody\n',
    });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(true);
  });

  it('accepts Skill.md because entry matching is case-insensitive', () => {
    const root = skillDirectory('mixed-case-entry', {
      'Skill.md': '---\nname: mixed-case-entry\ndescription: d\n---\n\nBody\n',
    });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(true);
  });

  it.runIf(caseSensitiveFilesystem)('prefers SKILL.md when both entries exist', () => {
    const root = skillDirectory('both-entries', {
      'SKILL.md': '---\nname: both-entries\ndescription: from SKILL.md\n---\n\nUpper\n',
      'skill.md': '---\nname: both-entries\ndescription: from skill.md\n---\n\nLower\n',
    });

    expect(findAgentSkillEntry(root)).toBe(path.join(root, 'SKILL.md'));
  });

  it('reports the entry it selected', () => {
    const root = skillDirectory('lowercase-entry', {
      'skill.md': '---\nname: lowercase-entry\ndescription: d\n---\n\nBody\n',
    });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(path.basename(result.skill.entryFile).toLowerCase()).toBe('skill.md');
    }
  });

  it('keeps the entry out of the resource list', () => {
    const result = loadAgentSkill(path.join(fixtureRoot, 'data-analysis'), repositoryRoot);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.resources).toEqual(['assets/schema.json', 'references/GUIDE.md']);
    }
  });

  it('resolves a relative path against the working directory', () => {
    const result = loadAgentSkill('pdf-processing', fixtureRoot);

    expect(result.ok).toBe(true);
  });
});

describe('name and directory contract', () => {
  it('accepts a matching directory and name', () => {
    const root = skillDirectory('foo', {
      'SKILL.md': '---\nname: foo\ndescription: d\n---\n\nBody\n',
    });

    expect(loadAgentSkill(root, repositoryRoot).ok).toBe(true);
  });

  it('refuses a mismatched directory and name', () => {
    const result = loadAgentSkill(
      path.join(fixtureRoot, 'name-directory-mismatch'),
      repositoryRoot,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        AGENT_SKILLS_CODES.nameDirectoryMismatch,
      ]);
      expect(result.selection).toBe('source-contract');
    }
  });

  it('refuses an uppercase name', () => {
    const root = skillDirectory('Foo', {
      'SKILL.md': '---\nname: Foo\ndescription: d\n---\n\nBody\n',
    });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(false);
  });

  it('refuses a name over 64 characters', () => {
    const name = 'a'.repeat(65);
    const root = skillDirectory(name, {
      'SKILL.md': `---\nname: ${name}\ndescription: d\n---\n\nBody\n`,
    });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(AGENT_SKILLS_CODES.nameTooLong);
    }
  });

  it('accepts a name at exactly 64 characters', () => {
    const name = 'a'.repeat(64);
    const root = skillDirectory(name, {
      'SKILL.md': `---\nname: ${name}\ndescription: d\n---\n\nBody\n`,
    });

    expect(loadAgentSkill(root, repositoryRoot).ok).toBe(true);
  });
});

describe('description contract', () => {
  it('refuses a missing description', () => {
    const result = loadAgentSkill(
      path.join(fixtureRoot, 'missing-description-check'),
      repositoryRoot,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        AGENT_SKILLS_CODES.missingDescription,
      );
    }
  });

  it('refuses a whitespace-only description', () => {
    const result = loadAgentSkill(
      path.join(fixtureRoot, 'empty-description-check'),
      repositoryRoot,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        AGENT_SKILLS_CODES.emptyDescription,
      ]);
    }
  });

  it('refuses a missing name', () => {
    const result = loadAgentSkill(path.join(fixtureRoot, 'missing-name-check'), repositoryRoot);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([AGENT_SKILLS_CODES.missingName]);
    }
  });

  it('refuses a description over 1024 characters', () => {
    const description = 'd'.repeat(1025);
    const root = skillDirectory('long-description', {
      'SKILL.md': `---\nname: long-description\ndescription: ${description}\n---\n\nBody\n`,
    });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(false);
  });

  it('accepts a description at exactly 1024 characters', () => {
    const description = 'd'.repeat(1024);
    const root = skillDirectory('max-description', {
      'SKILL.md': `---\nname: max-description\ndescription: ${description}\n---\n\nBody\n`,
    });

    expect(loadAgentSkill(root, repositoryRoot).ok).toBe(true);
  });
});

describe('unknown fields', () => {
  it('refuses an unknown field at the source adapter', () => {
    const result = loadAgentSkill(path.join(fixtureRoot, 'unknown-key-check'), repositoryRoot);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        AGENT_SKILLS_CODES.unknownFrontmatterKey,
      ]);
      expect(result.selection).toBe('source-contract');
    }
  });
});

describe('optional fields are preserved, never interpreted', () => {
  it.each([
    ['license', 'with-license', { license: 'Apache-2.0' }],
    [
      'compatibility',
      'with-compatibility-check',
      { compatibility: 'Requires git, docker and access to the internet' },
    ],
    ['metadata', 'with-metadata-check', { metadata: { author: 'example-org', version: '1.0' } }],
    [
      'allowed-tools',
      'with-allowed-tools-check',
      { 'allowed-tools': 'Bash(git:*) Bash(jq:*) Read' },
    ],
  ])('accepts %s and keeps its value verbatim in extraFrontmatter', (_label, fixture, expected) => {
    const result = loadAgentSkill(path.join(fixtureRoot, fixture), repositoryRoot);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const ir = toSkillIR(result.skill, result.sourceRoot);
    for (const [key, value] of Object.entries(expected)) {
      expect(ir.source.extraFrontmatter[key]).toEqual(value);
    }
  });

  it('does not treat a known source field as a universal IR field', () => {
    const result = loadAgentSkill(
      path.join(fixtureRoot, 'with-all-optionals-check'),
      repositoryRoot,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ir = toSkillIR(result.skill, result.sourceRoot);
      // Every optional field remains raw source data.
      expect(Object.keys(ir.source.extraFrontmatter).sort()).toEqual([
        'allowed-tools',
        'compatibility',
        'license',
        'metadata',
      ]);
    }
  });

  it('gives the optional fields no generic validator error', () => {
    const result = loadAgentSkill(
      path.join(fixtureRoot, 'with-all-optionals-check'),
      repositoryRoot,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const validation = validateBasicSkill(result.skill);
      // Extra keys are ordinary warnings for the generic rules; the source
      // adapter is what validates their semantics.
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(validation.warnings.map((issue) => issue.code)).toEqual([
        VALIDATION_CODES.unknownFrontmatterKey,
        VALIDATION_CODES.unknownFrontmatterKey,
        VALIDATION_CODES.unknownFrontmatterKey,
        VALIDATION_CODES.unknownFrontmatterKey,
      ]);
    }
  });
});

describe('generic IR divergence', () => {
  it('accepts a Unicode name that the generic rules cannot represent', () => {
    const result = loadAgentSkill(path.join(fixtureRoot, '数据处理'), repositoryRoot);

    // The source contract accepts it...
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // ...but the generic structural rules refuse it, which is a divergence to
    // report rather than a source adapter defect.
    const validation = validateBasicSkill(result.skill);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toEqual([VALIDATION_CODES.invalidName]);
  });
});

describe('source body preservation', () => {
  it('keeps the body exactly as parsed', () => {
    const body = '\n\n# Title\n\n\n   indented\ttab\n\n';
    const root = skillDirectory('body-skill', {
      'SKILL.md': `---\nname: body-skill\ndescription: d\n---\n${body}`,
    });
    const result = loadAgentSkill(root, repositoryRoot);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.body).toBe(body);
    }
  });
});
