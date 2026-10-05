/**
 * The tool-owned license preservation envelope.
 *
 * The property under test: a license declaration survives byte-for-byte and
 * changes nothing about how the target behaves. This is preservation, not a
 * native mapping, and the tests say so explicitly.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { runCli } from '../src/cli/run.js';
import { CONVERSION_CODES } from '../src/schemas/conversion.js';
import {
  buildDshMetadata,
  DSH_PRESERVATION_VERSION,
  DSH_SKILL_FORGE_METADATA_NAMESPACE,
  hasPreservationEnvelope,
  PRESERVABLE_SEMANTIC_FIELDS,
  readPreservedSemantics,
} from '../src/targets/dsh/dsh-metadata-envelope.js';
import { EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-envelope-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Builds a skill directory whose frontmatter is generated from raw YAML lines. */
function skill(
  name: string,
  frontmatterLines: readonly string[],
  options: { readonly description?: string; readonly files?: Record<string, string> } = {},
): string {
  const root = path.join(temporaryRoot(), name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${JSON.stringify(options.description ?? 'd')}`,
      ...frontmatterLines,
      '---',
      '',
      '# Body',
      '',
    ].join('\n'),
  );
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

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

function convert(dir: string, out: string) {
  return run('convert', dir, '--source', 'agent-skills', '--target', 'dsh', '--out', out);
}

/** Parses the frontmatter of a generated package. */
function generatedFrontmatter(out: string): Record<string, unknown> {
  const text = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
  return parseYaml(text.slice(4, text.indexOf('\n---', 4))) as Record<string, unknown>;
}

function listPackage(root: string): string[] {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else found.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return found.sort();
}

describe('envelope shape', () => {
  it('declares a fixed namespace and version', () => {
    expect(DSH_SKILL_FORGE_METADATA_NAMESPACE).toBe('dsh-skill-forge');
    expect(DSH_PRESERVATION_VERSION).toBe(1);
    expect([...PRESERVABLE_SEMANTIC_FIELDS]).toEqual(['license']);
  });

  it('writes nothing when there is nothing to preserve', () => {
    const built = buildDshMetadata({});

    expect(built).toEqual({ ok: true, metadata: {}, preservedFields: [] });
  });

  it('nests the envelope under the namespace with a version', () => {
    const built = buildDshMetadata({ license: 'Apache-2.0' });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.metadata).toEqual({
      'dsh-skill-forge': {
        preservationVersion: 1,
        preservedSemantics: { license: 'Apache-2.0' },
      },
    });
    expect(built.preservedFields).toEqual(['license']);
  });

  it('keeps native metadata separate from the envelope', () => {
    const built = buildDshMetadata({
      license: 'MIT',
      metadata: { author: 'example-org', version: '1.0' },
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.metadata).toEqual({
      author: 'example-org',
      version: '1.0',
      'dsh-skill-forge': {
        preservationVersion: 1,
        preservedSemantics: { license: 'MIT' },
      },
    });
  });

  it('does not move native metadata into the envelope', () => {
    const built = buildDshMetadata({ metadata: { author: 'example-org' } });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.metadata).toEqual({ author: 'example-org' });
    expect(hasPreservationEnvelope(built.metadata)).toBe(false);
  });

  it('reads its own envelope back', () => {
    const built = buildDshMetadata({ license: 'Apache-2.0' });
    if (!built.ok) throw new Error('expected a built envelope');

    expect(readPreservedSemantics(built.metadata)).toEqual({ license: 'Apache-2.0' });
    expect(hasPreservationEnvelope(built.metadata)).toBe(true);
  });

  it('ignores what it cannot read', () => {
    expect(readPreservedSemantics(undefined)).toEqual({});
    expect(readPreservedSemantics('nope')).toEqual({});
    expect(readPreservedSemantics({ 'dsh-skill-forge': 'nope' })).toEqual({});
    expect(readPreservedSemantics({ 'dsh-skill-forge': { preservedSemantics: null } })).toEqual({});
    expect(hasPreservationEnvelope({ 'dsh-skill-forge': { preservationVersion: 999 } })).toBe(
      false,
    );
  });
});

describe('namespace collision', () => {
  it('refuses a source that already uses the reserved namespace', () => {
    const built = buildDshMetadata({ metadata: { 'dsh-skill-forge': 'hello' } });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problems[0]?.code).toBe('TARGET_METADATA_NAMESPACE_COLLISION');
  });

  it('refuses an existing envelope with a different version rather than merging', () => {
    const built = buildDshMetadata({
      metadata: { 'dsh-skill-forge': { preservationVersion: 999, preservedSemantics: {} } },
    } as unknown as Parameters<typeof buildDshMetadata>[0]);

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problems[0]?.code).toBe('TARGET_METADATA_NAMESPACE_COLLISION');
  });

  it('refuses the collision before any output is created', async () => {
    const dir = skill('collision-skill', ['metadata:', '  dsh-skill-forge: hello']);
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.targetMetadataNamespaceCollision);
    expect(existsSync(out)).toBe(false);
  });

  it('leaves no staging directory for a collision', async () => {
    const parent = temporaryRoot();
    const dir = path.join(parent, 'collision-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\nname: collision-skill\ndescription: d\nmetadata:\n  dsh-skill-forge: x\n---\n\n# B\n',
    );

    await convert(dir, path.join(parent, 'generated'));

    expect(readdirSync(parent).filter((entry) => entry.startsWith('.dsh-forge-staging-'))).toEqual(
      [],
    );
  });
});

describe('unsafe keys in metadata', () => {
  it.each(['__proto__', 'constructor', 'prototype'])(
    'refuses the reserved JSON key %s without polluting prototypes',
    async (key) => {
      const dir = skill('unsafe-key-skill', ['metadata:', `  ${key}: polluted`]);
      const out = path.join(temporaryRoot(), 'generated');
      const { exitCode, stdout } = await convert(dir, out);

      expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
      expect(stdout).toContain(CONVERSION_CODES.unrepresentableIrValue);
      expect(existsSync(out)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    },
  );
});

describe('license fidelity through the whole pipeline', () => {
  const values = [
    'Apache-2.0',
    'Complete terms in LICENSE.txt',
    'Proprietary. LICENSE.txt has complete terms',
    'MIT',
    'note: a colon',
    "it's single quoted",
    'she said "double quoted"',
    'line one\nline two',
    '描述ライセンス',
    'license 🚀 emoji',
    'true',
    'false',
    '1',
    'null',
    '~',
    ' padded value ',
    '#hash-start',
    '- not a list',
  ];

  it.each(values.map((value) => [JSON.stringify(value), value] as const))(
    'round-trips license %s exactly',
    async (_label, value) => {
      const dir = skill('fidelity-skill', [`license: ${JSON.stringify(value)}`]);
      const out = path.join(temporaryRoot(), 'generated');
      const { exitCode } = await convert(dir, out);

      expect(exitCode).toBe(EXIT_SUCCESS);
      const frontmatter = generatedFrontmatter(out);
      const preserved = (frontmatter['metadata'] as Record<string, unknown>)[
        DSH_SKILL_FORGE_METADATA_NAMESPACE
      ] as Record<string, unknown>;
      expect((preserved['preservedSemantics'] as Record<string, unknown>)['license']).toBe(value);
      expect(preserved['preservationVersion']).toBe(1);
    },
  );

  it('never emits a top-level license field', async () => {
    const dir = skill('no-top-level', ['license: Apache-2.0']);
    const out = path.join(temporaryRoot(), 'generated');
    await convert(dir, out);

    const frontmatter = generatedFrontmatter(out);
    expect(frontmatter).not.toHaveProperty('license');
    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'metadata', 'name']);
    expect(readFileSync(path.join(out, 'SKILL.md'), 'utf8')).not.toMatch(/^license:/m);
  });
});

describe('license declarations without a license file', () => {
  it('converts without requiring the referenced file to exist', async () => {
    const dir = skill('no-file-skill', ['license: Apache-2.0']);
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(listPackage(out)).toEqual(['SKILL.md']);
  });

  it('does not synthesize a LICENSE file for a declaration that names one', async () => {
    const dir = skill('names-a-file', ['license: Complete terms in LICENSE.txt']);
    const out = path.join(temporaryRoot(), 'generated');
    await convert(dir, out);

    expect(listPackage(out)).toEqual(['SKILL.md']);
  });
});

describe('license resources are ordinary resources', () => {
  it('copies a LICENSE file byte-for-byte without reading it as a license', async () => {
    const licenseText = 'PROPRIETARY NOTICE\nDo not redistribute.\n';
    const dir = skill('with-license-file', ['license: See LICENSE.txt'], {
      files: { 'LICENSE.txt': licenseText },
    });
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(listPackage(out)).toEqual(['LICENSE.txt', 'SKILL.md']);
    expect(readFileSync(path.join(out, 'LICENSE.txt'))).toEqual(
      readFileSync(path.join(dir, 'LICENSE.txt')),
    );

    // The declaration stays verbatim and is never rewritten from the file.
    const preserved = (generatedFrontmatter(out)['metadata'] as Record<string, unknown>)[
      DSH_SKILL_FORGE_METADATA_NAMESPACE
    ] as Record<string, unknown>;
    expect((preserved['preservedSemantics'] as Record<string, unknown>)['license']).toBe(
      'See LICENSE.txt',
    );
  });

  it('copies a nested license file as a resource too', async () => {
    const dir = skill('nested-license', ['license: See licenses/TERMS.md'], {
      files: { 'licenses/TERMS.md': '# Terms\n' },
    });
    const out = path.join(temporaryRoot(), 'generated');
    await convert(dir, out);

    expect(listPackage(out)).toEqual(['SKILL.md', 'licenses/TERMS.md']);
  });
});

describe('preservation does not change target behaviour', () => {
  it('invents no routing, invocation or permission field', async () => {
    const dir = skill('behaviour-skill', ['license: Apache-2.0']);
    const out = path.join(temporaryRoot(), 'generated');
    await convert(dir, out);

    const text = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    for (const forbidden of [
      'whenToUse',
      'disable-model-invocation',
      'user-invocable',
      'allowed-tools',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('leaves the description and body untouched', async () => {
    const dir = skill('body-skill', ['license: Apache-2.0']);
    const out = path.join(temporaryRoot(), 'generated');
    await convert(dir, out);

    const frontmatter = generatedFrontmatter(out);
    expect(frontmatter['name']).toBe('body-skill');
    expect(frontmatter['description']).toBe('d');
    const body = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    expect(body.slice(body.indexOf('\n---', 4) + 4).trim()).toBe('# Body');
  });

  it('produces a package that is generically valid and DSH compatible with no warnings', async () => {
    const dir = skill('valid-skill', ['license: Apache-2.0']);
    const out = path.join(temporaryRoot(), 'generated');
    await convert(dir, out);

    const validate = await run('validate', out);
    const compat = await run('compat', out);

    expect(validate.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.stdout).toContain('Result: COMPATIBLE');
    expect(compat.stdout).toContain('Warnings: 0');
  });
});

describe('policy boundaries around preservation', () => {
  it.each([
    ['compatibility', ['compatibility: Requires git'], CONVERSION_CODES.unsupportedTargetSemantic],
    ['allowed-tools', ['allowed-tools: Read'], CONVERSION_CODES.unmappedSourceFrontmatter],
  ])('still refuses %s even though a license would convert', async (_label, lines, code) => {
    const dir = skill('boundary-skill', lines);
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(code);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses license combined with compatibility rather than partially converting', async () => {
    const dir = skill('partial-skill', ['license: MIT', 'compatibility: Requires git']);
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unsupportedTargetSemantic);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses license combined with allowed-tools rather than partially converting', async () => {
    const dir = skill('partial-tools', ['license: MIT', 'allowed-tools: Read']);
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unmappedSourceFrontmatter);
    expect(existsSync(out)).toBe(false);
  });

  it('keeps an over-long description a source-contract violation', async () => {
    const dir = skill('long-description', [], { description: 'd'.repeat(1030) });
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('AGENT_SKILLS_DESCRIPTION_TOO_LONG');
    expect(existsSync(out)).toBe(false);
  });
});

describe('determinism', () => {
  it('produces identical packages in two output locations', async () => {
    const dir = skill('deterministic-skill', [
      'license: Apache-2.0',
      'metadata:',
      '  zebra: z',
      '  alpha: a',
    ]);
    const first = path.join(temporaryRoot(), 'first');
    const second = path.join(temporaryRoot(), 'second');

    await convert(dir, first);
    await convert(dir, second);

    expect(listPackage(second)).toEqual(listPackage(first));
    for (const relative of listPackage(first)) {
      expect(readFileSync(path.join(second, relative))).toEqual(
        readFileSync(path.join(first, relative)),
      );
    }
  });

  it('is unaffected by native metadata key insertion order', async () => {
    const first = skill('order-a', ['license: MIT', 'metadata:', '  alpha: a', '  zebra: z']);
    const second = skill('order-b', ['license: MIT', 'metadata:', '  zebra: z', '  alpha: a']);
    const outA = path.join(temporaryRoot(), 'a');
    const outB = path.join(temporaryRoot(), 'b');

    await convert(first, outA);
    await convert(second, outB);

    const metadataA = generatedFrontmatter(outA)['metadata'];
    const metadataB = generatedFrontmatter(outB)['metadata'];
    expect(Object.keys(metadataA as Record<string, unknown>)).toEqual(
      Object.keys(metadataB as Record<string, unknown>),
    );
    expect(metadataB).toEqual(metadataA);
  });
});
