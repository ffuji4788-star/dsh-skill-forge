/**
 * Collects the resources a converted package must contain.
 *
 * The IR carries only relative references, so the filesystem is the source of
 * truth here and every path is re-validated at copy time rather than trusted:
 * that is what makes the check a TOCTOU and symlink defence rather than a
 * restatement of Phase 4.
 *
 * Nothing is read into memory except entry contents, nothing is executed, and
 * only regular files and regular directories are accepted.
 */
import { lstatSync, readdirSync, type Stats } from 'node:fs';
import path from 'node:path';

import type { ConversionIssue } from '../schemas/conversion.js';
import { CONVERSION_CODES } from '../schemas/conversion.js';
import { isPathWithin } from '../utils/path-boundary.js';

/** A regular file that must be copied verbatim. */
export interface ResourceFileNode {
  readonly kind: 'file';
  /** Absolute source path. */
  readonly sourcePath: string;
  /** Package-relative destination path, `/`-separated. */
  readonly destination: string;
}

/** A regular directory whose contents must be copied recursively. */
export interface ResourceDirectoryNode {
  readonly kind: 'directory';
  readonly sourcePath: string;
  readonly destination: string;
}

export type ResourceNode = ResourceFileNode | ResourceDirectoryNode;

export interface ResourceCollection {
  readonly nodes: readonly ResourceNode[];
  readonly issues: readonly ConversionIssue[];
}

/** File name reserved by the target package for the entry document. */
const RESERVED_DESTINATION = 'SKILL.md';

/** Windows device names that cannot be used as a path segment. */
const WINDOWS_RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

function error(code: string, message: string): ConversionIssue {
  return { code, severity: 'error', message };
}

/**
 * Reports why a destination segment is not portable to a Windows target.
 *
 * @param segment A single `/`-separated segment.
 * @returns A reason, or `undefined` when the segment is portable.
 */
export function findUnportableSegmentProblem(segment: string): string | undefined {
  if (segment.length === 0) {
    return 'empty segment';
  }
  if (segment.endsWith('.') || segment.endsWith(' ')) {
    return 'segment must not end with a dot or a space';
  }
  const dot = segment.indexOf('.');
  const base = (dot === -1 ? segment : segment.slice(0, dot)).toLowerCase();
  if (WINDOWS_RESERVED_SEGMENTS.has(base)) {
    return `"${segment}" uses a reserved device name`;
  }
  return undefined;
}

/**
 * Tracks claimed destinations for one collection run.
 *
 * Claims are recorded for every path level and compared case-insensitively, so a
 * collision is detected even when two distinct spellings (`Assets/a.md` and
 * `assets/b.md`) would land in the same document on a case-insensitive
 * filesystem. A prefix claim records that the path is a directory, which is how
 * a file/directory conflict is spotted.
 */
class DestinationClaims {
  /** Folded path → whether it is a directory, plus the spelling first seen. */
  private readonly claims = new Map<string, { isDirectory: boolean; spelling: string }>();

  /**
   * Claims a destination.
   *
   * A collision is reported when the same path is claimed twice, when a path
   * claimed as a file is later needed as a directory, or when two spellings fold
   * to the same entry. Ordinary nesting — `assets` containing
   * `assets/data.json` — is not a collision.
   *
   * @param destination `/`-separated package-relative path.
   * @param isDirectory Whether the path names a directory.
   * @returns A refusal issue, or `undefined` when the path is free.
   */
  claim(destination: string, isDirectory: boolean): ConversionIssue | undefined {
    const segments = destination.split('/');
    const leaf = segments[segments.length - 1] ?? '';
    const folded = segments.map((segment) => segment.toLowerCase());

    // 1. Same entry, different spelling: two spellings must not fold together.
    const sameEntry = this.claims.get(folded.join('/'));
    if (sameEntry !== undefined && sameEntry.spelling !== leaf) {
      return error(
        CONVERSION_CODES.caseCollision,
        `Resource destination "${destination}" differs only by case from "${sameEntry.spelling}"`,
      );
    }

    // 2. Every ancestor must be a directory, and must not be a differently
    //    spelled spelling of this path. Nesting under a directory of the same
    //    name is fine.
    for (let index = 1; index < folded.length; index += 1) {
      const ancestor = this.claims.get(folded.slice(0, index).join('/'));
      if (ancestor === undefined) {
        continue;
      }

      if (!ancestor.isDirectory) {
        return error(
          CONVERSION_CODES.duplicateResourceDestination,
          `Resource destination "${destination}" needs "${ancestor.spelling}" to be a directory, but it is a file`,
        );
      }

      if (ancestor.spelling !== (segments[index - 1] ?? '')) {
        return error(
          CONVERSION_CODES.caseCollision,
          `Resource destination "${destination}" differs only by case from "${ancestor.spelling}"`,
        );
      }
    }

    // 3. The very same path must not be used twice.
    if (this.claims.has(destination)) {
      return error(
        CONVERSION_CODES.duplicateResourceDestination,
        `Resource destination "${destination}" is already used by another entry`,
      );
    }

    for (let index = 1; index <= folded.length; index += 1) {
      this.claims.set(folded.slice(0, index).join('/'), {
        isDirectory: index < folded.length ? true : isDirectory,
        spelling: segments[index - 1] ?? '',
      });
    }

    return undefined;
  }
}

function classify(absolutePath: string): {
  kind: 'file' | 'directory' | 'unsupported';
  stats: Stats | undefined;
} {
  let stats: Stats;
  try {
    stats = lstatSync(absolutePath);
  } catch {
    return { kind: 'unsupported', stats: undefined };
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'unsupported', stats };
  }
  if (stats.isFile()) {
    return { kind: 'file', stats };
  }
  if (stats.isDirectory()) {
    return { kind: 'directory', stats };
  }
  return { kind: 'unsupported', stats };
}

function collectDirectory(
  sourcePath: string,
  destination: string,
  claims: DestinationClaims,
  nodes: ResourceNode[],
  issues: ConversionIssue[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(sourcePath).sort((left, right) => left.localeCompare(right, 'en'));
  } catch {
    issues.push(
      error(
        CONVERSION_CODES.unsupportedResource,
        `Unable to read resource directory ${destination}`,
      ),
    );
    return;
  }

  for (const entry of entries) {
    const childSource = path.join(sourcePath, entry);
    const childDestination = `${destination}/${entry}`;

    const portability = findUnportableSegmentProblem(entry);
    if (portability !== undefined) {
      issues.push(
        error(
          CONVERSION_CODES.reservedResourceName,
          `Resource "${childDestination}" is not portable: ${portability}`,
        ),
      );
      continue;
    }

    const classified = classify(childSource);
    if (classified.kind === 'file') {
      const collision = claims.claim(childDestination, false);
      if (collision !== undefined) {
        issues.push(collision);
        continue;
      }
      nodes.push({ kind: 'file', sourcePath: childSource, destination: childDestination });
    } else if (classified.kind === 'directory') {
      const collision = claims.claim(childDestination, true);
      if (collision !== undefined) {
        issues.push(collision);
        continue;
      }
      nodes.push({ kind: 'directory', sourcePath: childSource, destination: childDestination });
      collectDirectory(childSource, childDestination, claims, nodes, issues);
    } else {
      issues.push(
        error(
          CONVERSION_CODES.unsupportedResource,
          `Resource "${childDestination}" is a symbolic link or a special file, which is not converted`,
        ),
      );
    }
  }
}

/**
 * Resolves the resources referenced by the IR against the source skill root.
 *
 * @param resources IR resource references (already root-relative).
 * @param sourceRoot Absolute source skill root directory.
 * @returns Copy plan nodes plus any refusal issues.
 */
export function collectResources(
  resources: readonly string[],
  sourceRoot: string,
): ResourceCollection {
  const nodes: ResourceNode[] = [];
  const issues: ConversionIssue[] = [];
  const claims = new DestinationClaims();

  for (const resource of resources) {
    const absolute = path.resolve(sourceRoot, resource);

    // Re-check at filesystem time: the IR is not trusted for containment.
    if (!isPathWithin(sourceRoot, absolute) || absolute === path.resolve(sourceRoot)) {
      issues.push(
        error(
          CONVERSION_CODES.resourceOutsideSource,
          `Resource "${resource}" resolves outside the source skill root`,
        ),
      );
      continue;
    }

    const classified = classify(absolute);
    if (classified.kind === 'unsupported') {
      const reason =
        classified.stats === undefined
          ? 'it cannot be read'
          : classified.stats.isSymbolicLink()
            ? 'symbolic links are not followed'
            : 'only regular files and directories are converted';
      issues.push(
        error(
          CONVERSION_CODES.unsupportedResource,
          `Resource "${resource}" is not supported: ${reason}`,
        ),
      );
      continue;
    }

    if (resource === RESERVED_DESTINATION) {
      issues.push(
        error(
          CONVERSION_CODES.duplicateResourceDestination,
          `Resource "${resource}" would overwrite the generated entry document`,
        ),
      );
      continue;
    }

    const collision = claims.claim(resource, classified.kind === 'directory');
    if (collision !== undefined) {
      issues.push(collision);
      continue;
    }

    nodes.push({ kind: classified.kind, sourcePath: absolute, destination: resource });
    if (classified.kind === 'directory') {
      collectDirectory(absolute, resource, claims, nodes, issues);
    }
  }

  const unportable = new Set<string>();
  for (const node of nodes) {
    for (const segment of node.destination.split('/')) {
      if (findUnportableSegmentProblem(segment) !== undefined) {
        unportable.add(segment);
      }
    }
  }

  for (const segment of unportable) {
    issues.push(
      error(
        CONVERSION_CODES.reservedResourceName,
        `Resource path segment "${segment}" is not portable to a Windows target`,
      ),
    );
  }

  return { nodes, issues };
}
