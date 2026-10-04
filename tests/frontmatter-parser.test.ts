import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../src/parsers/frontmatter-parser.js';
import { FrontmatterError } from '../src/utils/errors.js';

describe('parseFrontmatter', () => {
  it('splits a standard frontmatter block from the body', () => {
    const result = parseFrontmatter(
      '---\nname: example\ndescription: Example\n---\n\n# Title\n\nBody\n',
    );

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({ name: 'example', description: 'Example' });
    expect(result.body).toBe('\n# Title\n\nBody\n');
  });

  it('treats a document without frontmatter as all body', () => {
    const content = '# Just Markdown\n\nNo metadata here.\n';
    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  it('does not treat a later horizontal rule as frontmatter', () => {
    const content = '# Title\n\n---\n\nAfter the rule.\n';
    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.body).toBe(content);
  });

  it('accepts an empty frontmatter block as present but empty', () => {
    const result = parseFrontmatter('---\n---\nBody\n');

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Body\n');
  });

  it('parses a block containing only comments and blanks as empty', () => {
    const result = parseFrontmatter('---\n# only a comment\n\n---\nBody\n');

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({});
  });

  it('reports an empty body without inventing content', () => {
    const result = parseFrontmatter('---\nname: only-frontmatter\n---\n');

    expect(result.frontmatter).toEqual({ name: 'only-frontmatter' });
    expect(result.body).toBe('');
  });

  it('normalizes CRLF documents so the delimiters are still recognized', () => {
    const result = parseFrontmatter('---\r\nname: crlf-skill\r\n---\r\n\r\n# Body\r\n');

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toEqual({ name: 'crlf-skill' });
    expect(result.body).toBe('\n# Body\n');
    expect(result.body).not.toContain('\r');
  });

  it('reports invalid YAML instead of silently ignoring it', () => {
    expect(() => parseFrontmatter('---\ntags: [unclosed\n---\nBody\n')).toThrow(FrontmatterError);
    expect(() => parseFrontmatter('---\ntags: [unclosed\n---\nBody\n')).toThrow(/Invalid YAML/);
  });

  it('reports an unterminated frontmatter block', () => {
    expect(() => parseFrontmatter('---\nname: example\n\n# never closed\n')).toThrow(
      /Unterminated frontmatter/,
    );
  });

  it('rejects a frontmatter block that parses to a sequence', () => {
    expect(() => parseFrontmatter('---\n- one\n- two\n---\nBody\n')).toThrow(
      /expected a mapping of keys to values, but the YAML parsed to an array/,
    );
  });

  it('rejects a frontmatter block that parses to a scalar', () => {
    expect(() => parseFrontmatter('---\njust a string\n---\nBody\n')).toThrow(
      /the YAML parsed to a string/,
    );
  });

  it('keeps unknown keys as-is rather than dropping them', () => {
    const result = parseFrontmatter('---\nname: x\ncustom:\n  nested: true\ncount: 3\n---\nB\n');

    expect(result.frontmatter).toEqual({ name: 'x', custom: { nested: true }, count: 3 });
    expect(result.body).toBe('B\n');
  });

  it('preserves document order of frontmatter keys', () => {
    const result = parseFrontmatter('---\nzeta: 1\nalpha: 2\nmiddle: 3\n---\nB\n');

    expect(Object.keys(result.frontmatter)).toEqual(['zeta', 'alpha', 'middle']);
  });

  it('refuses YAML tags instead of evaluating them', () => {
    // An unresolved `!!js/function` tag must never become a callable value; the
    // parser rejects the document so a tag cannot smuggle behaviour into analysis.
    expect(() =>
      parseFrontmatter('---\nname: tagged\nevil: !!js/function "return 1"\n---\nB\n'),
    ).toThrow(FrontmatterError);
    expect(() =>
      parseFrontmatter('---\nname: tagged\nevil: !!js/function "return 1"\n---\nB\n'),
    ).toThrow(/Unresolved tag/);
  });
});
