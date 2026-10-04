/**
 * Canonical serialization of Universal Skill IR v1.
 *
 * One serializer owns the byte-level contract, so the CLI never calls
 * `JSON.stringify` on an ad-hoc object. The output is stable: explicit field
 * order, two-space indentation, LF line endings, a final newline, and nested
 * objects whose keys are already canonicalized.
 */
import { validateSkillIR, type SkillIR } from './skill-ir.js';

/**
 * Serializes IR to its canonical JSON form.
 *
 * Top-level field order is fixed by construction so the format does not depend
 * on object insertion order.
 *
 * @param ir The IR to serialize.
 * @returns Canonical JSON text ending with a newline.
 * @throws Error when the value is not valid IR v1.
 */
export function serializeSkillIR(ir: SkillIR): string {
  const problems = validateSkillIR(ir);
  if (problems.length > 0) {
    throw new Error(`Refusing to serialize invalid Universal Skill IR: ${problems.join('; ')}`);
  }

  const ordered = {
    schemaVersion: ir.schemaVersion,
    name: ir.name,
    description: ir.description,
    instructions: ir.instructions,
    resources: [...ir.resources],
    source: {
      format: ir.source.format,
      entryFile: ir.source.entryFile,
      extraFrontmatter: ir.source.extraFrontmatter,
    },
  };

  // `JSON.stringify` preserves the property order of `ordered` and of the
  // already-sorted `extraFrontmatter`, and escapes non-ASCII safely.
  const text = JSON.stringify(ordered, null, 2).replace(/\r\n?/g, '\n');
  return `${text}\n`;
}
