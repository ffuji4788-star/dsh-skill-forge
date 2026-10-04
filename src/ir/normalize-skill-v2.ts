/**
 * Deterministic normalization of a parsed skill into Universal Skill IR v2.
 *
 * The difference from v1 is one step: a source adapter may hand in *portable
 * semantics* it has interpreted from its own vocabulary, and those fields are
 * promoted out of the source envelope into `semantics`. Nothing else changes —
 * the core fields, resources and source envelope are built exactly as v1 builds
 * them, and a skill with no portable semantics normalizes to an empty
 * `semantics` object rather than to something invented.
 *
 * This module never inspects source-specific vocabulary. It cannot tell an Agent
 * Skills document from any other; deciding what is portable is the adapter's job,
 * which keeps target and source knowledge out of the IR layer.
 *
 * It only reads and transforms in memory: no filesystem work, no execution, no
 * network.
 */
import path from 'node:path';

import type { ParsedSkill } from '../schemas/skill.js';
import { SkillIRError, normalizeEntryFile, normalizeResourcePath } from './normalize-skill.js';
import { toSerializedSemantics, type PortableSemantics } from './portable-semantics.js';
import { toCanonicalJson, type JsonObject } from './json-value.js';
import {
  GENERIC_LOCAL_SKILL_FORMAT,
  SKILL_IR_V2_SCHEMA_VERSION,
  validateSkillIRV2,
  type SkillIRV2,
} from './skill-ir-v2.js';

/** Universal core fields: the ones with meaning in every skill system. */
const UNIVERSAL_CORE_FIELDS: readonly string[] = ['name', 'description'];

/** How a skill was read, for the v2 provenance envelope. */
export interface SourceProvenance {
  /** `source.format` value, for example `agent-skills`. */
  readonly format: string;
  /**
   * Portable semantics the source adapter interpreted.
   *
   * Omitted when the source offers no semantic interpretation at all, which is
   * how the generic local path stays byte-compatible with v1: with no semantics
   * handed in, every non-core key remains raw source data in the envelope.
   */
  readonly semantics?: PortableSemantics;
}

function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function normalizeResources(resources: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const resource of resources) {
    const candidate = normalizeResourcePath(resource);
    if (candidate !== undefined) {
      normalized.add(candidate);
    }
  }
  // Sorted so filesystem enumeration order cannot influence the result.
  return [...normalized].sort((left, right) => left.localeCompare(right, 'en'));
}

/**
 * Builds the v2 source envelope.
 *
 * Every non-core field is preserved. A field that was promoted into `semantics`
 * is *moved*, not copied: keeping it in both places would let one fact disagree
 * with itself.
 *
 * @param skill The parsed skill.
 * @param provenance Source format and portable semantics.
 * @param rootPath Absolute skill root directory.
 * @throws SkillIRError when a value cannot be represented as JSON.
 */
function buildSourceEnvelope(
  skill: ParsedSkill,
  provenance: SourceProvenance,
  rootPath: string,
): SkillIRV2['source'] {
  const promoted = new Set(Object.keys(provenance.semantics ?? {}));
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(skill.frontmatter)) {
    if (!UNIVERSAL_CORE_FIELDS.includes(key) && !promoted.has(key)) {
      extra[key] = value;
    }
  }

  const converted = toCanonicalJson(extra, 'source.extraFrontmatter');
  if ('problem' in converted) {
    throw new SkillIRError([`${converted.problem.path}: ${converted.problem.reason}`]);
  }

  return {
    format: provenance.format,
    entryFile: normalizeEntryFile(skill.entryFile, rootPath),
    extraFrontmatter: converted.value as JsonObject,
  };
}

/**
 * Converts an already-validated skill into Universal Skill IR v2.
 *
 * @param skill A skill that already passed generic structural validation.
 * @param provenance Source format and any portable semantics the adapter interpreted.
 * @param rootPath Absolute skill root directory, used to relativize the entry file.
 * @returns The IR, verified against the v2 schema before it is returned.
 * @throws SkillIRError when a frontmatter value is not JSON-safe or a semantic is invalid.
 */
export function toSkillIRV2(
  skill: ParsedSkill,
  provenance: SourceProvenance,
  rootPath: string = path.dirname(skill.entryFile),
): SkillIRV2 {
  if (skill.name === undefined || skill.description === undefined) {
    throw new SkillIRError(['name and description are required to build IR']);
  }

  const serialized = toSerializedSemantics(provenance.semantics ?? {});
  if ('problems' in serialized) {
    throw new SkillIRError(serialized.problems.map((entry) => `${entry.path}: ${entry.reason}`));
  }

  const ir: SkillIRV2 = {
    schemaVersion: SKILL_IR_V2_SCHEMA_VERSION,
    name: skill.name,
    description: skill.description,
    instructions: toLf(skill.body),
    resources: normalizeResources(skill.resources),
    semantics: serialized.value,
    source: buildSourceEnvelope(skill, provenance, rootPath),
  };

  // The IR must satisfy its own contract; a normalizer bug must not be able to
  // emit a shape that merely resembles it.
  const problems = validateSkillIRV2(ir);
  if (problems.length > 0) {
    throw new SkillIRError(problems);
  }

  return ir;
}

/** Provenance for a skill read without a source contract. */
export const GENERIC_PROVENANCE: SourceProvenance = { format: GENERIC_LOCAL_SKILL_FORMAT };
