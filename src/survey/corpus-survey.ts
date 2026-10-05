/**
 * Development-time corpus survey.
 *
 * Reads a local checkout of a skills repository, assesses each skill with the same
 * planner the converter uses, and derives counts. It exists to answer "how much of
 * the real world does this converter handle, and why not the rest?" with
 * measurement rather than optimism.
 *
 * Boundaries, deliberately:
 *
 * - **Read-only.** It reads, parses, stats and hashes skill entries. It never
 *   executes anything it finds — not a `.sh`, `.py`, `.ps1`, `.bat` or `.js` —
 *   and never writes into the corpus.
 * - **No network.** The checkout is supplied as a path; nothing is fetched here.
 * - **No third-party content.** The derived snapshot carries names, entry hashes,
 *   frontmatter *keys*, resource counts and assessment codes. It never carries a
 *   description, an instruction body, a license text or a resource's contents.
 * - **No absolute paths.** A report is safe to paste anywhere.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  assessSkill,
  type AssessmentResult,
  type AssessmentStatus,
} from '../assessment/assess-skill.js';
import { AGENT_SKILLS_SOURCE_ID } from '../sources/agent-skills/agent-skills-contract.js';
import { SUPPORTED_TARGET } from '../conversion/target-id.js';

/** One skill's derived survey row. Contains no source content. */
export interface SurveyedSkill {
  /** Directory name inside the survey root. */
  readonly name: string;
  /** Entry file name as found on disk, for example `SKILL.md`. */
  readonly entryFile: string;
  /** SHA-256 of the entry file bytes, for reproducibility and identity only. */
  readonly entrySha256: string;
  /** Frontmatter key names, sorted. Values are never recorded. */
  readonly frontmatterKeys: readonly string[];
  /** Resource files below the skill directory, excluding the entry. */
  readonly resourceFiles: number;
  /** Immediate subdirectory names, sorted. */
  readonly resourceDirectories: readonly string[];
  readonly status: AssessmentStatus;
  readonly stages: AssessmentResult['stages'];
  /** Issue codes with their stage and detail labels, sorted. */
  readonly issues: readonly {
    readonly stage: string;
    readonly code: string;
    readonly fields: readonly string[];
  }[];
  /**
   * Semantic field *names* carried in the tool-owned preservation envelope.
   *
   * Names only: a preserved license *value* is never recorded in a snapshot, for
   * the same reason a description or an instruction body is not.
   */
  readonly preservedSemantics: readonly string[];
}

/** Aggregated corpus metrics. */
export interface SurveySummary {
  readonly total: number;
  readonly convertible: number;
  readonly refused: number;
  readonly sourceInvalid: number;
  /** Skills whose IR stage refused. */
  readonly irUnsupported: number;
  /** Frontmatter key → how many skills declare it. */
  readonly frontmatterFrequency: Readonly<Record<string, number>>;
  /** Blocker label → how many skills it blocks. */
  readonly blockerFrequency: Readonly<Record<string, number>>;
  readonly withResources: number;
  readonly withScripts: number;
  readonly withReferences: number;
  readonly withAssets: number;
}

/** The complete survey output. */
export interface SurveyReport {
  readonly summary: SurveySummary;
  readonly skills: readonly SurveyedSkill[];
}

/** Options for {@link surveyCorpus}. */
export interface SurveyOptions {
  /** Directory whose immediate children are skill directories. */
  readonly skillsRoot: string;
  /** Directory used to resolve relative paths; defaults to the process cwd. */
  readonly cwd?: string;
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Counts regular files below a directory, excluding the entry file. */
function countResourceFiles(skillRoot: string, entryName: string): number {
  let count = 0;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      // Symbolic links are counted as entries but never followed.
      if (entry.isSymbolicLink()) {
        count += 1;
        continue;
      }
      if (path.dirname(absolute) === skillRoot && entry.name === entryName) {
        continue;
      }
      count += 1;
    }
  };
  walk(skillRoot);
  return count;
}

/** Reads the frontmatter key names of an entry file without interpreting values. */
function readFrontmatterKeys(entryPath: string): string[] {
  const text = readFileSync(entryPath, 'utf8');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') {
    return [];
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing === -1) {
    return [];
  }

  const keys = new Set<string>();
  for (const line of lines.slice(1, closing)) {
    // Top-level keys only: a nested key is indented and belongs to its parent.
    const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (match?.[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort(compareCodePoints);
}

/** Finds the entry file of a skill directory, case-insensitively matching `skill.md`. */
function findEntry(skillRoot: string): string | undefined {
  for (const entry of readdirSync(skillRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
      return entry.name;
    }
  }
  return undefined;
}

/**
 * Surveys every immediate child directory of `skillsRoot`.
 *
 * Nested skill trees are deliberately not discovered: a corpus is defined by its
 * layout, and guessing would make the survey irreproducible.
 *
 * @param options Survey configuration.
 * @returns Per-skill rows plus aggregate metrics.
 */
export function surveyCorpus(options: SurveyOptions): SurveyReport {
  const cwd = options.cwd ?? process.cwd();
  const skillsRoot = path.resolve(cwd, options.skillsRoot);

  const directoryNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareCodePoints);

  const skills: SurveyedSkill[] = [];

  for (const name of directoryNames) {
    const skillRoot = path.join(skillsRoot, name);
    const entryName = findEntry(skillRoot);

    if (entryName === undefined) {
      const result = assessSkill(skillRoot, {
        target: SUPPORTED_TARGET,
        source: AGENT_SKILLS_SOURCE_ID,
        cwd,
      });
      skills.push({
        name,
        entryFile: '',
        entrySha256: '',
        frontmatterKeys: [],
        resourceFiles: countResourceFiles(skillRoot, ''),
        resourceDirectories: [],
        status: result.status,
        stages: result.stages,
        issues: result.issues.map((issue) => ({
          stage: issue.stage,
          code: issue.code,
          fields: issue.details === undefined ? [] : [...issue.details].sort(compareCodePoints),
        })),
        preservedSemantics: [...result.preservedSemantics],
      });
      continue;
    }

    const entryPath = path.join(skillRoot, entryName);
    const result = assessSkill(skillRoot, {
      target: SUPPORTED_TARGET,
      source: AGENT_SKILLS_SOURCE_ID,
      cwd,
    });

    skills.push({
      name,
      entryFile: entryName,
      entrySha256: createHash('sha256').update(readFileSync(entryPath)).digest('hex'),
      frontmatterKeys: readFrontmatterKeys(entryPath),
      resourceFiles: countResourceFiles(skillRoot, entryName),
      resourceDirectories: readdirSync(skillRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareCodePoints),
      status: result.status,
      stages: result.stages,
      issues: result.issues.map((issue) => ({
        stage: issue.stage,
        code: issue.code,
        fields: issue.details === undefined ? [] : [...issue.details].sort(compareCodePoints),
      })),
      preservedSemantics: [...result.preservedSemantics],
    });
  }

  const frontmatterFrequency: Record<string, number> = {};
  const blockerFrequency: Record<string, number> = {};
  let convertible = 0;
  let refused = 0;
  let sourceInvalid = 0;
  let irUnsupported = 0;
  let withResources = 0;
  let withScripts = 0;
  let withReferences = 0;
  let withAssets = 0;

  for (const skill of skills) {
    for (const key of skill.frontmatterKeys) {
      frontmatterFrequency[key] = (frontmatterFrequency[key] ?? 0) + 1;
    }

    if (skill.status === 'CONVERTIBLE') convertible += 1;
    else if (skill.status === 'SOURCE_INVALID') sourceInvalid += 1;
    else refused += 1;

    if (skill.stages.ir === 'REFUSED') irUnsupported += 1;

    if (skill.resourceFiles > 0 || skill.resourceDirectories.length > 0) withResources += 1;
    if (skill.resourceDirectories.includes('scripts')) withScripts += 1;
    if (skill.resourceDirectories.includes('references')) withReferences += 1;
    if (skill.resourceDirectories.includes('assets')) withAssets += 1;

    for (const issue of skill.issues) {
      // A blocker is labelled by its code plus the field it names, so
      // `license` and `compatibility` are counted apart.
      const labels = issue.fields.length > 0 ? issue.fields : [''];
      for (const label of labels) {
        const key = label === '' ? issue.code : `${issue.code}: ${label}`;
        blockerFrequency[key] = (blockerFrequency[key] ?? 0) + 1;
      }
    }
  }

  return {
    summary: {
      total: skills.length,
      convertible,
      refused,
      sourceInvalid,
      irUnsupported,
      frontmatterFrequency,
      blockerFrequency,
      withResources,
      withScripts,
      withReferences,
      withAssets,
    },
    skills,
  };
}

/** A stable, content-free snapshot suitable for committing. */
export interface SurveySnapshot {
  readonly repository: string;
  readonly commit: string;
  readonly surveyRoot: string;
  readonly skillCount: number;
  readonly summary: SurveySummary;
  readonly skills: readonly {
    readonly name: string;
    readonly entryFile: string;
    readonly entrySha256: string;
    readonly frontmatterKeys: readonly string[];
    readonly resourceFiles: number;
    readonly resourceDirectories: readonly string[];
    readonly status: AssessmentStatus;
    readonly issues: readonly {
      readonly stage: string;
      readonly code: string;
      readonly fields: readonly string[];
    }[];
    readonly preservedSemantics: readonly string[];
  }[];
}

/**
 * Renders a survey report as a committable snapshot.
 *
 * Deliberately excludes anything non-deterministic: there is no wall-clock
 * timestamp, so two runs over the same checkout produce byte-identical output.
 *
 * @param report Survey result.
 * @param provenance Repository and commit the corpus came from.
 * @returns The snapshot object.
 */
export function toSnapshot(
  report: SurveyReport,
  provenance: { readonly repository: string; readonly commit: string; readonly surveyRoot: string },
): SurveySnapshot {
  return {
    repository: provenance.repository,
    commit: provenance.commit,
    surveyRoot: provenance.surveyRoot,
    skillCount: report.summary.total,
    summary: report.summary,
    skills: report.skills.map((skill) => ({
      name: skill.name,
      entryFile: skill.entryFile,
      entrySha256: skill.entrySha256,
      frontmatterKeys: skill.frontmatterKeys,
      resourceFiles: skill.resourceFiles,
      resourceDirectories: skill.resourceDirectories,
      status: skill.status,
      issues: skill.issues,
      preservedSemantics: skill.preservedSemantics,
    })),
  };
}

/**
 * Serializes a snapshot as canonical JSON.
 *
 * @param snapshot Snapshot to serialize.
 * @returns JSON ending with exactly one newline.
 */
export function serializeSnapshot(snapshot: SurveySnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Renders the human-readable survey report. */
export function renderSurveyReport(report: SurveyReport): string {
  const { summary } = report;
  const lines = [
    'Agent Skills Corpus Survey',
    '',
    `Total skills:    ${summary.total}`,
    `Convertible:     ${summary.convertible}`,
    `Refused:         ${summary.refused}`,
    `Source invalid:  ${summary.sourceInvalid}`,
    `IR unsupported:  ${summary.irUnsupported}`,
    '',
    'Frontmatter keys:',
  ];

  for (const [key, count] of Object.entries(summary.frontmatterFrequency).sort(
    (left, right) => right[1] - left[1] || compareCodePoints(left[0], right[0]),
  )) {
    lines.push(`  ${key.padEnd(20)} ${count}`);
  }

  lines.push('', 'Blockers:');
  const blockers = Object.entries(summary.blockerFrequency).sort(
    (left, right) => right[1] - left[1] || compareCodePoints(left[0], right[0]),
  );
  if (blockers.length === 0) {
    lines.push('  (none)');
  }
  for (const [label, count] of blockers) {
    lines.push(`  ${label.padEnd(44)} ${count}`);
  }

  lines.push(
    '',
    'Resource shape:',
    `  with resources:   ${summary.withResources}`,
    `  with scripts/:    ${summary.withScripts}`,
    `  with references/: ${summary.withReferences}`,
    `  with assets/:     ${summary.withAssets}`,
    '',
    'Per skill:',
    `  ${'SKILL'.padEnd(24)} ${'SOURCE'.padEnd(8)} ${'IR'.padEnd(7)} ${'SEM'.padEnd(8)} ${'RES'.padEnd(7)} ${'FINAL'.padEnd(14)} PRIMARY BLOCKER`,
  );

  for (const skill of report.skills) {
    const primary =
      skill.issues.length === 0
        ? '—'
        : `${skill.issues[0]?.code ?? ''}${(skill.issues[0]?.fields.length ?? 0) > 0 ? `: ${skill.issues[0]?.fields.join(', ')}` : ''}`;
    lines.push(
      `  ${skill.name.padEnd(24)} ${skill.stages.source.padEnd(8)} ${skill.stages.ir.padEnd(7)} ${skill.stages.semantic.padEnd(8)} ${skill.stages.resource.padEnd(7)} ${skill.status.padEnd(14)} ${primary}`,
    );
  }

  return `${lines.join('\n')}\n`;
}
