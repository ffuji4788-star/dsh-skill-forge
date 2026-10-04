/**
 * Contract provenance snapshot.
 *
 * The compatibility profile claims to mirror one upstream revision. These tests
 * keep that claim checkable and prevent the profile from silently drifting into
 * "whatever master says today": the pinned SHA, the documented provenance and
 * the implemented name grammar must all agree.
 *
 * No network access: the pinned revision is recorded at development time. The
 * optional live check runs only when explicitly requested.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DSH_CONTRACT_SOURCES,
  DSH_CONTRACT_VERIFIED_AT,
  DSH_DISCOVERY_SHAPES,
  DSH_KNOWN_FRONTMATTER_KEYS,
  DSH_SKILL_NAME_PATTERN,
  DSH_TARGET_ID,
  DSH_UPSTREAM_COMMIT,
  DSH_UPSTREAM_REPOSITORY,
  dshUpstreamShortCommit,
} from '../src/targets/dsh/dsh-contract.js';

const repositoryRoot = process.cwd();

/**
 * The upstream pattern as written in
 * `packages/skill/skill/src/index.ts`: `const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
 * Compared as a literal so a change to our pattern cannot pass unnoticed.
 */
const UPSTREAM_SKILL_NAME_SOURCE = '^[a-z0-9]+(?:-[a-z0-9]+)*$';

describe('pinned upstream revision', () => {
  it('records a full 40-character commit SHA, not a branch name', () => {
    expect(DSH_UPSTREAM_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it('pins a specific repository', () => {
    expect(DSH_UPSTREAM_REPOSITORY).toBe('https://github.com/deepseek-ai/deepseek-harness');
    expect(DSH_TARGET_ID).toBe('deepseek-harness');
  });

  it('records a verification date', () => {
    expect(DSH_CONTRACT_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('derives the short SHA used in reports from the pinned SHA', () => {
    expect(dshUpstreamShortCommit()).toBe(DSH_UPSTREAM_COMMIT.slice(0, 12));
    expect(dshUpstreamShortCommit()).toHaveLength(12);
  });

  it('lists the upstream files the rules were read from', () => {
    expect(DSH_CONTRACT_SOURCES).toContain('packages/skill/skill/src/index.ts');
    expect(DSH_CONTRACT_SOURCES).toContain('packages/skill/skill-filesystem/src/index.ts');
    expect(DSH_CONTRACT_SOURCES.length).toBeGreaterThanOrEqual(3);
  });
});

describe('implemented grammar matches upstream', () => {
  it('uses the upstream skill-name pattern verbatim', () => {
    expect(DSH_SKILL_NAME_PATTERN.source).toBe(UPSTREAM_SKILL_NAME_SOURCE);
  });

  it('does not accept a pattern looser or stricter than upstream on samples', () => {
    const accepted = ['a', 'a1', '1', '1-a', 'a-b-c', 'skill-2', 'deep-research'];
    const rejected = ['A', 'a_b', 'a.b', 'a--b', '-a', 'a-', '.', '..', 'a/b', 'a\\b', ''];

    for (const name of accepted) {
      expect(DSH_SKILL_NAME_PATTERN.test(name)).toBe(true);
    }
    for (const name of rejected) {
      expect(DSH_SKILL_NAME_PATTERN.test(name)).toBe(false);
    }
  });

  it('knows exactly the frontmatter keys the pinned provider reads', () => {
    expect([...DSH_KNOWN_FRONTMATTER_KEYS].sort()).toEqual([
      'description',
      'disable-model-invocation',
      'metadata',
      'name',
      'user-invocable',
      'whenToUse',
    ]);
  });

  it('records the two discovery shapes and no recursive shape', () => {
    expect(DSH_DISCOVERY_SHAPES).toEqual([
      '<scanned-root>/<name>/SKILL.md',
      '<scanned-root>/<name>.md',
    ]);
    expect(DSH_DISCOVERY_SHAPES.some((shape) => shape.includes('**'))).toBe(false);
  });
});

describe('documented provenance matches the code', () => {
  const document = readFileSync(
    path.join(repositoryRoot, 'docs', 'dsh-compatibility-contract.md'),
    'utf8',
  );

  it('documents the exact pinned commit', () => {
    expect(document).toContain(DSH_UPSTREAM_COMMIT);
  });

  it('documents the repository and verification date', () => {
    expect(document).toContain(DSH_UPSTREAM_REPOSITORY);
    expect(document).toContain(DSH_CONTRACT_VERIFIED_AT);
  });

  it('does not present the contract as tracking a moving branch', () => {
    expect(document).not.toMatch(/contract\s*:\s*latest/i);
    expect(document).not.toMatch(/tracks?\s+master\b/i);
  });

  it('documents every upstream file that was inspected', () => {
    for (const source of DSH_CONTRACT_SOURCES) {
      expect(document).toContain(source);
    }
  });
});

describe('live upstream check (opt-in, never runs by default)', () => {
  const enabled = process.env['DSH_FORGE_VERIFY_UPSTREAM'] === '1';

  it.skipIf(!enabled)('confirms the pinned commit still exists upstream', async () => {
    const response = await fetch(
      `${DSH_UPSTREAM_REPOSITORY.replace('https://github.com/', 'https://api.github.com/repos/')}/commits/${DSH_UPSTREAM_COMMIT}`,
      { headers: { 'User-Agent': 'dsh-skill-forge-contract-check' } },
    );

    expect(response.status).toBe(200);
  });
});
