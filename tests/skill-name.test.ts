/**
 * The shared skill-name rule.
 *
 * This is the single source of truth used by both `analyze` and `validate`, so
 * the boundary cases are pinned here rather than in either command's suite.
 */
import { describe, expect, it } from 'vitest';

import {
  findSkillNameProblem,
  formatSkillNameProblem,
  isKebabCase,
} from '../src/utils/skill-name.js';

describe('isKebabCase', () => {
  it.each([
    ['my-skill'],
    ['deep-research'],
    ['video-editor'],
    ['a'],
    ['abc'],
    ['a1'],
    ['skill-2'],
    ['1skill'],
    ['a-b-c'],
  ])('accepts %s', (name) => {
    expect(isKebabCase(name)).toBe(true);
  });

  it.each([
    ['MySkill'],
    ['my_skill'],
    ['My Skill'],
    ['my--skill'],
    ['-my-skill'],
    ['my-skill-'],
    ['my.skill'],
    ['my/skill'],
    ['my\\skill'],
    ['MY-SKILL'],
    [''],
    ['.'],
    ['..'],
    ['../foo'],
    ['foo/../bar'],
    ['foo\\bar'],
    ['my skill'],
    ['  '],
  ])('rejects %j', (name) => {
    expect(isKebabCase(name)).toBe(false);
  });
});

describe('findSkillNameProblem', () => {
  it('returns undefined for an acceptable name', () => {
    expect(findSkillNameProblem('my-skill')).toBeUndefined();
  });

  it.each([
    ['../foo', /path separator/],
    ['foo/../bar', /path separator/],
    ['my/skill', /path separator/],
    ['my\\skill', /path separator/],
    ['foo\\bar', /path separator/],
  ])('reports a path separator in %j', (name, expected) => {
    expect(findSkillNameProblem(name)).toMatch(expected);
  });

  it.each([['.'], ['..']])('reports the traversal segment %j', (name) => {
    expect(findSkillNameProblem(name)).toBe(`must not be "${name}"`);
  });

  it('reports control characters before format problems', () => {
    // A tab and a NUL are both invalid; the message must name the real cause.
    expect(findSkillNameProblem('bad\tname')).toBe('must not contain control characters');
    expect(findSkillNameProblem('bad\u0000name')).toBe('must not contain control characters');
    expect(findSkillNameProblem('bad\u007fname')).toBe('must not contain control characters');
  });

  it('reports a format problem for names that are neither dangerous nor kebab-case', () => {
    expect(findSkillNameProblem('My_Skill')).toMatch(/is not kebab-case/);
  });
});

describe('formatSkillNameProblem', () => {
  it('embeds the name and the reason without reformatting either', () => {
    const name = 'my.skill';
    const problem = findSkillNameProblem(name) ?? '';

    expect(formatSkillNameProblem(name, problem)).toBe(`"${name}" ${problem}`);
  });
});
