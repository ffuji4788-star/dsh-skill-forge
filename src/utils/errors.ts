/**
 * Error types for expected, reportable failures.
 *
 * The CLI separates these from unexpected crashes: a `ForgeError` is something
 * the user can act on (a wrong path, ambiguous input, malformed frontmatter) and
 * is reported as a single readable line with a non-zero exit code, without a
 * stack trace.
 */
export class ForgeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ForgeError';
  }
}

/** The input path is missing, unreadable, or not a usable skill source. */
export class SkillInputError extends ForgeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SkillInputError';
  }
}

/** A directory holds more than one possible Markdown skill entry point. */
export class AmbiguousSkillError extends ForgeError {
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousSkillError';
  }
}

/** The frontmatter block is present but cannot be used as a metadata object. */
export class FrontmatterError extends ForgeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FrontmatterError';
  }
}
