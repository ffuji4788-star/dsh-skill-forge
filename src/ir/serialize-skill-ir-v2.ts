/**
 * Canonical serialization of Universal Skill IR v2.
 *
 * The output is stable by construction: a fixed top-level field order, two-space
 * indentation, LF line endings, one trailing newline, and recursively sorted keys
 * inside `semantics` and `source.extraFrontmatter`. Two semantically equal inputs
 * therefore produce byte-identical output, which is what makes the document
 * diffable and safe to commit.
 *
 * The v1 serializer is untouched; this is a separate function for a separate
 * schema.
 */
import { toCanonicalJson, type JsonObject } from './json-value.js';
import { validateSkillIRV2, type SkillIRV2 } from './skill-ir-v2.js';

/**
 * Serializes IR v2 as canonical JSON text.
 *
 * Top-level order is fixed: `schemaVersion`, `name`, `description`,
 * `instructions`, `resources`, `semantics`, `source`. Nested objects are
 * canonicalized (keys sorted) so the document cannot depend on insertion order.
 *
 * @param ir Valid IR v2.
 * @returns Canonical JSON ending with exactly one newline.
 * @throws Error when the value is not valid IR v2.
 */
export function serializeSkillIRV2(ir: SkillIRV2): string {
  const problems = validateSkillIRV2(ir);
  if (problems.length > 0) {
    throw new Error(`Refusing to serialize invalid IR v2: ${problems.join('; ')}`);
  }

  const canonicalSemantics = toCanonicalJson(ir.semantics, 'semantics');
  if ('problem' in canonicalSemantics) {
    throw new Error(
      `Refusing to serialize IR v2: ${canonicalSemantics.problem.path}: ${canonicalSemantics.problem.reason}`,
    );
  }

  const canonicalExtra = toCanonicalJson(ir.source.extraFrontmatter, 'source.extraFrontmatter');
  if ('problem' in canonicalExtra) {
    throw new Error(
      `Refusing to serialize IR v2: ${canonicalExtra.problem.path}: ${canonicalExtra.problem.reason}`,
    );
  }

  const ordered = {
    schemaVersion: ir.schemaVersion,
    name: ir.name,
    description: ir.description,
    instructions: ir.instructions,
    resources: [...ir.resources],
    semantics: canonicalSemantics.value as JsonObject,
    source: {
      format: ir.source.format,
      entryFile: ir.source.entryFile,
      extraFrontmatter: canonicalExtra.value as JsonObject,
    },
  };

  return `${JSON.stringify(ordered, null, 2)}\n`;
}
