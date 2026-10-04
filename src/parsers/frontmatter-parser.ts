/**
 * Parses a YAML frontmatter block from a Markdown document.
 *
 * Frontmatter is optional: a document without it yields empty metadata and the
 * whole document as the body. When a block *is* present it must be valid YAML and
 * must parse to a mapping; anything else is reported as an error rather than
 * silently ignored, because a skill whose metadata was dropped would otherwise be
 * analyzed as if it had none.
 */
import { parseDocument } from 'yaml';

import { FrontmatterError } from '../utils/errors.js';

/** A frontmatter mapping. Values stay `unknown` until something validates them. */
export type SkillFrontmatter = Readonly<Record<string, unknown>>;

export interface FrontmatterResult {
  /** Parsed frontmatter, or an empty object when the document has none. */
  readonly frontmatter: SkillFrontmatter;
  /** The document with the frontmatter block removed. */
  readonly body: string;
  /** Whether a frontmatter block was present at all. */
  readonly hasFrontmatter: boolean;
}

/** Leading frontmatter delimiter. */
const DELIMITER = '---';

/**
 * Normalizes line endings to `\n`.
 *
 * Frontmatter is delimited by line boundaries, so a CRLF document (common when a
 * third-party skill was authored on Windows) must not defeat delimiter detection.
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Converts a parsed YAML document into a frontmatter mapping.
 *
 * @param yamlSource The raw YAML between the delimiters.
 * @throws FrontmatterError when the YAML is invalid, empty of mappings, or not a mapping.
 */
function parseFrontmatterBlock(yamlSource: string): SkillFrontmatter {
  const document = parseDocument(yamlSource, { prettyErrors: false });

  const [issue] = document.errors;
  if (issue !== undefined) {
    throw new FrontmatterError(`Invalid YAML frontmatter: ${issue.message}`);
  }

  const [warning] = document.warnings;
  if (warning !== undefined) {
    // `prettyErrors: false` keeps `message` a plain, single-line string.
    throw new FrontmatterError(`Unusable YAML frontmatter: ${warning.message}`);
  }

  const parsed: unknown = document.toJS();

  // An empty block (`---\n---`) parses to null. That is a present-but-empty
  // frontmatter, which the analyzer reports as missing fields.
  if (parsed === null) {
    return {};
  }

  if (!isRecord(parsed)) {
    const kind = Array.isArray(parsed) ? 'an array' : `a ${typeof parsed}`;
    throw new FrontmatterError(
      `Invalid frontmatter: expected a mapping of keys to values, but the YAML parsed to ${kind}.`,
    );
  }

  return parsed;
}

/**
 * Splits a Markdown document into frontmatter and body.
 *
 * @param content Raw file contents.
 * @returns The frontmatter mapping, the remaining body, and whether frontmatter
 *   was present.
 * @throws FrontmatterError when a present frontmatter block is invalid or unterminated.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');

  if (lines[0]?.trim() !== DELIMITER) {
    return { frontmatter: {}, body: normalized, hasFrontmatter: false };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);
  if (closingIndex === -1) {
    throw new FrontmatterError(
      'Unterminated frontmatter: a leading "---" delimiter has no matching closing "---".',
    );
  }

  const frontmatter = parseFrontmatterBlock(lines.slice(1, closingIndex).join('\n'));
  const body = lines.slice(closingIndex + 1).join('\n');

  return { frontmatter, body, hasFrontmatter: true };
}
