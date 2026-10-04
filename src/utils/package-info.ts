/**
 * Reads this package's own metadata.
 *
 * The real `package.json` is the single source of truth for the CLI version and
 * for the Node.js requirement the CLI prints, so neither can drift from the
 * published package. Reading them at runtime avoids generated files and
 * build-time string substitution.
 *
 * The file is located by walking up from a starting directory (the current
 * working directory by default). Resolving it relative to this module's own
 * location is deliberately avoided: `import.meta.dirname` is rewritten by
 * bundlers and test runners, which made the path point outside the repository.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { formatErrorMessage } from './error-message.js';
import { isAtOrBelow } from './path-boundary.js';

/** The subset of `package.json` fields this project relies on. */
export interface PackageInfo {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /** The `engines.node` range, when the package declares one. */
  readonly nodeRequirement: string | undefined;
}

/** File name searched for while walking up the directory tree. */
export const PACKAGE_JSON_FILENAME = 'package.json';

let cachedPackageInfo: PackageInfo | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  // Arrays and null are typeof 'object' but are not package.json objects.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(raw: Record<string, unknown>, field: string, file: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${file}: "${field}" must be a non-empty string.`);
  }
  return value;
}

/** Reads the optional `engines.node` range, returning `undefined` when absent. */
function readNodeRequirement(raw: Record<string, unknown>, file: string): string | undefined {
  const engines = raw['engines'];
  if (engines === undefined) {
    return undefined;
  }
  if (!isRecord(engines)) {
    throw new Error(`Invalid ${file}: "engines" must be an object when present.`);
  }

  const node = engines['node'];
  if (node === undefined) {
    return undefined;
  }
  if (typeof node !== 'string' || node.length === 0) {
    throw new Error(`Invalid ${file}: "engines.node" must be a non-empty string when present.`);
  }
  return node;
}

/**
 * Rewrites a simple `engines.node` range into a human-readable requirement.
 *
 * Handles the shapes a package like this actually uses (`>=20.19.0`,
 * `^20.19.0`, `>=20.19.0 <21`, alternatives separated by `||`). It is
 * deliberately not a semver implementation: when a range cannot be simplified it
 * is returned unchanged rather than reported incorrectly.
 *
 * @param range The `engines.node` value.
 * @returns A readable requirement such as `>= 20.19.0`.
 */
export function describeNodeRequirement(range: string): string {
  const alternative = range.split('||')[0];
  if (alternative === undefined) {
    return range;
  }

  const described = alternative
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((comparator) => comparator.replace(/^\^/, '>=').replace(/^~/, '>='))
    .join(' ');

  return described.length > 0 ? described : range;
}

/**
 * Parses the fields of a `package.json` document.
 *
 * @param raw Parsed JSON document of unknown shape.
 * @param file Path reported in error messages. Defaults to `package.json`.
 * @returns The validated {@link PackageInfo}.
 * @throws Error when `name`, `version` or `description` is missing or not a
 *   non-empty string, or when a present `engines` field is malformed.
 */
export function parsePackageInfo(raw: unknown, file = PACKAGE_JSON_FILENAME): PackageInfo {
  if (!isRecord(raw)) {
    throw new Error(`Invalid ${file}: expected a JSON object.`);
  }

  return {
    name: requireString(raw, 'name', file),
    version: requireString(raw, 'version', file),
    description: requireString(raw, 'description', file),
    nodeRequirement: readNodeRequirement(raw, file),
  };
}

/**
 * Finds the nearest `package.json` at or above `startDirectory`, without
 * searching above `stopDirectory`.
 *
 * The boundary keeps a search from wandering to the filesystem root, which would
 * make the result depend on unrelated files elsewhere on the machine.
 *
 * @param startDirectory Directory to start from. Defaults to the current working directory.
 * @param stopDirectory Directory that must contain the file at the latest.
 *   Defaults to the filesystem root, i.e. an unbounded search.
 * @returns The absolute path, or `undefined` when no `package.json` exists between
 *   `startDirectory` and `stopDirectory`.
 */
export function findPackageJson(
  startDirectory: string = process.cwd(),
  stopDirectory: string = path.parse(path.resolve(startDirectory)).root,
): string | undefined {
  const stop = path.resolve(stopDirectory);
  let current = path.resolve(startDirectory);

  for (;;) {
    if (!isAtOrBelow(stop, current)) {
      return undefined;
    }

    const candidate = path.join(current, PACKAGE_JSON_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    if (path.relative(stop, current) === '') {
      return undefined;
    }

    current = path.dirname(current);
  }
}

function describeSearchRange(startDirectory: string, stopDirectory: string | undefined): string {
  const searchedFrom = path.resolve(startDirectory);
  if (stopDirectory === undefined) {
    return `in ${searchedFrom} or any parent directory`;
  }

  const searchedTo = path.resolve(stopDirectory);
  if (searchedTo === searchedFrom) {
    return `in ${searchedFrom} or any parent directory`;
  }

  return `between ${searchedFrom} and ${searchedTo}`;
}

/**
 * Reads and validates this package's `package.json`.
 *
 * The default lookup is cached, because a package's own metadata cannot change
 * while it runs; a caller-provided `startDirectory` is always answered from the
 * filesystem. Use {@link resetPackageInfoCache} in tests that need a fresh read.
 *
 * @param startDirectory Directory to start the upward search from.
 * @param stopDirectory Directory that must contain the file at the latest.
 * @throws Error when no `package.json` is found, cannot be read, or is invalid.
 */
export function readPackageInfo(
  startDirectory: string = process.cwd(),
  stopDirectory?: string,
): PackageInfo {
  const cacheable = startDirectory === process.cwd() && stopDirectory === undefined;
  if (cacheable && cachedPackageInfo !== undefined) {
    return cachedPackageInfo;
  }

  const file =
    stopDirectory === undefined
      ? findPackageJson(startDirectory)
      : findPackageJson(startDirectory, stopDirectory);

  if (file === undefined) {
    throw new Error(
      `Unable to find ${PACKAGE_JSON_FILENAME} ${describeSearchRange(startDirectory, stopDirectory)}.`,
    );
  }

  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${file}: ${formatErrorMessage(error)}`, { cause: error });
  }

  let document: unknown;
  try {
    document = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Unable to parse ${file}: ${formatErrorMessage(error)}`, { cause: error });
  }

  const info = parsePackageInfo(document, file);
  if (cacheable) {
    cachedPackageInfo = info;
  }
  return info;
}

/** Clears the {@link readPackageInfo} cache. Intended for tests. */
export function resetPackageInfoCache(): void {
  cachedPackageInfo = undefined;
}
