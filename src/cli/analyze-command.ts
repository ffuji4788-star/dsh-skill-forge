/**
 * The `analyze` command: read a local skill and report what it contains.
 *
 * Reads and reads only. Nothing found beside a skill is executed.
 */
import path from 'node:path';

import { analyzeBasicSkill, type SkillAnalysis } from '../analyzers/basic-skill-analyzer.js';
import { loadLocalSkill } from '../importers/local-importer.js';
import { renderValue, toDisplayEntryFile } from './render-utils.js';

export interface RenderAnalysisOptions {
  /** Absolute skill root directory that the entry file is displayed relative to. */
  readonly rootPath: string;
}

export interface RunAnalyzeOptions {
  /** Directory used to resolve the input path. Defaults to the process cwd. */
  readonly cwd?: string;
}

function renderCheck(label: string, passed: boolean, message?: string): string {
  const status = passed ? 'PASS' : 'FAIL';
  return message === undefined ? `${label}: ${status}` : `${label}: ${status} (${message})`;
}

/**
 * Renders an analysis report for people and for tests.
 *
 * Resource paths are already relative to the skill root; the entry file is
 * shortened the same way so no absolute machine path appears in the output.
 *
 * @param analysis Result of {@link analyzeBasicSkill}.
 * @param options Display options.
 * @returns The report text, with a trailing newline.
 */
export function renderAnalysis(analysis: SkillAnalysis, options: RenderAnalysisOptions): string {
  const lines = [
    'Skill Analysis',
    '',
    `Name: ${renderValue(analysis.name)}`,
    `Description: ${renderValue(analysis.description)}`,
    `Entry File: ${toDisplayEntryFile(analysis.entryFile, options.rootPath)}`,
    `Resources: ${analysis.resourceCount}`,
    `Body Length: ${analysis.bodyLength}`,
    `Frontmatter Keys: ${
      analysis.frontmatterKeys.length > 0 ? analysis.frontmatterKeys.join(', ') : '(none)'
    }`,
    '',
    'Basic Checks:',
    renderCheck('  Name', analysis.checks.name.passed, analysis.checks.name.message),
    renderCheck(
      '  Description',
      analysis.checks.description.passed,
      analysis.checks.description.message,
    ),
    renderCheck(
      '  Kebab Case',
      analysis.checks.kebabCase.passed,
      analysis.checks.kebabCase.message,
    ),
  ];

  if (analysis.resources.length > 0) {
    lines.push('', 'Resource Files:');
    for (const resource of analysis.resources) {
      lines.push(`  ${resource}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Reads a local skill, analyzes it and renders the report.
 *
 * @param inputPath File or directory to analyze.
 * @param options Directory context; defaults to the process working directory.
 * @throws SkillInputError, AmbiguousSkillError or FrontmatterError.
 */
export function runAnalyze(inputPath: string, options: RunAnalyzeOptions = {}): string {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const skill = loadLocalSkill(path.resolve(cwd, inputPath));

  return renderAnalysis(analyzeBasicSkill(skill), { rootPath: path.dirname(skill.entryFile) });
}
