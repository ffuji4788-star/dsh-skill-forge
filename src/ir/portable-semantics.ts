/**
 * Portable skill semantics.
 *
 * A *portable* semantic is package-level information about a skill that is not
 * tied to one platform's invocation mechanics: what the skill is licensed under,
 * what environment it needs, and arbitrary descriptive metadata.
 *
 * The type is deliberately curated. A field belongs here only when both sides of
 * a mapping can be proven to mean the same thing — see
 * `docs/skill-ir-v2.md` for the evidence behind each one. Fields that are a
 * vocabulary owned by one ecosystem (Agent Skills `allowed-tools`, for example)
 * stay in the source envelope instead.
 *
 * This module performs no interpretation of any source vocabulary. A source
 * adapter decides what is portable; this module only validates and canonicalizes
 * what it is handed.
 */
import { toCanonicalJson, type JsonObject } from './json-value.js';

/** The portable fields Universal Skill IR v2 understands. */
export const PORTABLE_SEMANTIC_FIELDS: readonly string[] = ['license', 'compatibility', 'metadata'];

/** Fields that describe a skill package rather than a target's invocation mechanics. */
export interface PortableSemantics {
  /** License name or reference to a bundled license file. Verbatim; never evaluated. */
  readonly license?: string;
  /** Declarative environment or runtime requirements. Verbatim; never parsed. */
  readonly compatibility?: string;
  /** Arbitrary string key/value pairs. Keys stored in canonical (sorted) order. */
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Why a value cannot be portable semantics. */
export interface SemanticsProblem {
  /** Field path, for example `semantics.metadata`. */
  readonly path: string;
  readonly reason: string;
}

/** A JSON object of portable semantics, as stored in IR v2. */
export type SerializedSemantics = JsonObject;

/**
 * Validates a candidate `semantics` value.
 *
 * `license` and `compatibility` must be strings exactly as the source contract
 * validated them. `metadata` must be an object whose keys and values are both
 * strings: a non-string value would be silently coerced by some parsers, and a
 * coercion is a loss.
 *
 * @param value Candidate value.
 * @param basePath Path prefix used in problem messages.
 * @returns Problems; empty when the value is valid portable semantics.
 */
export function validatePortableSemantics(
  value: unknown,
  basePath = 'semantics',
): SemanticsProblem[] {
  const problems: SemanticsProblem[] = [];

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: basePath, reason: 'must be an object' }];
  }

  const record = value as Record<string, unknown>;

  for (const field of Object.keys(record)) {
    if (!PORTABLE_SEMANTIC_FIELDS.includes(field)) {
      problems.push({
        path: `${basePath}.${field}`,
        reason: `is not a portable semantic field (allowed: ${PORTABLE_SEMANTIC_FIELDS.join(', ')})`,
      });
    }
  }

  for (const field of ['license', 'compatibility'] as const) {
    if (!(field in record)) {
      continue;
    }
    const fieldValue = record[field];
    if (typeof fieldValue !== 'string') {
      problems.push({ path: `${basePath}.${field}`, reason: 'must be a string' });
    }
  }

  if ('metadata' in record) {
    const metadata = record['metadata'];
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      problems.push({ path: `${basePath}.metadata`, reason: 'must be an object' });
    } else {
      for (const [key, entry] of Object.entries(metadata as Record<string, unknown>)) {
        if (typeof entry !== 'string') {
          problems.push({
            path: `${basePath}.metadata.${key}`,
            reason: 'must be a string',
          });
        }
      }
    }
  }

  return problems;
}

/**
 * Converts validated semantics into a canonical JSON object.
 *
 * Keys are sorted recursively so two semantically equal inputs serialize
 * identically. Values are never coerced, renamed, lowercased or trimmed.
 *
 * @param semantics Portable semantics.
 * @returns Canonical JSON, or the problems that prevented conversion.
 */
export function toSerializedSemantics(
  semantics: PortableSemantics,
): { readonly value: SerializedSemantics } | { readonly problems: readonly SemanticsProblem[] } {
  const problems = validatePortableSemantics(semantics);
  if (problems.length > 0) {
    return { problems };
  }

  // Keys with `undefined` values are omitted rather than serialized as null, so an
  // absent field and an explicitly absent field are the same thing.
  const present: Record<string, unknown> = {};
  for (const field of PORTABLE_SEMANTIC_FIELDS) {
    const fieldValue = (semantics as Record<string, unknown>)[field];
    if (fieldValue !== undefined) {
      present[field] = fieldValue;
    }
  }

  const converted = toCanonicalJson(present, 'semantics');
  if ('problem' in converted) {
    return { problems: [{ path: converted.problem.path, reason: converted.problem.reason }] };
  }

  return { value: converted.value as SerializedSemantics };
}
