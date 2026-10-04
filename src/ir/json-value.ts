/**
 * JSON-safe value handling for the Universal Skill IR.
 *
 * The IR must serialize to JSON without surprises, so unsupported values are
 * detected and reported instead of being coerced. Nothing here silently turns an
 * object into `"[object Object]"`.
 */

/** A value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object with sorted keys. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Where an unsupported value was found, for an actionable message. */
export interface JsonSafetyProblem {
  readonly path: string;
  readonly reason: string;
}

function canBePropertyKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/**
 * Reports whether a value is an ordinary object literal.
 *
 * Only plain objects are walked. A `Date`, a class instance or a null-prototype
 * object has no enumerable own data, so treating it as a plain object would emit
 * `{}` and silently lose the value. Requiring `Object.prototype` also guarantees
 * the value is ordinary data rather than a constructed wrapper.
 */
function isPlainObject(value: object): boolean {
  return Object.getPrototypeOf(value) === Object.prototype;
}

/** Names a non-plain object for an error message, without assuming a shape. */
function constructorNameOf(value: object): string {
  const name: unknown = (value as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'value';
}

/**
 * Converts a value into a JSON-safe value with lexicographically sorted object
 * keys, or explains why it cannot be represented.
 *
 * Arrays keep their order: array order may be meaningful, so it is never sorted.
 * Object keys are sorted recursively, so two semantically equal inputs with
 * different key insertion order produce the same canonical value.
 *
 * @param value Value to convert.
 * @param path Location used in problem messages.
 * @param seen Objects already on the current path, used to detect cycles.
 * @returns The canonical value, or the problem that prevented conversion.
 */
export function toCanonicalJson(
  value: unknown,
  path = '$',
  seen: ReadonlySet<object> = new Set<object>(),
): { readonly value: JsonValue } | { readonly problem: JsonSafetyProblem } {
  if (value === null) {
    return { value: null };
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return { value };
    case 'number':
      if (!Number.isFinite(value)) {
        return { problem: { path, reason: 'number must be finite to be JSON-safe' } };
      }
      return { value };
    case 'undefined':
      return { problem: { path, reason: 'undefined is not JSON-safe' } };
    case 'bigint':
      return { problem: { path, reason: 'bigint is not JSON-safe' } };
    case 'function':
      return { problem: { path, reason: 'functions are not JSON-safe' } };
    case 'symbol':
      return { problem: { path, reason: 'symbols are not JSON-safe' } };
    default:
      break;
  }

  if (seen.has(value)) {
    return { problem: { path, reason: 'circular reference' } };
  }
  const nestedSeen = new Set(seen);
  nestedSeen.add(value);

  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const [index, item] of value.entries()) {
      const converted = toCanonicalJson(item, `${path}[${index}]`, nestedSeen);
      if ('problem' in converted) {
        return converted;
      }
      items.push(converted.value);
    }
    return { value: items };
  }

  if (value instanceof Map || value instanceof Set) {
    return { problem: { path, reason: 'Map and Set are not JSON-safe' } };
  }

  if (!isPlainObject(value)) {
    return {
      problem: {
        path,
        reason: `${constructorNameOf(value)} is not a plain object, so it cannot be represented without losing data`,
      },
    };
  }

  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'))) {
    if (!canBePropertyKey(key)) {
      return { problem: { path: `${path}.${key}`, reason: `"${key}" is not a safe JSON key` } };
    }
    const converted = toCanonicalJson(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      nestedSeen,
    );
    if ('problem' in converted) {
      return converted;
    }
    result[key] = converted.value;
  }
  return { value: result };
}

/**
 * Reports whether a value can be represented as JSON, without converting it.
 *
 * @param value Value to inspect.
 */
export function isJsonSafe(value: unknown): boolean {
  return 'value' in toCanonicalJson(value);
}
