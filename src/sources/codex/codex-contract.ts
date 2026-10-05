/**
 * The Codex source profile: Agent Skills plus a product-specific sidecar.
 *
 * A Codex skill is **not** a new package format. It is an Agent Skills package
 * (`SKILL.md` with `name`/`description`, Markdown body, ordinary resource
 * directories) that may additionally carry `agents/openai.yaml` for Codex-specific
 * product configuration.
 *
 * The pinned runtime proves the first half. `codex-rs/skills/src/parser.rs`
 * deserializes `SKILL.md` frontmatter into exactly `name`, `description` and
 * `metadata.short-description`; it does not deny unknown fields, so a `license` or
 * `allowed-tools` key is read past rather than rejected. That is the same contract
 * this project already implements for `--source agent-skills`, which is why this
 * profile **composes** that adapter instead of writing a second one.
 *
 * The second half — the sidecar — is where the real new work is, and it is split
 * by whether a field can change how a skill behaves:
 *
 * - `interface` is UI presentation (a display name, an icon, a brand colour, a
 *   suggested opening prompt). It decides nothing about instructions, routing,
 *   permissions or invocation, so it is carried **opaquely**: the original file is
 *   copied byte-for-byte and never re-serialized. DSH understands none of it, and
 *   nothing here claims otherwise.
 * - `policy` and `dependencies` are behavioural — implicit invocation and runtime
 *   tool requirements — and are **refused**.
 *
 * See `docs/codex-source-contract.md` for the evidence and the boundary reasoning.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { toRelativePosixPath } from '../../importers/skill-files.js';
import type { SourceIssue } from '../../conversion/source-adapter.js';

/** Source identifier selected with `--source codex`. */
export const CODEX_SOURCE_ID = 'codex';

/** Human-readable source name. */
export const CODEX_SOURCE_NAME = 'Codex';

/** Pinned runtime whose contract this profile implements. */
export const CODEX_UPSTREAM_REPOSITORY = 'https://github.com/openai/codex';
export const CODEX_UPSTREAM_COMMIT = '7f892275e31002f0422477c6219189284560e689';

/** Pinned distribution corpus used to measure the profile against real skills. */
export const CODEX_SKILLS_REPOSITORY = 'https://github.com/openai/skills';
export const CODEX_SKILLS_COMMIT = '49f948faa9258a0c61caceaf225e179651397431';

/** Date the pinned runtime and corpus were read. */
export const CODEX_CONTRACT_VERIFIED_AT = '2026-10-04';

/** Files read as evidence for this contract, at the pinned commit. */
export const CODEX_CONTRACT_SOURCES: readonly string[] = [
  'codex-rs/skills/src/parser.rs',
  'codex-rs/skills/src/model.rs',
  'codex-rs/skills/src/interface.rs',
  'codex-rs/skills/src/interface_tests.rs',
  'codex-rs/skills/src/invocation.rs',
  'codex-rs/skills/src/assets/samples/skill-creator/references/openai_yaml.md',
];

/** Package-relative location of the optional product sidecar. */
export const CODEX_SIDECAR_DIRECTORY = 'agents';
/** Base file name of the optional product sidecar. */
export const CODEX_SIDECAR_BASENAME = 'openai.yaml';

/**
 * Top-level sidecar keys the pinned runtime reads.
 *
 * Only these three have any meaning to Codex. Anything else is preserved but not
 * interpreted, which mirrors the runtime: the sidecar is deserialized into a
 * struct that reads these keys and ignores the rest.
 */
export const CODEX_SIDECAR_KNOWN_KEYS: ReadonlySet<string> = new Set([
  'interface',
  'dependencies',
  'policy',
]);

/**
 * Sidecar keys that express behaviour rather than presentation.
 *
 * `policy` decides whether a skill may be injected into the model context without
 * an explicit `$skill` mention, and `dependencies` declares runtime tool
 * requirements. Neither has an equivalent in the target, so neither can be carried
 * without changing what the skill means.
 */
export const CODEX_BEHAVIOURAL_KEYS: readonly string[] = ['dependencies', 'policy'];

/**
 * What the sidecar turned out to contain.
 *
 * `UNREADABLE` is deliberately distinct from `BEHAVIOURAL`: a sidecar that cannot
 * be parsed declares nothing observable, so reporting it as behavioural would
 * assert a fact nobody established. Both refuse, for different reasons.
 */
export type CodexSidecarKind = 'ABSENT' | 'INTERFACE_ONLY' | 'BEHAVIOURAL' | 'UNREADABLE';

/** Codes for sidecar findings. */
export const CODEX_CODES = {
  unsupportedBehaviour: 'UNSUPPORTED_CODEX_BEHAVIOR',
  unsupportedDependency: 'UNSUPPORTED_CODEX_DEPENDENCY',
  invalidSidecar: 'INVALID_CODEX_SIDECAR',
} as const;

/** Result of inspecting a Codex package's optional sidecar. */
export interface CodexSidecarInspection {
  readonly kind: CodexSidecarKind;
  /** Package-relative path of the sidecar, when one exists. */
  readonly relativePath?: string;
  /** Top-level key names, sorted. Names only: values are never reported. */
  readonly topLevelKeys: readonly string[];
  /** Behavioural keys that were present, sorted. */
  readonly behaviouralKeys: readonly string[];
  readonly issues: readonly SourceIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Locates the sidecar within a skill directory.
 *
 * Only the exact documented path is recognised. A differently-cased or nested file
 * is not treated as a sidecar, because inventing a second location would mean
 * guessing which file the runtime would have read.
 *
 * @param sourceRoot Absolute skill directory.
 * @returns The absolute sidecar path, or `undefined`.
 */
export function findCodexSidecar(sourceRoot: string): string | undefined {
  const candidate = path.join(sourceRoot, CODEX_SIDECAR_DIRECTORY, CODEX_SIDECAR_BASENAME);
  if (!existsSync(candidate)) {
    return undefined;
  }
  // A directory named openai.yaml is not a sidecar file.
  return statSync(candidate).isFile() ? candidate : undefined;
}

/**
 * Inspects a Codex package's optional sidecar.
 *
 * Presentation-only sidecars are accepted for opaque preservation. A sidecar that
 * declares behaviour is refused, and so is one that cannot be read as a YAML
 * mapping — an unreadable sidecar cannot be classified, and guessing that it is
 * harmless is exactly the mistake this profile exists to avoid.
 *
 * @param sourceRoot Absolute skill directory.
 * @returns What the sidecar contains, and any refusal it produced.
 * @throws SkillInputError when the sidecar exists but cannot be read.
 */
export function inspectCodexSidecar(sourceRoot: string): CodexSidecarInspection {
  const sidecar = findCodexSidecar(sourceRoot);
  if (sidecar === undefined) {
    return { kind: 'ABSENT', topLevelKeys: [], behaviouralKeys: [], issues: [] };
  }

  const relativePath = toRelativePosixPath(sourceRoot, sidecar);
  const raw = readFileSync(sidecar, 'utf8');

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return {
      kind: 'UNREADABLE',
      relativePath,
      topLevelKeys: [],
      behaviouralKeys: [],
      issues: [
        {
          code: CODEX_CODES.invalidSidecar,
          severity: 'error',
          message: `${relativePath} is not valid YAML, so its product configuration cannot be classified as presentation-only`,
          details: [error instanceof Error ? error.message : String(error)],
        },
      ],
    };
  }

  if (parsed === null || parsed === undefined) {
    // An empty sidecar declares nothing, so it cannot declare behaviour.
    return {
      kind: 'INTERFACE_ONLY',
      relativePath,
      topLevelKeys: [],
      behaviouralKeys: [],
      issues: [],
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      kind: 'UNREADABLE',
      relativePath,
      topLevelKeys: [],
      behaviouralKeys: [],
      issues: [
        {
          code: CODEX_CODES.invalidSidecar,
          severity: 'error',
          message: `${relativePath} must be a YAML mapping of product configuration, so this file cannot be preserved as one`,
        },
      ],
    };
  }

  const topLevelKeys = Object.keys(parsed).sort((left, right) => left.localeCompare(right, 'en'));
  const behaviouralKeys = CODEX_BEHAVIOURAL_KEYS.filter((key) => Object.hasOwn(parsed, key));

  if (behaviouralKeys.length === 0) {
    return { kind: 'INTERFACE_ONLY', relativePath, topLevelKeys, behaviouralKeys, issues: [] };
  }

  const issues: SourceIssue[] = [];
  for (const key of behaviouralKeys) {
    if (key === 'policy') {
      issues.push({
        code: CODEX_CODES.unsupportedBehaviour,
        severity: 'error',
        // The SEMANTIC stage, because the package is valid Codex and the gap is
        // the target's inability to express the declaration.
        stage: 'SEMANTIC',
        message:
          'policy controls whether Codex injects this skill into the model context without an explicit mention; the target has no equivalent, so conversion is refused rather than silently carried',
        details: policyKeyNames(parsed['policy']),
      });
    } else {
      issues.push({
        code: CODEX_CODES.unsupportedDependency,
        severity: 'error',
        stage: 'SEMANTIC',
        message:
          'dependencies declares runtime tool requirements that the target does not resolve or satisfy, so conversion is refused rather than producing a package that looks complete but cannot run',
        details: dependencyKeyNames(parsed['dependencies']),
      });
    }
  }

  return { kind: 'BEHAVIOURAL', relativePath, topLevelKeys, behaviouralKeys, issues };
}

/** Sub-keys of a `policy` block, sorted. Never values. */
function policyKeyNames(policy: unknown): string[] {
  if (!isPlainObject(policy)) {
    return [];
  }
  return Object.keys(policy).sort((left, right) => left.localeCompare(right, 'en'));
}

/** Sub-keys of a `dependencies` block, sorted. Never values or URLs. */
function dependencyKeyNames(dependencies: unknown): string[] {
  if (!isPlainObject(dependencies)) {
    return [];
  }
  return Object.keys(dependencies).sort((left, right) => left.localeCompare(right, 'en'));
}

/** Upstream reference line for reports. */
export function codexUpstreamReference(): string {
  return `openai/codex@${CODEX_UPSTREAM_COMMIT.slice(0, 12)}`;
}

/** Distribution corpus reference line for reports. */
export function codexSkillsReference(): string {
  return `openai/skills@${CODEX_SKILLS_COMMIT.slice(0, 12)}`;
}
