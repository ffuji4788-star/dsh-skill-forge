import { describe, expect, it } from 'vitest';

import { formatErrorMessage } from '../src/utils/error-message.js';

describe('formatErrorMessage', () => {
  it('returns the message of an Error', () => {
    expect(formatErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('prefers the message of Error subclasses, including TypeError', () => {
    expect(formatErrorMessage(new TypeError('bad type'))).toBe('bad type');
  });

  it('returns a thrown string unchanged', () => {
    expect(formatErrorMessage('plain failure')).toBe('plain failure');
  });

  it('serializes non-Error values as JSON', () => {
    expect(formatErrorMessage({ code: 'E_FAIL', detail: 42 })).toBe(
      '{"code":"E_FAIL","detail":42}',
    );
  });

  it('falls back to String() for values that cannot be serialized as JSON', () => {
    expect(formatErrorMessage(undefined)).toBe('undefined');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatErrorMessage(circular)).toBe('[object Object]');
  });
});
