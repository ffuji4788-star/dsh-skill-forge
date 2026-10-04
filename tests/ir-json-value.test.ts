/**
 * Canonical JSON conversion.
 *
 * The rule is: represent it faithfully, or reject it. A value that would be
 * silently reduced to `{}` is a data-loss bug, not a lenient success.
 */
import { describe, expect, it } from 'vitest';

import { isJsonSafe, toCanonicalJson } from '../src/ir/json-value.js';

function problemOf(value: unknown): string | undefined {
  const result = toCanonicalJson(value);
  return 'problem' in result ? result.problem.reason : undefined;
}

function valueOf(value: unknown): unknown {
  const result = toCanonicalJson(value);
  return 'value' in result ? result.value : undefined;
}

describe('accepted values', () => {
  it.each([
    ['a string', 'text', 'text'],
    ['a boolean', true, true],
    ['null', null, null],
    ['an integer', 7, 7],
    ['a finite float', 1.5, 1.5],
    ['zero', 0, 0],
  ])('accepts %s', (_label, input, expected) => {
    expect(valueOf(input)).toBe(expected);
  });

  it('accepts plain nested objects and arrays', () => {
    expect(valueOf({ b: 1, a: [1, 'two', false, null] })).toEqual({
      a: [1, 'two', false, null],
      b: 1,
    });
  });

  it('sorts object keys recursively but preserves array order', () => {
    expect(valueOf({ z: { b: 1, a: 2 }, a: [3, 1, 2] })).toEqual({
      a: [3, 1, 2],
      z: { a: 2, b: 1 },
    });
  });
});

describe('rejected values', () => {
  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
    ['a bigint', 10n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a Map', new Map([['a', 1]])],
    ['a Set', new Set([1])],
  ])('rejects %s', (_label, input) => {
    expect(problemOf(input)).toBeTypeOf('string');
    expect(isJsonSafe(input)).toBe(false);
  });

  it('rejects a Date rather than reducing it to an empty object', () => {
    // `Object.keys(new Date())` is empty, so a permissive walk would emit `{}`
    // and silently lose the value.
    expect(problemOf(new Date(0))).toContain('plain object');
    expect(isJsonSafe(new Date(0))).toBe(false);
  });

  it('rejects a class instance', () => {
    class Widget {
      readonly x = 1;
    }

    expect(problemOf(new Widget())).toContain('plain object');
    expect(isJsonSafe(new Widget())).toBe(false);
  });

  it('rejects an object built with a null prototype as a value', () => {
    // Valid JSON objects always have Object.prototype; a null-prototype object
    // cannot be produced by JSON.parse, so accepting it would be speculative.
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype['a'] = 1;

    expect(problemOf(nullPrototype)).toContain('plain object');
  });

  it('rejects nested unsupported values and names the path', () => {
    const result = toCanonicalJson({ outer: { inner: [1, () => 1] } });

    expect('problem' in result && result.problem.path).toBe('$.outer.inner[1]');
  });

  it('rejects a circular reference', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;

    expect(problemOf(circular)).toContain('circular');
  });

  it.each([['__proto__'], ['constructor'], ['prototype']])('rejects the unsafe key %s', (key) => {
    const value = JSON.parse(`{"${key}": 1}`) as unknown;

    expect(problemOf(value)).toContain('not a safe JSON key');
  });

  it('accepts the same key nested inside a safe object', () => {
    expect(problemOf({ nested: JSON.parse('{"__proto__": 1}') as unknown })).toContain(
      'not a safe JSON key',
    );
  });
});
