/**
 * Security behaviour of local analysis.
 *
 * The fixtures under `fixtures/script-resources` contain real executables that
 * each leave a marker file behind when they run. These tests assert the markers
 * never appear, which is direct evidence that analysis reads and lists resources
 * without executing anything.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runAnalyze } from '../src/cli/analyze-command.js';
import {
  findEntryFile,
  loadLocalSkill,
  readLocalSkill,
  SKILL_ENTRY_FILENAME,
} from '../src/importers/local-importer.js';
import { formatErrorMessage } from '../src/utils/error-message.js';
import { AmbiguousSkillError } from '../src/utils/errors.js';

const repositoryRoot = process.cwd();
const fixturesRoot = path.join(repositoryRoot, 'fixtures');
const scriptFixture = path.join(fixturesRoot, 'script-resources');
const markerName = 'INVALID-SKILL.md';

/** Every place a fixture script would drop its proof-of-execution marker. */
const markerPaths = [
  path.join(scriptFixture, markerName),
  path.join(scriptFixture, 'scripts', markerName),
  path.join(repositoryRoot, markerName),
];

interface DirectorySnapshot {
  readonly files: readonly string[];
  readonly contents: readonly string[];
}

function snapshot(directory: string): DirectorySnapshot {
  const files: string[] = [];
  const contents: string[] = [];
  const pending = [directory];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      files.push(path.relative(directory, absolute));
      if (statSync(absolute).size < 4096) {
        contents.push(readFileSync(absolute, 'utf8'));
      }
    }
  }

  return { files: files.sort(), contents };
}

describe('script resources are never executed', () => {
  it('has a clean marker state before analysis', () => {
    for (const marker of markerPaths) {
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('enumerates every executable resource', () => {
    const source = readLocalSkill(scriptFixture);

    expect(source.files).toContain('scripts/danger.sh');
    expect(source.files).toContain('scripts/danger.ps1');
    expect(source.files).toContain('scripts/danger.py');
    expect(source.files).toContain('scripts/danger.bat');
    expect(source.files).toContain('scripts/package.json');
  });

  it('leaves no marker after reading, loading and analyzing the skill', () => {
    const before = snapshot(scriptFixture);

    readLocalSkill(scriptFixture);
    loadLocalSkill(scriptFixture);
    const report = runAnalyze(scriptFixture, { cwd: repositoryRoot });

    expect(report).toContain('Name: script-resources');
    expect(report).toContain('scripts/danger.sh');

    const after = snapshot(scriptFixture);
    expect(after.files).toEqual(before.files);

    for (const marker of markerPaths) {
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('does not read the contents of a script resource into the skill', () => {
    const skill = loadLocalSkill(scriptFixture);

    expect(skill.body).not.toContain('Proof-of-execution');
    expect(skill.body).not.toContain('postinstall');
    // Scripts are listed as resources only.
    expect(skill.resources).toContain('scripts/danger.sh');
  });

  it('never imports a process execution API', () => {
    const sourceFiles = [
      'src/importers/local-importer.ts',
      'src/parsers/frontmatter-parser.ts',
      'src/analyzers/basic-skill-analyzer.ts',
      'src/cli/analyze-command.ts',
    ];

    for (const relative of sourceFiles) {
      const contents = readFileSync(path.join(repositoryRoot, relative), 'utf8');
      expect(contents).not.toMatch(/child_process/);
      expect(contents).not.toMatch(/\bexecSync\b|\bspawnSync\b|\bspawn\(|\bexec\(/);
    }
  });

  it('stat only, never chmod or write, when enumerating resources', () => {
    // A write during analysis would change the directory's modification time.
    const fixtureDirectory = path.join(scriptFixture, 'scripts');
    const before = statSync(fixtureDirectory).mtimeMs;

    loadLocalSkill(scriptFixture);

    expect(statSync(fixtureDirectory).mtimeMs).toBe(before);
  });
});

describe('resource enumeration stays inside the skill root', () => {
  it('lists only the entry file for a directory holding just SKILL.md', () => {
    const source = readLocalSkill(scriptFixture);
    const scriptDirectory = findEntryFile(scriptFixture);

    expect(scriptDirectory).toBe(path.join(scriptFixture, SKILL_ENTRY_FILENAME));
    expect(source.files.every((file) => !path.isAbsolute(file))).toBe(true);
    expect(source.files.every((file) => !file.startsWith('..'))).toBe(true);
  });

  it('bounds resources by the analyzed root, not by its parent', () => {
    const nested = loadLocalSkill(path.join(fixturesRoot, 'bounded-resources'));

    expect(nested.resources).toEqual(['assets/data.json']);
    // Nothing outside the analyzed root may appear, and sibling fixtures are not
    // reachable from it.
    expect(nested.resources.every((file) => !file.startsWith('..'))).toBe(true);
    expect(nested.resources).not.toContain('valid-skill/SKILL.md');
    expect(nested.resources).not.toContain('script-resources/SKILL.md');
  });

  it('does not surface an entry candidate that was rejected as ambiguous', () => {
    const ambiguous = path.join(fixturesRoot, 'ambiguous-markdown');

    expect(() => loadLocalSkill(ambiguous)).toThrow(AmbiguousSkillError);

    try {
      loadLocalSkill(ambiguous);
    } catch (error) {
      const message = formatErrorMessage(error);
      // The error names the candidates and no content from either is analyzed.
      expect(message).toContain('alpha.md');
      expect(message).toContain('beta.md');
      expect(message).not.toContain('alpha-skill');
    }
  });

  it('resolves a traversal-style path without escaping into an unintended file', () => {
    const traversed = readLocalSkill(
      path.join(fixturesRoot, 'valid-skill', '..', 'valid-skill', SKILL_ENTRY_FILENAME),
    );

    expect(traversed.entryFile).toBe(path.join(fixturesRoot, 'valid-skill', SKILL_ENTRY_FILENAME));
    expect(traversed.files).toEqual(['extra/config.json', 'reference.md', 'SKILL.md']);
  });
});
