/**
 * The DSH target mapping for portable semantics, verified through the real CLI.
 *
 * The property under test is that a semantic the source interpreted is either
 * mapped faithfully or refused — never dropped, and never reinterpreted into a
 * field that means something else.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { runCli } from '../src/cli/run.js';
import { CONVERSION_CODES } from '../src/schemas/conversion.js';
import {
  renderDshSkillMarkdownV2,
  toDshEmitExtras,
  unsupportedDshSemantics,
} from '../src/targets/dsh/dsh-target-adapter.js';
import { EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-semantics-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function run(
  ...argv: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli({
    argv,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr };
}

function convert(
  fixture: string,
  out: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return run('convert', fixture, '--source', 'agent-skills', '--target', 'dsh', '--out', out);
}

/** Reads the generated frontmatter as a parsed object. */
function generatedFrontmatter(out: string): Record<string, unknown> {
  const text = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
  const closing = text.indexOf('\n---', 4);
  const block = text.slice(text.indexOf('---\n') + 4, closing);
  return parseYaml(block) as Record<string, unknown>;
}

function listPackage(root: string): string[] {
  const found: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else {
        found.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }

  return found.sort();
}

describe('metadata maps to the DSH target', () => {
  it('converts a metadata-only Agent Skill', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout, stderr } = await convert(
      'fixtures/sources/agent-skills/metadata-skill',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: SUCCESS');
    expect(listPackage(out)).toEqual(['SKILL.md', 'references/GUIDE.md']);
  });

  it('emits metadata that parses back to the source values', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await convert('fixtures/sources/agent-skills/metadata-skill', out);

    expect(generatedFrontmatter(out)['metadata']).toEqual({
      author: 'example-org',
      version: '1.0',
      reviewed: 'yes',
    });
  });

  it('round-trips hostile metadata values without YAML coercion', async () => {
    const root = temporaryRoot();
    const skill = path.join(root, 'coercion-skill');
    const sourceMetadata = {
      empty: '',
      padded: '  spaced  ',
      booleanish: 'true',
      booleanishOff: 'false',
      yesish: 'yes',
      noish: 'no',
      onish: 'on',
      numberish: '1',
      floatish: '1.0',
      nulleish: 'null',
      tilde: '~',
      colon: 'key: value',
      hash: '#not-a-comment',
      quotes: 'he said "hi" and \'bye\'',
      multiline: 'line one\nline two',
      unicode: '描述 🚀',
      dash: '- not a list',
      braces: '{a: 1}',
    };

    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      path.join(skill, 'SKILL.md'),
      ['---', 'name: coercion-skill', 'description: d', 'metadata:'].join('\n') +
        '\n' +
        Object.entries(sourceMetadata)
          .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
          .join('\n') +
        '\n---\n\n# Body\n',
    );

    const out = path.join(root, 'generated');
    const { exitCode } = await convert(skill, out);
    expect(exitCode).toBe(EXIT_SUCCESS);

    // The generated YAML must parse back to the exact same strings.
    expect(generatedFrontmatter(out)['metadata']).toEqual(sourceMetadata);
  });

  it('keeps the generated package clean: generic valid and DSH compatible with no warnings', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await convert('fixtures/sources/agent-skills/metadata-skill', out);

    const validate = await run('validate', out);
    const compat = await run('compat', out);

    expect(validate.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.stdout).toContain('Result: COMPATIBLE');
    expect(compat.stdout).toContain('Warnings: 0');
  });

  it('never invents whenToUse or invocation fields', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await convert('fixtures/sources/agent-skills/metadata-skill', out);
    const frontmatter = generatedFrontmatter(out);

    expect(frontmatter).not.toHaveProperty('whenToUse');
    expect(frontmatter).not.toHaveProperty('disable-model-invocation');
    expect(frontmatter).not.toHaveProperty('user-invocable');

    const text = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    expect(text).not.toContain('whenToUse');
    expect(text).not.toContain('model-invocation');
    expect(text).not.toContain('user-invocable');
  });

  it('does not put metadata into the instructions body', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await convert('fixtures/sources/agent-skills/metadata-skill', out);
    const text = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    const body = text.slice(text.indexOf('\n---', 4) + 4);

    expect(body).not.toContain('example-org');
    expect(body.trim().startsWith('# Metadata Skill')).toBe(true);
  });

  it('is deterministic across two output locations', async () => {
    const first = path.join(temporaryRoot(), 'first');
    const second = path.join(temporaryRoot(), 'second');

    await convert('fixtures/sources/agent-skills/metadata-skill', first);
    await convert('fixtures/sources/agent-skills/metadata-skill', second);

    expect(listPackage(second)).toEqual(listPackage(first));
    for (const relative of listPackage(first)) {
      expect(readFileSync(path.join(second, relative))).toEqual(
        readFileSync(path.join(first, relative)),
      );
    }
  });
});

describe('unsupported semantics are refused, never reinterpreted', () => {
  it.each([
    ['license', 'with-license', 'license'],
    ['compatibility', 'with-compatibility-check', 'compatibility'],
  ])('refuses %s with UNSUPPORTED_TARGET_SEMANTIC', async (_label, fixture, field) => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(`fixtures/sources/agent-skills/${fixture}`, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unsupportedTargetSemantic);
    expect(stdout).toContain(`- ${field}`);
    expect(existsSync(out)).toBe(false);
  });

  it('reports both unsupported semantics in deterministic sorted order', async () => {
    const root = temporaryRoot();
    const skill = path.join(root, 'both-semantics');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: both-semantics\ndescription: d\nlicense: MIT\ncompatibility: Requires git\n---\n\n# Body\n',
    );

    const out = path.join(root, 'generated');
    const first = await convert(skill, out);
    const second = await convert(skill, path.join(root, 'generated-2'));

    expect(first.exitCode).toBe(EXIT_VALIDATION_FAILED);
    // Sorted, so object insertion order cannot influence the report.
    expect(first.stdout.indexOf('- compatibility')).toBeLessThan(first.stdout.indexOf('- license'));
    expect(second.stdout).toBe(first.stdout);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses metadata combined with license rather than emitting the metadata', async () => {
    const root = temporaryRoot();
    const skill = path.join(root, 'mixed-semantics');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: mixed-semantics\ndescription: d\nlicense: MIT\nmetadata:\n  author: example-org\n---\n\n# Body\n',
    );

    const out = path.join(root, 'generated');
    const { exitCode, stdout } = await convert(skill, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unsupportedTargetSemantic);
    expect(stdout).toContain('- license');
    // No partial package: the mapable metadata is not emitted on its own.
    expect(existsSync(out)).toBe(false);
  });

  it('refuses metadata combined with allowed-tools as unmapped source data', async () => {
    const root = temporaryRoot();
    const skill = path.join(root, 'mixed-source');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: mixed-source\ndescription: d\nallowed-tools: Read\nmetadata:\n  author: example-org\n---\n\n# Body\n',
    );

    const out = path.join(root, 'generated');
    const { exitCode, stdout } = await convert(skill, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    // allowed-tools has no home at all, so it is unmapped source data, not a
    // target semantic gap.
    expect(stdout).toContain(CONVERSION_CODES.unmappedSourceFrontmatter);
    expect(stdout).toContain('- allowed-tools');
    expect(stdout).not.toContain(CONVERSION_CODES.unsupportedTargetSemantic);
    expect(existsSync(out)).toBe(false);
  });

  it('leaves no staging directory and no output for any refusal', async () => {
    const parent = temporaryRoot();
    await convert('fixtures/sources/agent-skills/with-license', path.join(parent, 'generated'));

    expect(readdirSync(parent)).toEqual([]);
  });
});

describe('v1 sources keep converting unchanged', () => {
  it('still converts a minimal Agent Skill with no metadata key', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert('fixtures/sources/agent-skills/pdf-processing', out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const frontmatter = generatedFrontmatter(out);
    expect(frontmatter).not.toHaveProperty('metadata');
    expect(frontmatter['name']).toBe('pdf-processing');
  });

  it('still converts a generic skill byte-for-byte with no semantics involved', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await run(
      'convert',
      'fixtures/convert/with-resource',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(listPackage(out)).toEqual(['SKILL.md', 'reference.md']);
  });
});

describe('values the IR cannot represent are refused, not fatal', () => {
  it('refuses metadata with an unsafe JSON key instead of crashing', async () => {
    const root = temporaryRoot();
    const skill = path.join(root, 'unsafe-key');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skill, { recursive: true });
    // `__proto__` is a legitimate YAML key and the parser keeps it as an own
    // property, but the canonical IR refuses it as an unsafe JSON key.
    writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: unsafe-key\ndescription: d\nmetadata:\n  __proto__: polluted\n---\n\n# Body\n',
    );

    const out = path.join(root, 'generated');
    const { exitCode, stdout, stderr } = await convert(skill, out);

    // A refusal, not a crash: the caller did nothing wrong, and the value simply
    // cannot be carried.
    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stderr).toBe('');
    expect(stdout).toContain(CONVERSION_CODES.unrepresentableIrValue);
    expect(stdout).toContain('__proto__');
    expect(existsSync(out)).toBe(false);
  });

  it('does not pollute Object.prototype while refusing', async () => {
    const root = temporaryRoot();
    const skill = path.join(root, 'unsafe-key-2');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: unsafe-key-2\ndescription: d\nmetadata:\n  __proto__: polluted\n---\n\n# Body\n',
    );

    await convert(skill, path.join(root, 'generated'));

    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('leaves no staging directory behind for that refusal', async () => {
    const parent = temporaryRoot();
    const skill = path.join(parent, 'unsafe-key-3');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: unsafe-key-3\ndescription: d\nmetadata:\n  __proto__: polluted\n---\n\n# Body\n',
    );

    await convert(skill, path.join(parent, 'generated'));

    expect(readdirSync(parent).filter((name) => name.startsWith('.dsh-forge-staging-'))).toEqual(
      [],
    );
  });
});

describe('the v2 renderer used by the converter', () => {
  it('emits metadata and omits the semantics the target cannot express', () => {
    const rendered = renderDshSkillMarkdownV2({
      schemaVersion: 2,
      name: 'render-skill',
      description: 'A description.',
      instructions: '# Body\n',
      resources: [],
      semantics: { metadata: { author: 'example-org', version: '1.0' } },
      source: { format: 'agent-skills', entryFile: 'SKILL.md', extraFrontmatter: {} },
    });

    expect(rendered.path).toBe('SKILL.md');
    expect(rendered.content).toContain('name: render-skill');
    expect(rendered.content).toContain('author: example-org');
    expect(rendered.content).toContain('version: "1.0"');
    expect(rendered.content.endsWith('# Body\n')).toBe(true);
    expect(rendered.content).not.toContain('whenToUse');

    // The mapping helpers agree with each other.
    expect(unsupportedDshSemantics({ metadata: {} })).toEqual([]);
    expect(toDshEmitExtras({ metadata: { a: 'b' } })).toEqual({ metadata: { a: 'b' } });
  });

  it('emits no metadata block for empty metadata', () => {
    const rendered = renderDshSkillMarkdownV2({
      schemaVersion: 2,
      name: 'empty-metadata-skill',
      description: 'd',
      instructions: '# Body\n',
      resources: [],
      semantics: { metadata: {} },
      source: { format: 'agent-skills', entryFile: 'SKILL.md', extraFrontmatter: {} },
    });

    // An empty map is omitted rather than emitted as `metadata: {}`, which would
    // add a frontmatter key the source did not meaningfully provide.
    expect(rendered.content).not.toMatch(/^metadata:/m);
    expect(rendered.content).toContain('name: empty-metadata-skill');
  });

  it('reports every non-metadata semantic as unsupported, sorted', () => {
    expect(unsupportedDshSemantics({ license: 'MIT', compatibility: 'Requires git' })).toEqual([
      'compatibility',
      'license',
    ]);
  });
});

describe('no lossy escape hatch exists', () => {
  it('advertises no flag that would drop a semantic', async () => {
    const program = readFileSync(path.join(repositoryRoot, 'src', 'cli', 'program.ts'), 'utf8');

    for (const forbidden of [
      '--allow-lossy',
      '--drop-license',
      '--ignore-compatibility',
      '--force',
      '--pass-through',
    ]) {
      expect(program).not.toContain(forbidden);
    }
  });
});
