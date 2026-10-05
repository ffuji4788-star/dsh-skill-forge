/**
 * The tool-owned metadata preservation envelope.
 *
 * DSH has **no native license semantic**. Its `metadata` field is documented as
 * provider-specific frontmatter that the registry carries and never reads, which
 * makes it a safe place to *preserve* a declaration without claiming to
 * understand it.
 *
 * So this is **preservation, not mapping**:
 *
 * - a license declaration (`Apache-2.0`, `Proprietary. LICENSE.txt has complete
 *   terms`, …) is copied verbatim into a namespaced envelope;
 * - DSH never interprets it, and neither do we: no SPDX parsing, no license-file
 *   lookup, no compliance judgement, no legal conclusion;
 * - the envelope is versioned, so a future change has an upgrade path rather than
 *   an ambiguity.
 *
 * Why a license may be carried opaquely but `compatibility` and `allowed-tools`
 * may not: a license declaration does not govern instructions, routing,
 * permissions or invocation, so carrying it cannot change how a skill behaves.
 * `compatibility` describes runtime and environment requirements, and
 * `allowed-tools` describes pre-approved permissions — both are behavioural, so
 * carrying them into a target that does not act on them would silently change
 * meaning. Those still refuse.
 */
import { toCanonicalJson, type JsonObject } from '../../ir/json-value.js';
import type { PortableSemantics } from '../../ir/portable-semantics.js';

/**
 * Metadata key owned by this tool.
 *
 * A fixed, documented, versioned namespace. Source metadata that already uses it
 * is refused rather than merged, because overwriting or guessing would destroy
 * source data.
 */
export const DSH_SKILL_FORGE_METADATA_NAMESPACE = 'dsh-skill-forge';

/** Version of the envelope structure. Bump only with a documented migration. */
export const DSH_PRESERVATION_VERSION = 1;

/** Semantic fields this envelope can preserve opaquely. */
export const PRESERVABLE_SEMANTIC_FIELDS: readonly string[] = ['license'];

/** The exact envelope written under the namespace key. */
export interface DshPreservationEnvelope {
  readonly preservationVersion: number;
  /** Field name to its exact original string value. */
  readonly preservedSemantics: Readonly<Record<string, string>>;
}

/** Why a metadata envelope cannot be built. */
export interface MetadataBuildProblem {
  readonly code: 'TARGET_METADATA_NAMESPACE_COLLISION' | 'UNREPRESENTABLE_METADATA';
  readonly message: string;
}

export type DshMetadataBuild =
  | {
      readonly ok: true;
      readonly metadata: JsonObject;
      readonly preservedFields: readonly string[];
    }
  | { readonly ok: false; readonly problems: readonly MetadataBuildProblem[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the DSH `metadata` object: native metadata plus, when there is something
 * to preserve, the tool-owned envelope.
 *
 * Deterministic by construction: keys are canonicalized (sorted recursively) and
 * the envelope has a fixed field order, so the same input always produces the
 * same object and therefore the same YAML bytes.
 *
 * @param semantics Portable semantics the source interpreted.
 * @returns The metadata object, or the problems that prevented building one.
 */
export function buildDshMetadata(semantics: PortableSemantics): DshMetadataBuild {
  const native = isPlainObject(semantics.metadata) ? { ...semantics.metadata } : {};

  // A source that already uses our namespace is refused: merging would either
  // overwrite source data or guess at a structure we do not own.
  if (Object.hasOwn(native, DSH_SKILL_FORGE_METADATA_NAMESPACE)) {
    return {
      ok: false,
      problems: [
        {
          code: 'TARGET_METADATA_NAMESPACE_COLLISION',
          message: `Source metadata already uses the reserved key "${DSH_SKILL_FORGE_METADATA_NAMESPACE}", which this tool owns, so it is not overwritten or merged`,
        },
      ],
    };
  }

  const preserved: Record<string, string> = {};
  for (const field of PRESERVABLE_SEMANTIC_FIELDS) {
    const value = (semantics as Record<string, unknown>)[field];
    if (typeof value === 'string') {
      // Verbatim: no trim, no lowercase, no rewrite, no reinterpretation.
      preserved[field] = value;
    }
  }

  const preservedFields = Object.keys(preserved).sort((left, right) =>
    left.localeCompare(right, 'en'),
  );
  const combined: Record<string, unknown> = { ...native };

  if (preservedFields.length > 0) {
    const envelope: DshPreservationEnvelope = {
      preservationVersion: DSH_PRESERVATION_VERSION,
      preservedSemantics: preserved,
    };
    combined[DSH_SKILL_FORGE_METADATA_NAMESPACE] = envelope;
  }

  const canonical = toCanonicalJson(combined, 'metadata');
  if ('problem' in canonical) {
    return {
      ok: false,
      problems: [
        {
          code: 'UNREPRESENTABLE_METADATA',
          message: `${canonical.problem.path}: ${canonical.problem.reason}`,
        },
      ],
    };
  }

  return { ok: true, metadata: canonical.value as JsonObject, preservedFields };
}

/**
 * Reads back the preserved semantic fields from a generated `metadata` object.
 *
 * Exists so a test can assert an exact round-trip rather than eyeballing YAML.
 *
 * @param metadata A generated metadata object.
 * @returns Preserved field name to value; empty when there is no envelope.
 */
export function readPreservedSemantics(metadata: unknown): Record<string, string> {
  if (!isPlainObject(metadata)) {
    return {};
  }
  const envelope = metadata[DSH_SKILL_FORGE_METADATA_NAMESPACE];
  if (!isPlainObject(envelope)) {
    return {};
  }
  const preserved = envelope['preservedSemantics'];
  if (!isPlainObject(preserved)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(preserved)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Reports whether a generated package carries a preservation envelope.
 *
 * @param metadata A generated metadata object.
 */
export function hasPreservationEnvelope(metadata: unknown): boolean {
  if (!isPlainObject(metadata)) {
    return false;
  }
  const envelope = metadata[DSH_SKILL_FORGE_METADATA_NAMESPACE];
  return isPlainObject(envelope) && envelope['preservationVersion'] === DSH_PRESERVATION_VERSION;
}
