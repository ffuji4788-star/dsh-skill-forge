/**
 * The `validate` command: deterministically validate a local skill.
 *
 * Reuses the Phase 1 importer and parser: reading a skill is implemented once.
 * Validation is read-only, offline and free of model calls. A skill that parses
 * but breaks a structural rule is a *validation failure* (exit code 2); a skill
 * that cannot be read or parsed at all is a *fatal error* (exit code 1).
 */
import path from 'node:path';

import { loadLocalSkill } from '../importers/local-importer.js';
import type { ValidationResult } from '../schemas/validation.js';
import { validateBasicSkill } from '../validators/basic-skill-validator.js';
import { renderValue, toDisplayEntryFile } from './render-utils.js';

export interface RenderValidationOptions {
  /** Skill name as declared, or `undefined` when the skill declares none. */
  readonly name: string | undefined;
  /** Absolute path of the skill entry file, shown relative to the skill root. */
  readonly entryFile: string;
  /** Absolute skill root directory. */
  readonly rootPath: string;
}

export interface RunValidateOptions {
  /** Directory used to resolve the input path. Defaults to the process cwd. */
  readonly cwd?: string;
}

/**
 * Renders a validation report for people and for tests.
 *
 * @param result Result of the validator.
 * @param display Values shown in the report header.
 * @returns The report text, with a trailing newline.
 */
export function renderValidation(
  result: ValidationResult,
  display: RenderValidationOptions,
): string {
  const lines = [
    'Skill Validation',
    '',
    `Name: ${renderValue(display.name)}`,
    `Entry File: ${toDisplayEntryFile(display.entryFile, display.rootPath)}`,
    '',
    `Result: ${result.valid ? 'PASS' : 'FAIL'}`,
    `Errors: ${result.errors.length}`,
    `Warnings: ${result.warnings.length}`,
  ];

  if (result.errors.length > 0) {
    lines.push('', 'Errors', ...result.errors.map((issue) => `- ${issue.code}: ${issue.message}`));
  }

  if (result.warnings.length > 0) {
    lines.push(
      '',
      'Warnings',
      ...result.warnings.map((issue) => `- ${issue.code}: ${issue.message}`),
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Reads a local skill, validates it and renders the report.
 *
 * @param inputPath File or directory to validate.
 * @param options Directory context; defaults to the process working directory.
 * @returns The rendered report and the validator result.
 * @throws SkillInputError, AmbiguousSkillError or FrontmatterError for fatal input.
 */
export function runValidate(
  inputPath: string,
  options: RunValidateOptions = {},
): { readonly report: string; readonly result: ValidationResult } {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const skill = loadLocalSkill(path.resolve(cwd, inputPath));
  const result = validateBasicSkill(skill);

  const report = renderValidation(result, {
    name: skill.name,
    entryFile: skill.entryFile,
    rootPath: path.dirname(skill.entryFile),
  });

  return { report, result };
}
