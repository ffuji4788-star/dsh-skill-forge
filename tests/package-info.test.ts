import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PACKAGE_JSON_FILENAME,
  describeNodeRequirement,
  findPackageJson,
  parsePackageInfo,
  readPackageInfo,
  resetPackageInfoCache,
} from '../src/utils/package-info.js';

const repositoryRoot = process.cwd();

const validPackageInfo = {
  name: 'example-package',
  version: '1.2.3',
  description: 'An example package.',
};

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(...segments: string[]): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'dsh-skill-forge-test-'));
  temporaryDirectories.push(directory);
  return path.join(directory, ...segments);
}

beforeEach(() => {
  resetPackageInfoCache();
});

afterEach(() => {
  resetPackageInfoCache();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('findPackageJson', () => {
  it('finds this repository package.json from the repository root', () => {
    const found = findPackageJson(repositoryRoot);

    expect(found).toBe(path.join(repositoryRoot, PACKAGE_JSON_FILENAME));
  });

  it('walks up from a nested directory to the nearest package.json', () => {
    const nested = path.join(repositoryRoot, 'src', 'utils');

    expect(findPackageJson(nested)).toBe(path.join(repositoryRoot, PACKAGE_JSON_FILENAME));
  });

  it('does not search above the given boundary directory', () => {
    const boundary = createTemporaryDirectory();
    const nested = path.join(boundary, 'a', 'b');

    expect(findPackageJson(nested, boundary)).toBeUndefined();
  });

  it('still finds a package.json that sits exactly at the boundary', () => {
    const boundary = createTemporaryDirectory();
    writeFileSync(path.join(boundary, PACKAGE_JSON_FILENAME), JSON.stringify(validPackageInfo));

    expect(findPackageJson(boundary, boundary)).toBe(path.join(boundary, PACKAGE_JSON_FILENAME));
  });

  it('honours a boundary that lives on a different drive root', () => {
    // On Windows `path.relative` returns an absolute path across drives, which is
    // not a nesting relationship: the boundary must be refused, not ignored.
    const otherDrive = path.parse(repositoryRoot).root.toLowerCase() === 'c:\\' ? 'D:\\' : 'C:\\';

    expect(findPackageJson(repositoryRoot, otherDrive)).toBeUndefined();
  });
});

describe('parsePackageInfo', () => {
  it('reads name, version and description', () => {
    expect(parsePackageInfo(validPackageInfo)).toEqual(validPackageInfo);
  });

  it.each([
    ['a string document', 'not a package.json'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, input) => {
    expect(() => parsePackageInfo(input)).toThrow(/expected a JSON object/);
  });

  it('rejects an array, which is not a package.json object', () => {
    expect(() => parsePackageInfo([])).toThrow(/expected a JSON object/);
  });

  it.each(['name', 'version', 'description'])('rejects a missing "%s"', (field) => {
    const withoutField: Record<string, unknown> = { ...validPackageInfo };
    delete withoutField[field];

    expect(() => parsePackageInfo(withoutField)).toThrow(
      new RegExp(`"${field}" must be a non-empty string`),
    );
  });

  it.each(['name', 'version', 'description'])('rejects a non-string "%s"', (field) => {
    expect(() => parsePackageInfo({ ...validPackageInfo, [field]: 42 })).toThrow(
      new RegExp(`"${field}" must be a non-empty string`),
    );
  });

  it.each(['name', 'version', 'description'])('rejects an empty "%s"', (field) => {
    expect(() => parsePackageInfo({ ...validPackageInfo, [field]: '' })).toThrow(
      new RegExp(`"${field}" must be a non-empty string`),
    );
  });

  it('names the file it was given in the error message', () => {
    expect(() => parsePackageInfo({}, 'example/package.json')).toThrow(
      /Invalid example\/package\.json/,
    );
  });

  it('reads engines.node as the Node.js requirement', () => {
    expect(parsePackageInfo({ ...validPackageInfo, engines: { node: '>=20.19.0' } })).toEqual({
      ...validPackageInfo,
      nodeRequirement: '>=20.19.0',
    });
  });

  it('reports no Node.js requirement when engines is absent', () => {
    expect(parsePackageInfo(validPackageInfo).nodeRequirement).toBeUndefined();
  });

  it('reports no Node.js requirement when engines.node is absent', () => {
    expect(parsePackageInfo({ ...validPackageInfo, engines: {} }).nodeRequirement).toBeUndefined();
  });

  it('rejects a malformed engines field instead of ignoring it', () => {
    expect(() => parsePackageInfo({ ...validPackageInfo, engines: 'node' })).toThrow(
      /"engines" must be an object/,
    );
  });

  it('rejects a malformed engines.node value instead of ignoring it', () => {
    expect(() => parsePackageInfo({ ...validPackageInfo, engines: { node: 20 } })).toThrow(
      /"engines.node" must be a non-empty string/,
    );
  });
});

describe('describeNodeRequirement', () => {
  it.each([
    ['>=20.19.0', '>=20.19.0'],
    ['^20.19.0', '>=20.19.0'],
    ['~20.19.0', '>=20.19.0'],
    ['>=20.19.0 <21', '>=20.19.0 <21'],
    ['^20.19.0 || >=22', '>=20.19.0'],
    ['>=18', '>=18'],
    ['*', '*'],
    ['', ''],
  ])('describes %s as %s', (range, expected) => {
    expect(describeNodeRequirement(range)).toBe(expected);
  });
});

describe('readPackageInfo', () => {
  it('reads this project package.json and reports a usable version', () => {
    const info = readPackageInfo(repositoryRoot);

    expect(info.name).toBe('dsh-skill-forge');
    expect(info.version).toBe('0.1.0');
    expect(info.description.length).toBeGreaterThan(0);
  });

  it('includes the searched path in the error message', () => {
    const isolatedRoot = createTemporaryDirectory();
    const nested = path.join(isolatedRoot, 'nested');

    expect(() => readPackageInfo(nested, isolatedRoot)).toThrow(path.resolve(nested));
  });

  it('reports invalid JSON instead of silently ignoring it', () => {
    const isolatedRoot = createTemporaryDirectory();
    writeFileSync(path.join(isolatedRoot, PACKAGE_JSON_FILENAME), '{ not json', 'utf8');

    expect(() => readPackageInfo(isolatedRoot, isolatedRoot)).toThrow(/Unable to parse/);
  });

  it('uses the inclusive message when the search range is a single directory', () => {
    const isolatedRoot = createTemporaryDirectory();

    expect(() => readPackageInfo(isolatedRoot, isolatedRoot)).toThrow(/or any parent directory/);
  });

  it('reports the range when the boundary is above the start directory', () => {
    const isolatedRoot = createTemporaryDirectory();
    const nested = path.join(isolatedRoot, 'nested');

    expect(() => readPackageInfo(nested, isolatedRoot)).toThrow(/between .* and /);
  });

  it('reports a package.json that omits required fields', () => {
    const isolatedRoot = createTemporaryDirectory();
    writeFileSync(path.join(isolatedRoot, PACKAGE_JSON_FILENAME), '{"name":"x"}', 'utf8');

    expect(() => readPackageInfo(isolatedRoot, isolatedRoot)).toThrow(
      /"version" must be a non-empty string/,
    );
  });
});
