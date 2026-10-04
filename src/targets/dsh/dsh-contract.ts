/**
 * The pinned DeepSeek Harness compatibility contract.
 *
 * Target-specific by design: DeepSeek Harness is a developer preview, so these
 * rules are pinned to one upstream revision and live here, isolated from the
 * generic analyzer and validator. When upstream changes, only this directory
 * and its tests should need updating.
 *
 * The rules below were derived from the upstream *source and official tests*,
 * not from documentation alone. See `docs/dsh-compatibility-contract.md` for the
 * provenance record.
 */

/** Identifier of the target this profile describes. */
export const DSH_TARGET_ID = 'deepseek-harness';

/** Human-readable target name for reports. */
export const DSH_TARGET_NAME = 'DeepSeek Harness';

/** Upstream repository the contract was derived from. */
export const DSH_UPSTREAM_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness';

/** Upstream revision this profile is pinned to. */
export const DSH_UPSTREAM_COMMIT = '5badb15009ae1756c3afe0ae0cef1faafc290ccc';

/** Date the pinned revision was inspected (YYYY-MM-DD, UTC). */
export const DSH_CONTRACT_VERIFIED_AT = '2026-10-04';

/** Upstream files the rules were read from. */
export const DSH_CONTRACT_SOURCES: readonly string[] = [
  'packages/skill/skill/src/index.ts',
  'packages/skill/skill-filesystem/src/index.ts',
  'packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts',
  'packages/skill/skill-filesystem/README.md',
  'docs/subsystems/skills.md',
];

/** Short form of the pinned commit, for report output. */
export function dshUpstreamShortCommit(): string {
  return DSH_UPSTREAM_COMMIT.slice(0, 12);
}

/**
 * The exact skill-name pattern the pinned provider enforces.
 *
 * Upstream: `const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` in
 * `packages/skill/skill/src/index.ts`, applied by `validateDefinition` and by the
 * filesystem provider before a skill is accepted.
 */
export const DSH_SKILL_NAME_PATTERN: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Frontmatter keys the pinned provider reads. */
export const DSH_KNOWN_FRONTMATTER_KEYS: readonly string[] = [
  'name',
  'description',
  'whenToUse',
  'metadata',
  'disable-model-invocation',
  'user-invocable',
];

/** Legacy invocation keys the pinned provider explicitly rejects. */
export const DSH_LEGACY_INVOCATION_KEYS: ReadonlyMap<string, string> = new Map([
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
]);

/**
 * Accepted spellings for the invocation booleans.
 *
 * Upstream `frontmatterBoolean` accepts a real boolean, the numbers `1` and `0`,
 * their string forms, and the case-insensitive words below.
 */
export const DSH_BOOLEAN_TRUE_WORDS: readonly string[] = ['true', 'yes', 'on'];
export const DSH_BOOLEAN_FALSE_WORDS: readonly string[] = ['false', 'no', 'off'];

/**
 * The discovery shape the pinned filesystem provider implements.
 *
 * Recorded here so compatibility reports can state what was verified instead of
 * implying that an arbitrary nested `**\/SKILL.md` would be discovered.
 */
export const DSH_DISCOVERY_SHAPES: readonly string[] = [
  '<scanned-root>/<name>/SKILL.md',
  '<scanned-root>/<name>.md',
];
