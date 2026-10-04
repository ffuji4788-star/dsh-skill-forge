/**
 * The invocation-policy rules of the pinned DSH contract.
 *
 * Mirrors upstream `parseInvocationPolicy` / `frontmatterBoolean` and the
 * official test `accepts the documented boolean spellings for invocation
 * frontmatter`.
 */
import { describe, expect, it } from 'vitest';

import {
  defaultDshInvocationPolicy,
  parseDshFrontmatterBoolean,
  resolveDshInvocationPolicy,
} from '../src/targets/dsh/dsh-invocation-policy.js';

describe('parseDshFrontmatterBoolean', () => {
  it.each([
    [true, true],
    [1, true],
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['True', true],
    ['yes', true],
    ['YES', true],
    ['on', true],
    ['ON', true],
    [false, false],
    [0, false],
    ['0', false],
    ['false', false],
    ['FALSE', false],
    ['no', false],
    ['NO', false],
    ['off', false],
    ['OFF', false],
  ])('accepts %j as %s', (value, expected) => {
    expect(parseDshFrontmatterBoolean(value)).toBe(expected);
  });

  it.each([
    ['maybe'],
    [''],
    [' '],
    ['2'],
    [2],
    ['yes!'],
    ['truthy'],
    [null],
    [[]],
    [{}],
    [['true']],
  ])('rejects %j', (value) => {
    expect(parseDshFrontmatterBoolean(value)).toBeUndefined();
  });
});

describe('resolveDshInvocationPolicy', () => {
  it('permits both surfaces when the fields are omitted', () => {
    const { policy, problems } = resolveDshInvocationPolicy({});

    expect(policy).toEqual({ modelInvocable: true, userInvocable: true });
    expect(problems).toEqual([]);
    expect(policy).toEqual(defaultDshInvocationPolicy());
  });

  it('maps disable-model-invocation: true to a model-invisible skill', () => {
    const { policy, problems } = resolveDshInvocationPolicy({ 'disable-model-invocation': true });

    expect(policy).toEqual({ modelInvocable: false, userInvocable: true });
    expect(problems).toEqual([]);
  });

  it('maps user-invocable: false to a user-invisible skill', () => {
    const { policy, problems } = resolveDshInvocationPolicy({ 'user-invocable': false });

    expect(policy).toEqual({ modelInvocable: true, userInvocable: false });
    expect(problems).toEqual([]);
  });

  it('permits neither surface when both are set that way', () => {
    const { policy } = resolveDshInvocationPolicy({
      'disable-model-invocation': true,
      'user-invocable': false,
    });

    expect(policy).toEqual({ modelInvocable: false, userInvocable: false });
  });

  it.each([['yes'], ['ON'], ['1'], [1]])('accepts %j as a truthy spelling', (value) => {
    const { policy, problems } = resolveDshInvocationPolicy({ 'disable-model-invocation': value });

    expect(policy.modelInvocable).toBe(false);
    expect(problems).toEqual([]);
  });

  it.each([['no'], ['OFF'], ['0'], [0]])('accepts %j as a falsy spelling', (value) => {
    const { policy, problems } = resolveDshInvocationPolicy({ 'user-invocable': value });

    expect(policy.userInvocable).toBe(false);
    expect(problems).toEqual([]);
  });

  it.each([
    ['disableModelInvocation', 'disable-model-invocation'],
    ['modelInvocable', 'disable-model-invocation'],
    ['userInvocable', 'user-invocable'],
  ])('rejects the legacy key %s and names %s instead', (legacy, canonical) => {
    const { problems } = resolveDshInvocationPolicy({ [legacy]: true });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('legacy');
    expect(problems[0]?.key).toBe(legacy);
    expect(problems[0]?.message).toContain(`"${legacy}" is unsupported`);
    expect(problems[0]?.message).toContain(`"${canonical}"`);
  });

  it.each([
    ['disable-model-invocation', 'maybe'],
    ['disable-model-invocation', 2],
    ['disable-model-invocation', null],
    ['disable-model-invocation', []],
    ['user-invocable', 'maybe'],
    ['user-invocable', {}],
  ])('rejects %s: %j as a value problem', (key, value) => {
    const { problems } = resolveDshInvocationPolicy({ [key]: value });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('value');
    expect(problems[0]?.key).toBe(key);
    expect(problems[0]?.message).toContain('must be a boolean');
  });

  it('reports legacy keys before value problems, deterministically', () => {
    const { problems } = resolveDshInvocationPolicy({
      userInvocable: false,
      'disable-model-invocation': 'maybe',
    });

    expect(problems.map((problem) => problem.key)).toEqual([
      'userInvocable',
      'disable-model-invocation',
    ]);
  });
});
