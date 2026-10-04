/**
 * Reads a local skill from disk.
 *
 * The importer only inspects and reads. It never executes anything found next to
 * a skill: `.sh`, `.ps1`, `.py`, `.exe`, `.bat`, npm lifecycle scripts and
 * binaries are enumerated as resources and nothing more. Every third-party skill
 * is untrusted input.
 *
 * All paths are built with `node:path`, and every path reported to a caller is
 * relative to the resolved source root with `/` separators, so output and tests
 * behave the same on Windows and POSIX.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from '../parsers/frontmatter-parser.js';
import { buildParsedSkill, type ParsedSkill } from '../schemas/skill.js';
import { AmbiguousSkillError, SkillInputError } from '../utils/errors.js';

/** How the skill source was supplied. */
export type SourceType = 'file' | 'directory';

/** Entry file name that takes precedence inside a directory. */
export const SKILL_ENTRY_FILENAME = 'SKILL.md';

/** Markdown extensions considered for skill entry points. */
const MARKDOWN_EXTENSIONS: readonly string[] = ['.md', '.markdown'];

/** Directory names never walked while enumerating resources. */
const SKIPPED_DIRECTORY_NAMES = new Set<string>(['node_modules', '.git']);

/** A local skill source, ready to be parsed. */
export interface SourcePackage {
  readonly sourceType: SourceType;
  /** Absolute, resolved path of the file or directory that was supplied. */
  readonly rootPath: string;
  /** Absolute, resolved path of the skill entry file. */
  readonly entryFile: string;
  /** Files beside the skill, relative to `rootPath`, `/`-separated, sorted. */
  readonly files: readonly string[];
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function isMarkdownFile(fileName: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

/**
 * Resolves an input path to an absolute path.
 *
 * Relative paths resolve against the current working directory, which is what a
 * command-line user expects from a path argument. No other interpretation is
 * applied, so a path is never silently rewritten into a different location.
 */
export function resolveInputPath(inputPath: string): string {
  return path.resolve(inputPath);
}

function statOrThrow(resolvedPath: string): { isFile: boolean; isDirectory: boolean } {
  try {
    const stats = statSync(resolvedPath);
    return { isFile: stats.isFile(), isDirectory: stats.isDirectory() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new SkillInputError(`Path does not exist: ${resolvedPath}`, { cause: error });
    }
    throw new SkillInputError(`Unable to read path ${resolvedPath}: ${describeCause(error)}`, {
      cause: error,
    });
  }
}

/**
 * Determines the skill entry file inside a directory.
 *
 * `SKILL.md` wins when present, including when it is spelled with different
 * casing, which is common on Windows. Otherwise a single top-level Markdown file
 * is accepted. More than one candidate is an error: guessing which Markdown file
 * is the skill would analyze the wrong content.
 *
 * Only the top level is considered; Phase 1 does not discover skills recursively.
 *
 * @param directory Absolute directory to inspect.
 * @returns Absolute entry file path.
 * @throws SkillInputError when the directory holds no candidate.
 * @throws AmbiguousSkillError when it holds more than one.
 */
export function findEntryFile(directory: string): string {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    throw new SkillInputError(`Unable to list directory ${directory}: ${describeCause(error)}`, {
      cause: error,
    });
  }

  const markdownCandidates = entries.filter(isMarkdownFile).sort(comparePaths);

  const preferred = markdownCandidates.find(
    (entry) => entry.toLowerCase() === SKILL_ENTRY_FILENAME.toLowerCase(),
  );
  if (preferred !== undefined) {
    return path.join(directory, preferred);
  }

  const [only, ...rest] = markdownCandidates;
  if (only === undefined) {
    throw new SkillInputError(
      `No skill entry found in ${directory}: expected ${SKILL_ENTRY_FILENAME} or a single top-level Markdown file.`,
    );
  }
  if (rest.length > 0) {
    throw new AmbiguousSkillError(
      `Ambiguous skill entry in ${directory}: found ${markdownCandidates.length} Markdown files ` +
        `(${markdownCandidates.join(', ')}) and no ${SKILL_ENTRY_FILENAME}. Keep one top-level ` +
        `Markdown entry point, or add ${SKILL_ENTRY_FILENAME} to name it explicitly.`,
    );
  }

  return path.join(directory, only);
}

function toRelativePosixPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/**
 * Enumerates the files beside a skill.
 *
 * The walk is bounded by `root`, skips dependency and VCS directories, treats
 * symbolic links as plain entries (they are never followed, so enumeration
 * cannot leave the source root through one), and returns sorted,
 * `/`-separated relative paths.
 */
function enumerateResources(root: string): string[] {
  const pending: string[] = [root];
  const resources: string[] = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      throw new SkillInputError(`Unable to list directory ${current}: ${describeCause(error)}`, {
        cause: error,
      });
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          pending.push(absolutePath);
        }
        continue;
      }

      resources.push(toRelativePosixPath(root, absolutePath));
    }
  }

  return resources.sort(comparePaths);
}

/**
 * Reads a local skill source.
 *
 * @param inputPath File or directory to read. Relative paths resolve against the
 *   current working directory.
 * @returns The {@link SourcePackage} describing the skill and its resources.
 * @throws SkillInputError when the path is missing, is neither a file nor a
 *   directory, or holds no skill entry.
 * @throws AmbiguousSkillError when a directory holds several possible entries.
 */
export function readLocalSkill(inputPath: string): SourcePackage {
  if (inputPath.length === 0) {
    throw new SkillInputError('No skill path was provided.');
  }

  const resolved = resolveInputPath(inputPath);
  const stats = statOrThrow(resolved);

  if (stats.isFile) {
    const rootPath = path.dirname(resolved);
    return {
      sourceType: 'file',
      rootPath,
      entryFile: resolved,
      files: enumerateResources(rootPath),
    };
  }

  if (stats.isDirectory) {
    const entryFile = findEntryFile(resolved);
    return {
      sourceType: 'directory',
      rootPath: resolved,
      entryFile,
      files: enumerateResources(resolved),
    };
  }

  throw new SkillInputError(
    `Unsupported path type: ${resolved} is neither a regular file nor a directory.`,
  );
}

/**
 * Reads a UTF-8 text file.
 *
 * @param filePath Absolute path to read.
 * @throws SkillInputError when the file cannot be read.
 */
export function readSkillFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new SkillInputError(`Unable to read ${filePath}: ${describeCause(error)}`, {
      cause: error,
    });
  }
}

/**
 * Reads and parses a local skill.
 *
 * The entry file is excluded from `resources`, so the two never overlap.
 *
 * @param inputPath File or directory to read.
 * @returns The parsed skill.
 * @throws SkillInputError, AmbiguousSkillError or FrontmatterError.
 */
export function loadLocalSkill(inputPath: string): ParsedSkill {
  const source = readLocalSkill(inputPath);
  const entryFileName = toRelativePosixPath(source.rootPath, source.entryFile);
  const { frontmatter, body } = parseFrontmatter(readSkillFile(source.entryFile));

  return buildParsedSkill({
    frontmatter,
    body,
    entryFile: source.entryFile,
    sourceType: source.sourceType,
    resources: source.files.filter((file) => file !== entryFileName),
  });
}
