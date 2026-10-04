/**
 * Renders a value of unknown type as a human-readable message.
 *
 * Used at error boundaries (the CLI entry point and test helpers) where the
 * caught value is genuinely unknown: TypeScript's `useUnknownInCatchVariables`
 * is enabled, so narrowing here keeps error reporting explicit instead of
 * relying on an unchecked cast.
 *
 * @param value Any thrown or caught value.
 * @returns The value's `message` when it is an `Error`, its string form, or a
 * `JSON.stringify` rendering for other values, falling back to `String(value)`
 * when the value is not JSON-serializable.
 */
export function formatErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    // Circular or otherwise non-serializable values: a plain String() rendering
    // is still more useful than hiding the failure.
    return String(value);
  }
}
