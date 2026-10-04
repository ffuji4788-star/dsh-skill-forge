/**
 * Rendering helpers shared by the CLI commands.
 *
 * Reports show paths relative to `/` separators so output is identical on
 * Windows and POSIX, and never print an absolute machine path.
 */
import path from 'node:path';

/**
 * Shortens a path for display.
 *
 * @param target Absolute path to display.
 * @param baseDirectory Directory the path is shown relative to.
 * @returns A `/`-separated path relative to `baseDirectory`, or the base name
 *   when the target *is* the base directory.
 */
export function toDisplayPath(target: string, baseDirectory: string): string {
  const relative = path.relative(baseDirectory, target);
  const display = relative.length === 0 ? path.basename(target) : relative;
  return display.split(path.sep).join('/');
}

/**
 * Shortens the path of a skill entry file for display.
 *
 * The entry file always lives at or beside the skill root, so it is shown
 * relative to that root. This keeps report output free of user directory names.
 *
 * @param entryFile Absolute entry file path.
 * @param rootPath Absolute skill root directory.
 */
export function toDisplayEntryFile(entryFile: string, rootPath: string): string {
  return toDisplayPath(entryFile, rootPath);
}

/**
 * Renders a value that a skill may not declare.
 *
 * @param value The value to render.
 * @returns The value, or `(none)` when it is absent.
 */
export function renderValue(value: string | undefined): string {
  return value === undefined ? '(none)' : value;
}
