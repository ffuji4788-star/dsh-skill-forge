/**
 * Filesystem helpers shared by every skill source.
 *
 * The resource walk, path normalization and read helpers live here so that a
 * source adapter reuses one hardened implementation rather than growing its own
 * copy. Every function is read-only: nothing here writes, renames or executes
 * anything found beside a skill.
 *
 * All returned paths are relative to the source root, `/`-separated and sorted,
 * so results do not depend on the host platform or on directory listing order.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';

import { SkillInputError } from '../utils/errors.js';

/** Markdown extensions considered for generic skill entry points. */
export const MARKDOWN_EXTENSIONS: readonly string[] = ['.md', '.markdown'];

/** Directory names never walked while enumerating resources. */
export const SKIPPED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(['node_modules', '.git']);

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Compares two paths deterministically, independently of host locale. */
export function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

/** Reports whether a file name looks like Markdown. */
export function isMarkdownFile(fileName: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

/** Produces a source-root-relative, `/`-separated path. */
export function toRelativePosixPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/**
 * Reports the kind of a filesystem path without following symbolic links.
 *
 * @param resolvedPath Absolute path to inspect.
 * @returns Whether the path is a file or a directory.
 * @throws SkillInputError when the path is missing or unreadable.
 */
export function statOrThrow(resolvedPath: string): { isFile: boolean; isDirectory: boolean } {
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
 * Enumerates the files beside a skill.
 *
 * The walk is bounded by `root`, skips dependency and VCS directories, treats
 * symbolic links as plain entries (they are never followed, so enumeration
 * cannot leave the source root through one), and returns sorted,
 * `/`-separated relative paths.
 *
 * @param root Absolute directory to walk.
 * @throws SkillInputError when a directory cannot be listed.
 */
export function enumerateResources(root: string): string[] {
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
