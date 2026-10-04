/**
 * The pinned Agent Skills source contract.
 *
 * Every rule the adapter enforces comes from the sources below, read at
 * development time and pinned by commit. Nothing is fetched at run time: the
 * constants here are the whole runtime contract, and no network access happens
 * when a user converts a skill.
 *
 * Primary (the standard and its reference validator):
 *   repository https://github.com/agentskills/agentskills
 *   commit     69ef37e9424c0a7ea9dd2293b559e43ec8176379
 *   files      docs/specification.mdx
 *              skills-ref/src/skills_ref/validator.py
 *              skills-ref/src/skills_ref/parser.py
 *              skills-ref/src/skills_ref/errors.py
 *
 * Secondary (a public implementation, used only as corroborating evidence):
 *   repository https://github.com/anthropics/skills
 *   commit     8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4
 *   files      README.md
 *              skills/skill-creator/SKILL.md
 *              skills/skill-creator/scripts/quick_validate.py
 *
 * Where the two disagree the standard wins, and the disagreement is recorded in
 * `docs/agent-skills-source-contract.md` rather than silently resolved.
 */

/** Identifier used on the command line to select this source. */
export const AGENT_SKILLS_SOURCE_ID = 'agent-skills';

/** Human-readable name of the source format. */
export const AGENT_SKILLS_SOURCE_NAME = 'Agent Skills';

export const AGENT_SKILLS_UPSTREAM_REPOSITORY = 'https://github.com/agentskills/agentskills';
export const AGENT_SKILLS_UPSTREAM_COMMIT = '69ef37e9424c0a7ea9dd2293b559e43ec8176379';

export const ANTHROPIC_SKILLS_REPOSITORY = 'https://github.com/anthropics/skills';
export const ANTHROPIC_SKILLS_COMMIT = '8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4';

/** When the pinned sources above were read. */
export const AGENT_SKILLS_CONTRACT_VERIFIED_AT = '2026-10-04';

/** Files inspected at the pinned commits. */
export const AGENT_SKILLS_CONTRACT_SOURCES: readonly string[] = [
  'docs/specification.mdx',
  'skills-ref/src/skills_ref/validator.py',
  'skills-ref/src/skills_ref/parser.py',
  'skills-ref/src/skills_ref/errors.py',
];

/** Secondary implementation files inspected at the pinned commit. */
export const ANTHROPIC_SKILLS_SOURCES: readonly string[] = [
  'README.md',
  'skills/skill-creator/SKILL.md',
  'skills/skill-creator/scripts/quick_validate.py',
];

/** `MAX_SKILL_NAME_LENGTH` in the reference validator. */
export const AGENT_SKILLS_MAX_NAME_LENGTH = 64;

/** `MAX_DESCRIPTION_LENGTH` in the reference validator. */
export const AGENT_SKILLS_MAX_DESCRIPTION_LENGTH = 1024;

/** `MAX_COMPATIBILITY_LENGTH` in the reference validator. */
export const AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH = 500;

/**
 * Entry file names, in the reference parser's precedence order.
 *
 * `find_skill_md` checks each name exactly, uppercase first. It does not do a
 * case-insensitive lookup, and it does not accept arbitrary Markdown: a directory
 * whose only Markdown is `README.md` has no entry.
 */
export const AGENT_SKILLS_ENTRY_NAMES: readonly string[] = ['SKILL.md', 'skill.md'];

/**
 * Frontmatter fields the specification allows (`ALLOWED_FIELDS` in the reference
 * validator). Any other key is a source contract violation, not a warning.
 */
export const AGENT_SKILLS_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

/** Short upstream reference for display. */
export function agentSkillsUpstreamReference(): string {
  return `agentskills/agentskills@${AGENT_SKILLS_UPSTREAM_COMMIT.slice(0, 12)}`;
}
