#!/usr/bin/env node
/**
 * Deterministic Codex corpus survey.
 *
 * Reads a local checkout of the pinned `openai/skills` distribution corpus and
 * emits derived facts only. Nothing here fetches anything: the checkout is
 * supplied by the operator, so the survey never touches the network.
 *
 * The snapshot deliberately records only what cannot embarrass anyone:
 * repository, commit, collection, skill name, entry and sidecar hashes,
 * frontmatter and sidecar KEY NAMES, resource counts, classification, status and
 * issue codes. It never records a description, a body, a `display_name`, a
 * `default_prompt`, a dependency URL, raw YAML, or any absolute path.
 *
 * Usage:
 *   pnpm survey:codex -- <corpus-root>/skills
 *   pnpm survey:codex -- <corpus-root>/skills --out docs/data/<name>.json
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { assessSkill } from '../src/assessment/assess-skill.js';
import { AGENT_SKILLS_SOURCE_ID } from '../src/sources/agent-skills/agent-skills-contract.js';
import {
  CODEX_SIDECAR_BASENAME,
  CODEX_SIDECAR_DIRECTORY,
  CODEX_SKILLS_COMMIT,
  CODEX_SKILLS_REPOSITORY,
  CODEX_SOURCE_ID,
  findCodexSidecar,
  inspectCodexSidecar,
} from '../src/sources/codex/codex-contract.js';
import { SUPPORTED_TARGET } from '../src/conversion/target-id.js';
import { parseFrontmatter } from '../src/parsers/frontmatter-parser.js';

/** Default location for the committed snapshot. */
export const DEFAULT_CODEX_SNAPSHOT_PATH =
  'docs/data/openai-skills-49f948fa-codex-profile-survey.json';

/**
 * Collections surveyed, in order.
 *
 * The selection rule is explicit so the total is reproducible: every immediate
 * child directory of these two collections that contains a `SKILL.md`. Anything
 * outside them — including any future `.experimental` collection — is excluded
 * rather than silently folded into an opaque percentage.
 */
export const CODEX_SURVEY_COLLECTIONS: readonly string[] = ['.curated', '.system'];

interface SurveyedCodexSkill {
  readonly name: string;
  readonly collection: string;
  readonly entryFile: string;
  readonly entrySha256: string;
  readonly frontmatterKeys: readonly string[];
  readonly descriptionLength: number;
  readonly sidecarPresent: boolean;
  readonly sidecarSha256: string | null;
  readonly sidecarTopLevelKeys: readonly string[];
  readonly classification: string;
  readonly resourceFiles: number;
  readonly resourceDirectories: readonly string[];
  readonly status: string;
  readonly issues: readonly {
    readonly stage: string;
    readonly code: string;
    readonly fields: readonly string[];
  }[];
}

interface CodexSurvey {
  readonly repository: string;
  readonly commit: string;
  readonly surveyRoot: string;
  readonly collections: readonly string[];
  readonly skillCount: number;
  readonly summary: {
    readonly total: number;
    readonly convertible: number;
    readonly refused: number;
    readonly sourceInvalid: number;
    readonly absent: number;
    readonly interfaceOnly: number;
    readonly behavioural: number;
    readonly unreadable: number;
    readonly withDependencies: number;
    readonly withPolicy: number;
    readonly behaviouralUnion: number;
    readonly withLicenseFrontmatter: number;
    readonly overDescriptionLimit: number;
    readonly unknownSidecarKeys: number;
  };
  readonly skills: readonly SurveyedCodexSkill[];
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function countFiles(root: string, skip: ReadonlySet<string>): number {
  let count = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else count += 1;
    }
  }
  return count;
}

/** Surveys one collection. */
function surveyCollection(corpusRoot: string, collection: string): SurveyedCodexSkill[] {
  const collectionRoot = path.join(corpusRoot, collection);
  if (!existsSync(collectionRoot)) {
    return [];
  }

  const skills: SurveyedCodexSkill[] = [];
  for (const name of readdirSync(collectionRoot).sort(compareCodePoints)) {
    const skillRoot = path.join(collectionRoot, name);
    if (!statSync(skillRoot).isDirectory()) continue;

    const entry = ['SKILL.md', 'skill.md']
      .map((candidate) => path.join(skillRoot, candidate))
      .find((candidate) => existsSync(candidate));
    if (entry === undefined) continue;

    const sidecar = findCodexSidecar(skillRoot);
    const inspection = inspectCodexSidecar(skillRoot);
    const result = assessSkill(skillRoot, {
      target: SUPPORTED_TARGET,
      source: CODEX_SOURCE_ID,
      cwd: process.cwd(),
    });

    // Frontmatter KEY NAMES only; the values are never read into the snapshot.
    // An entry that cannot be parsed contributes no keys; the assessment below
    // already reports it, so this stays silent rather than inventing a second
    // finding for the same problem.
    let frontmatterKeys: string[] = [];
    let descriptionLength = 0;
    try {
      const parsed = parseFrontmatter(readFileSync(entry, 'utf8'));
      frontmatterKeys = Object.keys(parsed.frontmatter).sort(compareCodePoints);
      const description = parsed.frontmatter['description'];
      descriptionLength = typeof description === 'string' ? [...description].length : 0;
    } catch {
      // Leave both at their defaults.
    }

    skills.push({
      name,
      collection,
      entryFile: path.basename(entry),
      entrySha256: sha256File(entry),
      frontmatterKeys,
      descriptionLength,
      sidecarPresent: sidecar !== undefined,
      sidecarSha256: sidecar === undefined ? null : sha256File(sidecar),
      sidecarTopLevelKeys: inspection.topLevelKeys,
      classification: inspection.kind,
      resourceFiles: countFiles(skillRoot, new Set(['.git'])),
      resourceDirectories: readdirSync(skillRoot, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort(compareCodePoints),
      status: result.status,
      issues: result.issues.map((issue) => ({
        stage: issue.stage,
        code: issue.code,
        fields: issue.details === undefined ? [] : [...issue.details].sort(compareCodePoints),
      })),
    });
  }
  return skills;
}

/**
 * Surveys the pinned Codex corpus.
 *
 * @param corpusRoot Directory containing the collections, normally `<checkout>/skills`.
 * @returns Derived facts about every skill found.
 */
export function surveyCodexCorpus(corpusRoot: string): CodexSurvey {
  const skills = CODEX_SURVEY_COLLECTIONS.flatMap((collection) =>
    surveyCollection(corpusRoot, collection),
  );

  const count = (predicate: (skill: SurveyedCodexSkill) => boolean): number =>
    skills.filter(predicate).length;
  const hasKey = (skill: SurveyedCodexSkill, key: string): boolean =>
    skill.sidecarTopLevelKeys.includes(key);

  const withDependencies = count((skill) => hasKey(skill, 'dependencies'));
  const withPolicy = count((skill) => hasKey(skill, 'policy'));

  return {
    repository: CODEX_SKILLS_REPOSITORY,
    commit: CODEX_SKILLS_COMMIT,
    surveyRoot: 'skills',
    collections: CODEX_SURVEY_COLLECTIONS,
    skillCount: skills.length,
    summary: {
      total: skills.length,
      convertible: count((skill) => skill.status === 'CONVERTIBLE'),
      refused: count((skill) => skill.status === 'REFUSED'),
      sourceInvalid: count((skill) => skill.status === 'SOURCE_INVALID'),
      absent: count((skill) => skill.classification === 'ABSENT'),
      interfaceOnly: count((skill) => skill.classification === 'INTERFACE_ONLY'),
      behavioural: count((skill) => skill.classification === 'BEHAVIOURAL'),
      unreadable: count((skill) => skill.classification === 'UNREADABLE'),
      // Counted independently, because a skill may declare both keys. Deriving one
      // from the other would silently assume they are mutually exclusive.
      withDependencies,
      withPolicy,
      behaviouralUnion: count((skill) => hasKey(skill, 'dependencies') || hasKey(skill, 'policy')),
      withLicenseFrontmatter: count((skill) => skill.frontmatterKeys.includes('license')),
      overDescriptionLimit: count((skill) => skill.descriptionLength > 1024),
      unknownSidecarKeys: count((skill) =>
        skill.sidecarTopLevelKeys.some(
          (key) => key !== 'interface' && key !== 'dependencies' && key !== 'policy',
        ),
      ),
    },
    skills,
  };
}

/**
 * Renders the survey as a snapshot.
 *
 * Field order is fixed and skills are already sorted, so two runs over the same
 * checkout are byte-identical.
 *
 * @param report Survey to serialize.
 * @returns Pretty-printed JSON, newline-terminated.
 */
export function serializeCodexSnapshot(report: CodexSurvey): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Parses survey arguments, tolerating the `--` that a package script forwards. */
export function parseCodexSurveyArgs(argv: readonly string[]): {
  corpusRoot: string | undefined;
  out: string;
} {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  let corpusRoot: string | undefined;
  let out = DEFAULT_CODEX_SNAPSHOT_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--out') {
      const next = args[index + 1];
      if (next !== undefined) {
        out = next;
        index += 1;
      }
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else if (corpusRoot === undefined) {
      corpusRoot = arg;
    }
  }

  return { corpusRoot, out };
}

/**
 * Runs the survey CLI.
 *
 * @param argv Arguments after the script name.
 * @returns Process exit code.
 */
export function runCodexSurveyCli(argv: readonly string[]): number {
  const { corpusRoot, out } = parseCodexSurveyArgs(argv);
  if (corpusRoot === undefined) {
    process.stderr.write(
      'usage: pnpm survey:codex -- <corpus-root>/skills [--out <snapshot.json>]\n',
    );
    return 1;
  }
  if (!existsSync(corpusRoot)) {
    process.stderr.write(`corpus root does not exist: ${corpusRoot}\n`);
    return 1;
  }

  const report = surveyCodexCorpus(corpusRoot);
  const summary = report.summary;
  process.stdout.write(
    `Codex corpus survey (${report.repository}@${report.commit.slice(0, 8)})\n\n`,
  );
  process.stdout.write(`Total:              ${summary.total}\n`);
  process.stdout.write(`Convertible:        ${summary.convertible}\n`);
  process.stdout.write(`Refused:            ${summary.refused}\n`);
  process.stdout.write(`Source invalid:     ${summary.sourceInvalid}\n\n`);
  process.stdout.write(`ABSENT:             ${summary.absent}\n`);
  process.stdout.write(`INTERFACE_ONLY:     ${summary.interfaceOnly}\n`);
  process.stdout.write(`BEHAVIOURAL:        ${summary.behavioural}\n`);
  process.stdout.write(`UNREADABLE:         ${summary.unreadable}\n\n`);
  process.stdout.write(`with dependencies:  ${summary.withDependencies}\n`);
  process.stdout.write(`with policy:        ${summary.withPolicy}\n`);
  process.stdout.write(`behavioural union:  ${summary.behaviouralUnion}\n`);

  writeFileSync(out, serializeCodexSnapshot(report));
  process.stdout.write(`\nsnapshot written to ${out}\n`);
  return 0;
}

export { AGENT_SKILLS_SOURCE_ID, CODEX_SIDECAR_BASENAME, CODEX_SIDECAR_DIRECTORY };
