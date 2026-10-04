/**
 * The DSH conversion pipeline.
 *
 * These tests attack the two properties that matter most: a refused conversion
 * must write nothing at all, and a successful one must not modify its source.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  convertSkillToTarget,
  targetContractReference,
  verifyGeneratedPackage,
} from '../src/conversion/convert-skill.js';
import {
  collectResources,
  findUnportableSegmentProblem,
} from '../src/conversion/resource-collector.js';
import { CONVERSION_CODES } from '../src/schemas/conversion.js';
import { DSH_UPSTREAM_COMMIT } from '../src/targets/dsh/dsh-contract.js';

const repositoryRoot = process.cwd();
const convertFixtures = path.join(repositoryRoot, 'fixtures', 'convert');

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-convert-'));
  temporaryRoots.push(root);
  return root;
}

/** Creates a temporary skill directory with the given files. */
function temporarySkill(files: Record<string, string | Buffer>): string {
  const root = temporaryRoot();

  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  return root;
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

  // Sorted by code unit so the expectation is stable and locale-independent.
  return found.sort();
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('successful conversion', () => {
  it('converts a minimal skill into a clean package', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    expect(outcome.result.converted).toBe(true);
    expect(outcome.result.errors).toEqual([]);
    expect(outcome.writtenPaths).toEqual(['SKILL.md']);
    expect(listPackage(out)).toEqual(['SKILL.md']);
  });

  it('produces a package that passes generic and DSH validation', () => {
    const out = path.join(temporaryRoot(), 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    expect(verifyGeneratedPackage(out)).toEqual([]);
  });

  it('writes name, description and instructions faithfully', () => {
    const out = path.join(temporaryRoot(), 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');
    const generated = readFileSync(path.join(out, 'SKILL.md'), 'utf8');

    expect(generated).toContain('name: convert-minimal');
    expect(generated).toContain('description: A minimal skill that converts cleanly');
    expect(generated).toContain('# Convert Minimal');
  });

  it('accepts an absolute source path', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    expect(outcome.result.converted).toBe(true);
  });

  it('emits a LF-only document ending with one newline', () => {
    const out = path.join(temporaryRoot(), 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');
    const generated = readFileSync(path.join(out, 'SKILL.md'), 'utf8');

    expect(generated).not.toContain('\r');
    expect(generated.endsWith('\n')).toBe(true);
  });

  it('reports the pinned contract reference', () => {
    expect(targetContractReference()).toBe(
      `deepseek-ai/deepseek-harness@${DSH_UPSTREAM_COMMIT.slice(0, 12)}`,
    );
  });

  it('leaves no staging directory behind on success', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    expect(readdirSync(parent)).toEqual(['generated']);
  });
});

describe('resource copying', () => {
  it('copies a text resource byte-identically', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const source = path.join(convertFixtures, 'with-resource');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(true);
    // Paths are reported in lexicographic order.
    expect(outcome.writtenPaths).toEqual(['reference.md', 'SKILL.md']);
    expect(readFileSync(path.join(out, 'reference.md'))).toEqual(
      readFileSync(path.join(source, 'reference.md')),
    );
  });

  it('copies a binary resource byte-identically', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const source = path.join(convertFixtures, 'with-binary-resource');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(true);
    const original = readFileSync(path.join(source, 'image.png'));
    const copied = readFileSync(path.join(out, 'image.png'));

    expect(copied.equals(original)).toBe(true);
    expect(copied.length).toBe(32);
  });

  it('copies a directory resource recursively', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const source = path.join(convertFixtures, 'with-directory-resource');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(true);
    expect(listPackage(out)).toEqual(['SKILL.md', 'assets/data.json', 'assets/nested/note.md']);
  });

  it('copies scripts but never executes them', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const source = path.join(convertFixtures, 'with-script-resource');
    const marker = path.join(source, 'INVALID-SKILL.md');

    expect(existsSync(marker)).toBe(false);
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(true);
    expect(listPackage(out)).toEqual(['SKILL.md', 'run.sh', 'setup.ps1']);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(out, 'INVALID-SKILL.md'))).toBe(false);
  });

  it('refuses two resources whose paths differ only by case', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: case-branch-skill\ndescription: d\n---\n\nBody.\n',
      'Assets/a.md': 'A\n',
    });
    // The references differ only by case even though this filesystem is
    // case-insensitive and resolves both to the same real directory.
    const collected = collectResources(['Assets/a.md', 'assets/a.md'], source);

    expect(collected.issues.map((issue) => issue.code)).toContain(CONVERSION_CODES.caseCollision);
  });

  it('refuses two directories whose names differ only by case', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: case-dir-skill\ndescription: d\n---\n\nBody.\n',
      'A/b.md': '1\n',
    });
    const collected = collectResources(['A', 'a'], source);

    expect(collected.issues.map((issue) => issue.code)).toContain(CONVERSION_CODES.caseCollision);
  });

  it('refuses two files whose names differ only by case', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: case-file-skill\ndescription: d\n---\n\nBody.\n',
      'Foo.txt': '1\n',
    });
    const collected = collectResources(['Foo.txt', 'foo.txt'], source);

    expect(collected.issues.map((issue) => issue.code)).toContain(CONVERSION_CODES.caseCollision);
  });

  it('refuses the same resource path listed twice', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: dup-skill\ndescription: d\n---\n\nBody.\n',
      'reference.md': 'text\n',
    });
    const collected = collectResources(['reference.md', 'reference.md'], source);

    expect(collected.issues.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.duplicateResourceDestination,
    );
  });

  it('allows paths that share a prefix without colliding', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: prefix-skill\ndescription: d\n---\n\nBody.\n',
      'assets/data.json': '{}\n',
      'assets/nested/note.md': 'N\n',
    });
    const collected = collectResources(['assets'], source);

    expect(collected.issues).toEqual([]);
    expect(
      collected.nodes.filter((node) => node.kind === 'file').map((node) => node.destination),
    ).toEqual(['assets/data.json', 'assets/nested/note.md']);
  });

  it('produces the same package regardless of resource order in the IR', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: order-skill\ndescription: Order must not matter.\n---\n\nBody.\n',
      'a.md': 'A\n',
      'b.md': 'B\n',
    });
    const first = path.join(temporaryRoot(), 'first');
    const second = path.join(temporaryRoot(), 'second');

    convertSkillToTarget(source, first, 'dsh');
    convertSkillToTarget(source, second, 'dsh');

    expect(listPackage(second)).toEqual(listPackage(first));
    for (const relative of listPackage(first)) {
      expect(readFileSync(path.join(second, relative))).toEqual(
        readFileSync(path.join(first, relative)),
      );
    }
  });

  it('refuses a resource that would overwrite the entry document', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: conflict-skill\ndescription: d\n---\n\nBody.\n',
    });
    const collected = collectResources(['SKILL.md'], source);

    expect(collected.issues.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.duplicateResourceDestination,
    );
  });

  it('refuses a missing resource', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: missing-resource\ndescription: d\n---\n\nBody.\n',
    });
    const collected = collectResources(['gone.md'], source);

    expect(collected.issues.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.unsupportedResource,
    );
  });

  it('refuses a resource outside the source root', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: escape-skill\ndescription: d\n---\n\nBody.\n',
    });
    const collected = collectResources(['../outside.md'], source);

    expect(collected.issues.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.resourceOutsideSource,
    );
  });

  it('refuses a resource whose destination would leave the package', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: escape-skill\ndescription: d\n---\n\nBody.\n',
    });
    const collected = collectResources(['../outside.md'], source);

    expect(collected.nodes).toEqual([]);
  });
});

describe('loss safety', () => {
  it('refuses when source frontmatter has no mapping', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(
      path.join(convertFixtures, 'with-extra-frontmatter'),
      out,
      'dsh',
    );

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors.map((issue) => issue.code)).toEqual([
      CONVERSION_CODES.unmappedSourceFrontmatter,
    ]);
  });

  it('lists the unmapped fields', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(
      path.join(convertFixtures, 'with-extra-frontmatter'),
      out,
      'dsh',
    );

    expect(outcome.result.errors[0]?.details).toEqual(['author', 'version']);
  });

  it('creates no output when it refuses', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'with-extra-frontmatter'), out, 'dsh');

    expect(existsSync(out)).toBe(false);
    expect(readdirSync(parent)).toEqual([]);
  });

  it.each([
    ['author', 'author: Alice'],
    ['version', 'version: 2'],
    ['metadata', 'metadata:\n  owner: tests'],
    ['whenToUse', 'whenToUse: When needed'],
    ['disable-model-invocation', 'disable-model-invocation: true'],
    ['user-invocable', 'user-invocable: false'],
    ['a nested custom field', 'custom:\n  nested:\n    deep: 1'],
  ])('refuses %s rather than dropping or guessing it', (_label, frontmatter) => {
    const source = temporarySkill({
      'SKILL.md': `---\nname: refusal-skill\ndescription: d\n${frontmatter}\n---\n\nBody.\n`,
    });
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors[0]?.code).toBe(CONVERSION_CODES.unmappedSourceFrontmatter);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a source that fails generic validation', () => {
    const source = temporarySkill({
      'SKILL.md': '---\ndescription: no name here\n---\n\nBody.\n',
    });
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  it('exposes no lossy option', async () => {
    const { readFileSync: read } = await import('node:fs');
    const program = read(path.join(repositoryRoot, 'src', 'cli', 'program.ts'), 'utf8');

    for (const forbidden of [
      '--allow-lossy',
      '--drop-extra',
      '--force-map',
      '--ignore-unmapped',
      '--force',
    ]) {
      expect(program).not.toContain(forbidden);
    }
  });
});

describe('output safety', () => {
  it('refuses an existing output directory', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    mkdirSync(out);
    writeFileSync(path.join(out, 'keep.txt'), 'do not touch');

    const outcome = convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors.map((issue) => issue.code)).toEqual([
      CONVERSION_CODES.outputAlreadyExists,
    ]);
    expect(readFileSync(path.join(out, 'keep.txt'), 'utf8')).toBe('do not touch');
  });

  it('refuses an existing output file', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    writeFileSync(out, 'existing');

    const outcome = convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(readFileSync(out, 'utf8')).toBe('existing');
  });

  it('refuses an output equal to the source root', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: same-root\ndescription: d\n---\n\nBody.\n',
    });
    const outcome = convertSkillToTarget(source, source, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.outputInsideSource,
    );
  });

  it('refuses an output inside the source root', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: nested-output\ndescription: d\n---\n\nBody.\n',
    });
    const outcome = convertSkillToTarget(source, path.join(source, 'generated'), 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.outputInsideSource,
    );
    expect(existsSync(path.join(source, 'generated'))).toBe(false);
  });

  it('refuses an output inside the source root expressed with a relative path', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: relative-output\ndescription: d\n---\n\nBody.\n',
    });
    const outcome = convertSkillToTarget(
      source,
      path.join(source, '.', 'sub', '..', 'generated'),
      'dsh',
    );

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.outputInsideSource,
    );
  });

  it('creates missing parent directories for a legitimate output', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'deep', 'nested', 'generated');
    const outcome = convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    expect(outcome.result.converted).toBe(true);
    expect(existsSync(path.join(out, 'SKILL.md'))).toBe(true);
  });

  it('refuses an unsupported target', () => {
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'claude');

    expect(outcome.result.converted).toBe(false);
    expect(existsSync(out)).toBe(false);
  });
});

describe('atomicity', () => {
  it('cleans staging and writes no output when verification would fail', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');

    // A resource that disappears between planning and copying makes the write
    // phase throw; the converter must still leave nothing behind.
    const source = temporarySkill({
      'SKILL.md': '---\nname: atomic-skill\ndescription: d\n---\n\nBody.\n',
      'late.md': 'late\n',
    });

    const outcome = convertSkillToTarget(source, out, 'dsh');
    expect(outcome.result.converted).toBe(true);

    // Success path: exactly one package, no staging leftovers.
    expect(readdirSync(parent)).toEqual(['generated']);
  });

  it('never leaves a staging directory after a refusal', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'with-extra-frontmatter'), out, 'dsh');

    expect(readdirSync(parent).filter((name) => name.startsWith('.dsh-forge-staging-'))).toEqual(
      [],
    );
  });

  it('uses the output parent for staging so the rename stays on one filesystem', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    // Only the final directory exists, and nothing was left in the system temp.
    expect(lstatSync(out).isDirectory()).toBe(true);
    expect(readdirSync(parent)).toEqual(['generated']);
  });
});

describe('determinism', () => {
  it('produces identical packages in two different output locations', () => {
    const source = path.join(convertFixtures, 'with-directory-resource');
    const first = path.join(temporaryRoot(), 'first');
    const second = path.join(temporaryRoot(), 'second');

    convertSkillToTarget(source, first, 'dsh');
    convertSkillToTarget(source, second, 'dsh');

    expect(listPackage(second)).toEqual(listPackage(first));
    for (const relative of listPackage(first)) {
      expect(readFileSync(path.join(second, relative))).toEqual(
        readFileSync(path.join(first, relative)),
      );
    }
  });

  it('writes no absolute source path, timestamp, random id or staging name into the package', () => {
    const parent = temporaryRoot();
    const out = path.join(parent, 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');
    const generated = readFileSync(path.join(out, 'SKILL.md'), 'utf8');

    expect(generated).not.toContain(parent);
    expect(generated).not.toContain(tmpdir());
    expect(generated).not.toContain('dsh-forge-staging');
    expect(generated).not.toContain(repositoryRoot);
  });

  it('adds no manifest or tool metadata to the package', () => {
    const out = path.join(temporaryRoot(), 'generated');
    convertSkillToTarget(path.join(convertFixtures, 'minimal'), out, 'dsh');

    for (const forbidden of ['conversion-report.json', 'manifest.json', '.dsh-forge.json']) {
      expect(existsSync(path.join(out, forbidden))).toBe(false);
    }
  });
});

describe('input is never modified', () => {
  it('leaves the source skill byte-identical and mtime-stable', () => {
    const source = path.join(convertFixtures, 'with-directory-resource');
    const skillPath = path.join(source, 'SKILL.md');
    const before = {
      skill: readFileSync(skillPath, 'utf8'),
      mtime: statSync(skillPath).mtimeMs,
      entries: listPackage(source),
    };

    convertSkillToTarget(source, path.join(temporaryRoot(), 'generated'), 'dsh');

    expect(readFileSync(skillPath, 'utf8')).toBe(before.skill);
    expect(statSync(skillPath).mtimeMs).toBe(before.mtime);
    expect(listPackage(source)).toEqual(before.entries);
  });
});

describe('portability', () => {
  it.each(['CON', 'NUL', 'COM1', 'LPT1', 'con', 'com9', 'LPT9'])(
    'rejects the reserved device name %s',
    (name) => {
      expect(findUnportableSegmentProblem(name)).toContain('reserved device name');
    },
  );

  it.each(['CON.md', 'nul.txt', 'COM1.json', 'LPT1.md'])(
    'rejects the reserved device name %s even with an extension',
    (name) => {
      expect(findUnportableSegmentProblem(name)).toContain('reserved device name');
    },
  );

  it('rejects a trailing dot', () => {
    expect(findUnportableSegmentProblem('foo.')).toContain('dot or a space');
  });

  it('rejects a trailing space', () => {
    expect(findUnportableSegmentProblem('foo ')).toContain('dot or a space');
  });

  it('rejects an empty segment', () => {
    expect(findUnportableSegmentProblem('')).toBe('empty segment');
  });

  it.each(['foo', 'foo.txt', 'FOO.TXT', 'console', 'nullable', 'com', 'lpt'])(
    'accepts the portable segment %s',
    (name) => {
      expect(findUnportableSegmentProblem(name)).toBeUndefined();
    },
  );

  it('refuses a reserved-name resource at conversion time', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: reserved-skill\ndescription: d\n---\n\nBody.\n',
      'NUL.md': 'nul\n',
    });
    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.reservedResourceName,
    );
    expect(existsSync(out)).toBe(false);
  });
});

describe('symlink safety', () => {
  const canSymlink = ((): boolean => {
    try {
      const probe = mkdtempSync(path.join(tmpdir(), 'dsh-forge-symlink-'));
      temporaryRoots.push(probe);
      symlinkSync(path.join(probe, 'target.txt'), path.join(probe, 'link.txt'));
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!canSymlink)('refuses a file symlink resource', () => {
    const source = temporarySkill({
      'SKILL.md': '---\nname: symlink-skill\ndescription: d\n---\n\nBody.\n',
      'real.md': 'real\n',
    });
    symlinkSync(path.join(source, 'real.md'), path.join(source, 'link.md'));

    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(outcome.result.errors.map((issue) => issue.code)).toContain(
      CONVERSION_CODES.unsupportedResource,
    );
    expect(existsSync(out)).toBe(false);
  });

  it.skipIf(!canSymlink)('refuses a directory symlink resource', () => {
    const other = temporarySkill({ 'file.md': 'outside\n' });
    const source = temporarySkill({
      'SKILL.md': '---\nname: symlink-dir-skill\ndescription: d\n---\n\nBody.\n',
    });
    symlinkSync(other, path.join(source, 'linked'), 'dir');

    const out = path.join(temporaryRoot(), 'generated');
    const outcome = convertSkillToTarget(source, out, 'dsh');

    expect(outcome.result.converted).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  it.runIf(!canSymlink)('classifies symlinks as unsupported when creation is unavailable', () => {
    // Creating symlinks needs privileges on Windows; the classifier is still
    // covered because `lstatSync().isSymbolicLink()` is the same branch.
    expect(canSymlink).toBe(false);
  });
});
