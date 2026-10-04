/**
 * Local importer behaviour: path handling, entry discovery and resource
 * enumeration. Files are read and listed, never executed.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findEntryFile,
  readLocalSkill,
  resolveInputPath,
  SKILL_ENTRY_FILENAME,
} from '../src/importers/local-importer.js';
import { AmbiguousSkillError, SkillInputError } from '../src/utils/errors.js';

const repositoryRoot = process.cwd();
const fixturesRoot = path.join(repositoryRoot, 'fixtures');

const validSkillDirectory = path.join(fixturesRoot, 'valid-skill');
const validSkillEntry = path.join(validSkillDirectory, SKILL_ENTRY_FILENAME);

describe('readLocalSkill with a directory', () => {
  it('prefers SKILL.md as the entry file', () => {
    const source = readLocalSkill(validSkillDirectory);

    expect(source.sourceType).toBe('directory');
    expect(source.rootPath).toBe(validSkillDirectory);
    expect(source.entryFile).toBe(validSkillEntry);
  });

  it('enumerates resources relative to the root, sorted, with POSIX separators', () => {
    const source = readLocalSkill(validSkillDirectory);

    // Sorted by code-unit order, so lowercase entries precede 'SKILL.md'.
    expect(source.files).toEqual(['extra/config.json', 'reference.md', 'SKILL.md']);
    expect(source.files.every((file) => !file.includes('\\'))).toBe(true);
    expect(source.files.every((file) => !path.isAbsolute(file))).toBe(true);
  });

  it('uses the single top-level Markdown file when SKILL.md is absent', () => {
    const source = readLocalSkill(path.join(fixturesRoot, 'markdown-entry'));

    expect(path.basename(source.entryFile)).toBe('guide.md');
    expect(source.files).toEqual(['config.json', 'guide.md']);
  });

  it('accepts the entry file path itself', () => {
    const fromDirectory = readLocalSkill(validSkillDirectory);
    const fromFile = readLocalSkill(validSkillEntry);

    expect(fromFile.entryFile).toBe(fromDirectory.entryFile);
    expect(fromFile.files).toEqual(fromDirectory.files);
  });

  it('accepts a path that navigates with ..', () => {
    const viaParent = readLocalSkill(path.join(fixturesRoot, 'valid-skill', '..', 'valid-skill'));

    expect(viaParent.entryFile).toBe(validSkillEntry);
  });

  it('accepts a path that uses forward slashes on every platform', () => {
    const posixStyle = `${fixturesRoot.split(path.sep).join('/')}/valid-skill`;

    expect(readLocalSkill(posixStyle).entryFile).toBe(validSkillEntry);
  });

  it('reports an absolute, resolved root path', () => {
    const source = readLocalSkill(path.relative(repositoryRoot, validSkillDirectory));

    expect(path.isAbsolute(source.rootPath)).toBe(true);
    expect(source.rootPath).toBe(validSkillDirectory);
  });
});

describe('findEntryFile', () => {
  it('returns the absolute entry path for a directory with SKILL.md', () => {
    expect(findEntryFile(validSkillDirectory)).toBe(validSkillEntry);
  });

  it('ignores Markdown files in nested directories', () => {
    // `ambiguous-markdown/nested/` holds extra Markdown, but discovery is
    // top-level only, so the two top-level files are the only candidates.
    expect(() => findEntryFile(path.join(fixturesRoot, 'ambiguous-markdown'))).toThrow(
      AmbiguousSkillError,
    );
  });
});

describe('readLocalSkill failure modes', () => {
  it('reports a path that does not exist', () => {
    const missing = path.join(fixturesRoot, 'definitely-not-here');

    expect(() => readLocalSkill(missing)).toThrow(SkillInputError);
    expect(() => readLocalSkill(missing)).toThrow(/Path does not exist/);
  });

  it('reports an empty path instead of resolving it to the working directory', () => {
    expect(() => readLocalSkill('')).toThrow(/No skill path was provided/);
  });

  it('refuses to guess between several top-level Markdown files', () => {
    const ambiguous = path.join(fixturesRoot, 'ambiguous-markdown');

    expect(() => readLocalSkill(ambiguous)).toThrow(AmbiguousSkillError);
    expect(() => readLocalSkill(ambiguous)).toThrow(/Ambiguous skill entry/);
    expect(() => readLocalSkill(ambiguous)).toThrow(/alpha\.md/);
    expect(() => readLocalSkill(ambiguous)).toThrow(/beta\.md/);
  });

  it('reports a directory with no Markdown candidate', () => {
    const scriptsOnly = path.join(fixturesRoot, 'script-resources', 'scripts');

    expect(() => readLocalSkill(scriptsOnly)).toThrow(/No skill entry found/);
  });

  it('does not treat a code file as a skill entry', () => {
    const scriptsOnly = path.join(fixturesRoot, 'script-resources', 'scripts');

    expect(() => readLocalSkill(scriptsOnly)).toThrow(SkillInputError);
  });
});

describe('resolveInputPath', () => {
  it('resolves a relative path against the current working directory', () => {
    expect(resolveInputPath('fixtures/valid-skill')).toBe(validSkillDirectory);
  });

  it('leaves an absolute path absolute', () => {
    expect(resolveInputPath(validSkillEntry)).toBe(validSkillEntry);
  });

  it('normalizes . and .. segments to a real location', () => {
    expect(resolveInputPath('fixtures/./valid-skill/../valid-skill')).toBe(validSkillDirectory);
  });
});
