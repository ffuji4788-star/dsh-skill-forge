/**
 * The `analyze` command: read a local skill and report what it contains.
 *
 * Reads and reads only. Nothing found beside a skill is executed.
 */
import path from 'node:path';

import { analyzeBasicSkill, type SkillAnalysis } from '../analyzers/basic-skill-analyzer.js';
import { loadLocalSkill } from '../importers/local-importer.js';

export interface RenderAnalysisOptions {
  /** Directory that the entry file path is displayed relative to. */
  readonly baseDirectory: string;
}

export interface RunAnalyzeOptions {
  /** Directory used both to resolve the input and to shorten displayed paths. */
  readonly cwd?: string;
}

function renderCheck(label: string, passed: boolean, message?: string): string {
  const status = passed ? 'PASS' : 'FAIL';
  return message === undefined ? `${label}: ${status}` : `${label}: ${status} (${message})`;
}

function renderValue(value: string | undefined): string {
  return value === undefined ? '(none)' : value;
}

/**
 * Shortens an absolute path for display, using `/` separators so output is
 * identical on Windows and POSIX.
 */
function toDisplayPath(target: string, baseDirectory: string): string {
  const relative = path.relative(baseDirectory, target);
  const display = relative.length === 0 ? path.basename(target) : relative;
  return display.split(path.sep).join('/');
}

/**
 * Renders an analysis report for people and for tests.
 *
 * Only the entry file is shortened: resource paths are already relative to the
 * skill root.
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
    `Entry File: ${toDisplayPath(analysis.entryFile, options.baseDirectory)}`,
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
  const absoluteInput = path.resolve(cwd, inputPath);
  const skill = loadLocalSkill(absoluteInput);

  return renderAnalysis(analyzeBasicSkill(skill), { baseDirectory: cwd });
}
