/**
 * The `compat` command: would the pinned DeepSeek Harness implementation accept
 * this skill?
 *
 * Reuses the Phase 1 importer and parser, so reading a skill is implemented
 * once. The check is offline and deterministic: the contract is pinned to one
 * upstream revision at build time, never fetched at run time.
 */
import path from 'node:path';

import { loadLocalSkill } from '../importers/local-importer.js';
import type { CompatibilityResult } from '../schemas/compatibility.js';
import {
  DSH_CONTRACT_SOURCES,
  DSH_CONTRACT_VERIFIED_AT,
  DSH_DISCOVERY_SHAPES,
  DSH_TARGET_NAME,
  DSH_UPSTREAM_REPOSITORY,
  dshUpstreamShortCommit,
} from '../targets/dsh/dsh-contract.js';
import { validateDshCompatibility } from '../targets/dsh/dsh-compatibility-validator.js';
import { renderValue, toDisplayEntryFile } from './render-utils.js';

export interface RenderCompatibilityOptions {
  /** Skill name as declared, or `undefined` when the skill declares none. */
  readonly name: string | undefined;
  /** Absolute path of the skill entry file, shown relative to the skill root. */
  readonly entryFile: string;
  /** Absolute skill root directory. */
  readonly rootPath: string;
}

export interface RunCompatOptions {
  /** Directory used to resolve the input path. Defaults to the process cwd. */
  readonly cwd?: string;
}

/** Repository and commit the report is measured against. */
function contractReference(): string {
  const slug = DSH_UPSTREAM_REPOSITORY.replace('https://github.com/', '');
  return `${slug}@${dshUpstreamShortCommit()}`;
}

/**
 * Renders a compatibility report for people and for tests.
 *
 * @param result Result of the DSH compatibility validator.
 * @param display Values shown in the report header.
 * @returns The report text, with a trailing newline.
 */
export function renderCompatibility(
  result: CompatibilityResult,
  display: RenderCompatibilityOptions,
): string {
  const issues = (list: CompatibilityResult['errors']): string[] =>
    list.map((issue) => `- ${issue.code}: ${issue.message}`);

  const lines = [
    'DSH Compatibility',
    '',
    `Target: ${DSH_TARGET_NAME}`,
    `Contract: ${contractReference()}`,
    `Contract verified: ${DSH_CONTRACT_VERIFIED_AT}`,
    '',
    `Name: ${renderValue(display.name)}`,
    `Entry File: ${toDisplayEntryFile(display.entryFile, display.rootPath)}`,
    '',
    `Result: ${result.status}`,
    `Errors: ${result.errors.length}`,
    `Warnings: ${result.warnings.length}`,
  ];

  if (result.errors.length > 0) {
    lines.push('', 'Errors', ...issues(result.errors));
  }

  if (result.warnings.length > 0) {
    lines.push('', 'Warnings', ...issues(result.warnings));
  }

  lines.push(
    '',
    `Discovery shapes verified: ${DSH_DISCOVERY_SHAPES.join(' or ')}`,
    `Pinned contract sources inspected: ${DSH_CONTRACT_SOURCES.join(', ')}`,
    'The scanned root a skill will be installed into is not known here, so its',
    'installation and discovery location is not verified.',
  );

  return `${lines.join('\n')}\n`;
}

/**
 * Reads a local skill, checks it against the pinned DSH contract and renders the
 * report.
 *
 * @param inputPath File or directory to check.
 * @param options Directory context; defaults to the process working directory.
 * @returns The rendered report and the compatibility result.
 * @throws SkillInputError, AmbiguousSkillError or FrontmatterError for fatal input.
 */
export function runCompat(
  inputPath: string,
  options: RunCompatOptions = {},
): { readonly report: string; readonly result: CompatibilityResult } {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const skill = loadLocalSkill(path.resolve(cwd, inputPath));
  const result = validateDshCompatibility(skill);

  const report = renderCompatibility(result, {
    name: skill.name,
    entryFile: skill.entryFile,
    rootPath: path.dirname(skill.entryFile),
  });

  return { report, result };
}
