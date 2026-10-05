/**
 * Conversion planning: everything that decides whether a skill converts, with no
 * filesystem writes.
 *
 * This module exists so `assess` and `convert` cannot drift. Both call
 * {@link planConversion}; `convert` then performs the write, while `assess` stops
 * and reports. If the rules lived in two places, an assessment could claim a skill
 * converts when the converter would refuse it — the one bug an assessment tool
 * must not have.
 *
 * Planning covers, in order: target support, source resolution and its contract,
 * the generic structural gate, IR construction, portable-semantic mapping, and
 * resource safety. It never creates a directory or writes a file.
 */
import { GENERIC_LOCAL_SOURCE_ID, loadSourceSkill, SOURCE_CODES } from './source-adapter.js';
import { collectResources, type ResourceCollection } from './resource-collector.js';
import type { ConversionIssue } from '../schemas/conversion.js';
import { CONVERSION_CODES } from '../schemas/conversion.js';
import { SkillIRError } from '../ir/normalize-skill.js';
import { toSkillIRV2, type SourceProvenance } from '../ir/normalize-skill-v2.js';
import { GENERIC_LOCAL_SKILL_FORMAT, type SkillIRV2 } from '../ir/skill-ir-v2.js';
import {
  renderDshSkillMarkdownV2,
  unsupportedDshSemantics,
  type RenderedEntry,
} from '../targets/dsh/dsh-target-adapter.js';
import { validateBasicSkill } from '../validators/basic-skill-validator.js';
import type { ParsedSkill } from '../schemas/skill.js';
import { SUPPORTED_TARGET } from './target-id.js';

/**
 * Which layer produced an issue.
 *
 * Stages are ordered, and a report is ordered by them, so a reader can tell
 * "this is not a valid skill" apart from "this is a valid skill this target
 * cannot express".
 */
export type ConversionStage = 'SOURCE' | 'IR' | 'SEMANTIC' | 'RESOURCE' | 'TARGET';

/** Stage ordering used for deterministic reporting. */
export const CONVERSION_STAGE_ORDER: readonly ConversionStage[] = [
  'SOURCE',
  'IR',
  'SEMANTIC',
  'RESOURCE',
  'TARGET',
];

/** A conversion issue that knows which stage produced it. */
export interface StagedIssue extends ConversionIssue {
  readonly stage: ConversionStage;
}

function staged(
  stage: ConversionStage,
  code: string,
  message: string,
  details?: readonly string[],
): StagedIssue {
  return details === undefined
    ? { stage, code, severity: 'error', message }
    : { stage, code, severity: 'error', message, details };
}

/** Reports whether a source failure means the source contract itself is invalid. */
function isSourceContractFailure(selection: string): boolean {
  return (
    selection === 'selection' || selection === 'package-shape' || selection === 'source-contract'
  );
}

/** A skill that passed every planning stage and can be written. */
export interface ConversionPlan {
  readonly ok: true;
  readonly source: string;
  readonly sourceRoot: string;
  readonly entryFile: string;
  readonly skill: ParsedSkill;
  readonly ir: SkillIRV2;
  readonly entry: RenderedEntry;
  readonly resources: ResourceCollection;
  /** Package-relative paths the conversion would write, sorted. */
  readonly plannedPaths: readonly string[];
  readonly issues: readonly StagedIssue[];
}

/** A skill that planning refused, with every issue found before stopping. */
export interface ConversionPlanFailure {
  readonly ok: false;
  /** Source adapter that was consulted. */
  readonly source: string;
  readonly sourceRoot: string | undefined;
  readonly issues: readonly StagedIssue[];
  /**
   * Whether the source contract was the layer that failed.
   *
   * When true the skill could not be interpreted at all, so no later stage is
   * meaningful and no later issue exists.
   */
  readonly sourceContractFailed: boolean;
}

export type ConversionPlanResult = ConversionPlan | ConversionPlanFailure;

/**
 * Converts a resource issue into a staged one.
 *
 * The resource collector already reports its own codes; this only attaches the
 * stage, so the collector keeps no knowledge of the planning model.
 */
function stagedResourceIssue(code: string, message: string): StagedIssue {
  return staged('RESOURCE', code, message);
}

export interface PlanOptions {
  /** Requested target identifier. */
  readonly target: string;
  /** Source adapter, or `undefined` for the generic local path. */
  readonly source?: string | undefined;
  /** Directory used to resolve a relative input path. */
  readonly cwd: string;
}

/**
 * Plans a conversion without touching the output filesystem.
 *
 * Output-path concerns — whether the destination exists, whether it sits inside
 * the source — are deliberately *not* part of planning: they belong to the write
 * step, because an assessment of a skill must not depend on where someone
 * happens to want the package.
 *
 * @param inputPath Skill file or directory.
 * @param options Target, source and directory context.
 * @returns The plan, or every issue found before planning stopped.
 */
export function planConversion(inputPath: string, options: PlanOptions): ConversionPlanResult {
  const source = options.source ?? GENERIC_LOCAL_SOURCE_ID;

  if (options.target !== SUPPORTED_TARGET) {
    return {
      ok: false,
      source,
      sourceRoot: undefined,
      sourceContractFailed: false,
      issues: [
        staged(
          'TARGET',
          CONVERSION_CODES.unsupportedTarget,
          `Unsupported target "${options.target}": this project can only convert to "${SUPPORTED_TARGET}"`,
        ),
      ],
    };
  }

  const loaded = loadSourceSkill(inputPath, options.source, options.cwd);
  if (!loaded.ok) {
    return {
      ok: false,
      source: loaded.source,
      sourceRoot: undefined,
      sourceContractFailed: isSourceContractFailure(loaded.selection),
      issues: loaded.issues.map((issue) =>
        staged(
          'SOURCE',
          issue.code,
          issue.message,
          issue.details === undefined ? undefined : issue.details,
        ),
      ),
    };
  }

  const { skill, sourceRoot } = loaded;

  // The generic validation gate runs after the source contract: a skill can
  // satisfy its own source and still be outside what the IR can represent.
  const validation = validateBasicSkill(skill);
  if (!validation.valid) {
    if (options.source !== undefined) {
      return {
        ok: false,
        source: loaded.source,
        sourceRoot,
        sourceContractFailed: false,
        issues: [
          staged(
            'IR',
            SOURCE_CODES.sourceValidIrUnsupported,
            `The skill satisfies the ${options.source} source contract but cannot be represented as Universal Skill IR. This is not a source adapter defect.`,
            validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
          ),
        ],
      };
    }

    return {
      ok: false,
      source: loaded.source,
      sourceRoot,
      sourceContractFailed: false,
      issues: validation.errors.map((issue) =>
        staged('IR', CONVERSION_CODES.generatedPackageInvalid, `${issue.code}: ${issue.message}`),
      ),
    };
  }

  const provenance: SourceProvenance = {
    format: loaded.format ?? GENERIC_LOCAL_SKILL_FORMAT,
    ...(loaded.semantics === undefined ? {} : { semantics: loaded.semantics }),
  };

  let ir: SkillIRV2;
  try {
    ir = toSkillIRV2(skill, provenance, sourceRoot);
  } catch (thrown) {
    if (thrown instanceof SkillIRError) {
      return {
        ok: false,
        source: loaded.source,
        sourceRoot,
        sourceContractFailed: false,
        issues: [
          staged(
            'IR',
            CONVERSION_CODES.unrepresentableIrValue,
            'A source value cannot be represented in the Universal Skill IR, so conversion is refused rather than dropping it',
            thrown.problems,
          ),
        ],
      };
    }
    throw thrown;
  }

  // Uninterpreted source frontmatter has no target mapping yet.
  const unmappedKeys = Object.keys(ir.source.extraFrontmatter);
  if (unmappedKeys.length > 0) {
    return {
      ok: false,
      source: loaded.source,
      sourceRoot,
      sourceContractFailed: false,
      issues: [
        staged(
          'SEMANTIC',
          CONVERSION_CODES.unmappedSourceFrontmatter,
          'Source frontmatter has no target mapping, so conversion is refused rather than dropping it',
          unmappedKeys,
        ),
      ],
    };
  }

  // Portable semantics the source interpreted but this target cannot express are
  // a different refusal from raw source data: the meaning is known, and it simply
  // has no counterpart here.
  const unsupportedSemantics = unsupportedDshSemantics(ir.semantics);
  if (unsupportedSemantics.length > 0) {
    return {
      ok: false,
      source: loaded.source,
      sourceRoot,
      sourceContractFailed: false,
      issues: [
        staged(
          'SEMANTIC',
          CONVERSION_CODES.unsupportedTargetSemantic,
          'Semantics were interpreted by the source but have no mapping in this target, so conversion is refused rather than dropping or reinterpreting them',
          unsupportedSemantics,
        ),
      ],
    };
  }

  const resources = collectResources(ir.resources, sourceRoot);
  if (resources.issues.length > 0) {
    return {
      ok: false,
      source: loaded.source,
      sourceRoot,
      sourceContractFailed: false,
      issues: resources.issues.map((issue) => stagedResourceIssue(issue.code, issue.message)),
    };
  }

  const entry = renderDshSkillMarkdownV2(ir);
  const plannedPaths = [
    entry.path,
    ...resources.nodes.filter((node) => node.kind === 'file').map((node) => node.destination),
  ].sort((left, right) => left.localeCompare(right, 'en'));

  return {
    ok: true,
    source: loaded.source,
    sourceRoot,
    entryFile: skill.entryFile,
    skill,
    ir,
    entry,
    resources,
    plannedPaths,
    issues: [],
  };
}

/**
 * Orders issues deterministically: by stage, then code, then the first detail.
 *
 * Two runs over the same skill must produce the same report, so nothing here may
 * depend on filesystem enumeration or object insertion order.
 *
 * @param issues Issues to order.
 * @returns A new, ordered array.
 */
export function orderIssues(issues: readonly StagedIssue[]): StagedIssue[] {
  return [...issues].sort((left, right) => {
    const byStage =
      CONVERSION_STAGE_ORDER.indexOf(left.stage) - CONVERSION_STAGE_ORDER.indexOf(right.stage);
    if (byStage !== 0) return byStage;

    const byCode = left.code.localeCompare(right.code, 'en');
    if (byCode !== 0) return byCode;

    return (left.details?.[0] ?? '').localeCompare(right.details?.[0] ?? '', 'en');
  });
}
