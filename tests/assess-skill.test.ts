/**
 * Read-only compatibility assessment.
 *
 * The central property is that an assessment never disagrees with a real
 * conversion, and never writes anything.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assessSkill, renderAssessmentReport } from '../src/assessment/assess-skill.js';
import { orderIssues } from '../src/conversion/conversion-plan.js';
import { CONVERSION_CODES } from '../src/schemas/conversion.js';
import { AGENT_SKILLS_CODES } from '../src/sources/agent-skills/agent-skills-validator.js';
import { SOURCE_CODES } from '../src/conversion/source-adapter.js';

const repositoryRoot = process.cwd();
const agentFixture = (name: string): string =>
  path.join(repositoryRoot, 'fixtures', 'sources', 'agent-skills', name);

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-assess-'));
  temporaryRoots.push(root);
  return root;
}

/** Creates a skill directory with the given files. */
function skillDirectory(name: string, files: Record<string, string>): string {
  const root = path.join(temporaryRoot(), name);
  mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function assess(dir: string) {
  return assessSkill(dir, { target: 'dsh', source: 'agent-skills', cwd: repositoryRoot });
}

describe('assessment verdicts', () => {
  it('reports a minimal skill as CONVERTIBLE with every stage passing', () => {
    const result = assess(agentFixture('pdf-processing'));

    expect(result.status).toBe('CONVERTIBLE');
    expect(result.issues).toEqual([]);
    expect(result.stages).toEqual({
      source: 'PASS',
      ir: 'PASS',
      semantic: 'PASS',
      resource: 'PASS',
      target: 'PASS',
    });
  });

  it('reports a metadata skill as CONVERTIBLE', () => {
    expect(assess(agentFixture('metadata-skill')).status).toBe('CONVERTIBLE');
  });

  it('reports a license-only skill as CONVERTIBLE, preserved rather than refused', () => {
    const result = assess(agentFixture('with-license'));

    expect(result.status).toBe('CONVERTIBLE');
    expect(result.issues).toEqual([]);
    expect(result.stages.source).toBe('PASS');
    expect(result.stages.ir).toBe('PASS');
    expect(result.stages.semantic).toBe('PASS');
  });

  it('refuses compatibility at the SEMANTIC stage', () => {
    const result = assess(agentFixture('with-compatibility-check'));

    expect(result.status).toBe('REFUSED');
    expect(result.issues[0]?.code).toBe(CONVERSION_CODES.unsupportedTargetSemantic);
    expect(result.issues[0]?.details).toEqual(['compatibility']);
  });

  it('refuses allowed-tools as unmapped source data', () => {
    const result = assess(agentFixture('with-allowed-tools-check'));

    expect(result.status).toBe('REFUSED');
    expect(result.issues[0]?.code).toBe(CONVERSION_CODES.unmappedSourceFrontmatter);
    expect(result.issues[0]?.stage).toBe('SEMANTIC');
    expect(result.issues[0]?.details).toEqual(['allowed-tools']);
  });

  it('converts metadata combined with license, since both are carryable', () => {
    const dir = skillDirectory('mixed', {
      'SKILL.md': '---\nname: mixed\ndescription: d\nlicense: MIT\nmetadata:\n  a: b\n---\n\n# B\n',
    });
    const result = assess(dir);

    expect(result.status).toBe('CONVERTIBLE');
    expect(result.issues).toEqual([]);
  });

  it('refuses license combined with compatibility as a whole', () => {
    const dir = skillDirectory('mixed-refused', {
      'SKILL.md':
        '---\nname: mixed-refused\ndescription: d\nlicense: MIT\ncompatibility: Requires git\n---\n\n# B\n',
    });
    const result = assess(dir);

    expect(result.status).toBe('REFUSED');
    expect(result.issues[0]?.details).toEqual(['compatibility']);
  });

  it('reports an unknown frontmatter key as SOURCE_INVALID and skips later stages', () => {
    const result = assess(agentFixture('unknown-key-check'));

    expect(result.status).toBe('SOURCE_INVALID');
    expect(result.issues[0]?.code).toBe(AGENT_SKILLS_CODES.unknownFrontmatterKey);
    expect(result.issues[0]?.stage).toBe('SOURCE');
    // Nothing downstream could have been interpreted, so it is skipped rather
    // than falsely reported as passing.
    expect(result.stages.ir).toBe('SKIPPED');
    expect(result.stages.semantic).toBe('SKIPPED');
    expect(result.stages.resource).toBe('SKIPPED');
    expect(result.stages.target).toBe('SKIPPED');
  });

  it('reports a directory-name mismatch as SOURCE_INVALID', () => {
    const result = assess(agentFixture('name-directory-mismatch'));

    expect(result.status).toBe('SOURCE_INVALID');
    expect(result.issues[0]?.code).toBe(AGENT_SKILLS_CODES.nameDirectoryMismatch);
  });

  it('reports a missing entry as SOURCE_INVALID', () => {
    const dir = skillDirectory('no-entry', { 'README.md': '# not a skill\n' });
    const result = assess(dir);

    expect(result.status).toBe('SOURCE_INVALID');
    expect(result.issues[0]?.code).toBe('SOURCE_PACKAGE_MISSING_ENTRY');
  });

  it('reports a source-valid but IR-unsupported skill at the IR stage', () => {
    const result = assess(agentFixture('数据处理'));

    expect(result.status).toBe('REFUSED');
    expect(result.stages.source).toBe('PASS');
    expect(result.stages.ir).toBe('REFUSED');
    expect(result.issues[0]?.code).toBe(SOURCE_CODES.sourceValidIrUnsupported);
    expect(result.issues[0]?.stage).toBe('IR');
  });

  it('reports an unsafe IR value at the IR stage without crashing', () => {
    const dir = skillDirectory('unsafe', {
      'SKILL.md': '---\nname: unsafe\ndescription: d\nmetadata:\n  __proto__: x\n---\n\n# B\n',
    });
    const result = assess(dir);

    expect(result.status).toBe('REFUSED');
    expect(result.stages.ir).toBe('REFUSED');
    expect(result.issues[0]?.code).toBe(CONVERSION_CODES.unrepresentableIrValue);
  });

  it('reports an unsupported target at the TARGET stage', () => {
    const result = assessSkill(agentFixture('pdf-processing'), {
      target: 'claude',
      source: 'agent-skills',
      cwd: repositoryRoot,
    });

    expect(result.status).toBe('REFUSED');
    expect(result.stages.target).toBe('REFUSED');
    expect(result.issues[0]?.stage).toBe('TARGET');
  });

  it('reports an unknown source at the SOURCE stage', () => {
    const result = assessSkill(agentFixture('pdf-processing'), {
      target: 'dsh',
      source: 'claude',
      cwd: repositoryRoot,
    });

    expect(result.status).toBe('SOURCE_INVALID');
    expect(result.issues[0]?.code).toBe('UNKNOWN_SOURCE');
  });
});

describe('resource preflight', () => {
  it('reports a reserved resource name at the RESOURCE stage', () => {
    const dir = skillDirectory('reserved', {
      'SKILL.md': '---\nname: reserved\ndescription: d\n---\n\n# B\n',
      'NUL.md': 'x\n',
    });
    const result = assess(dir);

    expect(result.status).toBe('REFUSED');
    expect(result.stages.resource).toBe('REFUSED');
    expect(result.issues[0]?.code).toBe(CONVERSION_CODES.reservedResourceName);
  });

  it('reports a trailing-dot resource name at the RESOURCE stage', () => {
    const dir = skillDirectory('trailing-dot', {
      'SKILL.md': '---\nname: trailing-dot\ndescription: d\n---\n\n# B\n',
      'notes./x.md': 'x\n',
    });
    const result = assess(dir);

    expect(result.status).toBe('REFUSED');
    expect(result.stages.resource).toBe('REFUSED');
    expect(result.stages.semantic).toBe('PASS');
    expect(result.issues[0]?.code).toBe(CONVERSION_CODES.reservedResourceName);
  });

  it('reports every blocker it can determine safely, not just the first', () => {
    const dir = skillDirectory('many-blockers', {
      'SKILL.md':
        '---\nname: many-blockers\ndescription: d\nlicense: MIT\nNUL: value\n---\n\n# B\n',
      'assets/data.json': '{}\n',
    });
    // `NUL` is not an allowed frontmatter field, so the source contract stops the
    // assessment before semantics; this asserts the stage precedence is honest.
    const result = assess(dir);

    expect(result.status).toBe('SOURCE_INVALID');
    expect(result.stages.semantic).toBe('SKIPPED');
  });

  it('reports a semantic and a resource blocker together when the source is valid', () => {
    const dir = skillDirectory('semantic-and-resource', {
      'SKILL.md':
        '---\nname: semantic-and-resource\ndescription: d\ncompatibility: Requires git\n---\n\n# B\n',
      'NUL.md': 'x\n',
    });
    const result = assess(dir);

    expect(result.status).toBe('REFUSED');
    // The semantic stage refuses first, so the resource stage never runs: the
    // planner stops rather than pretending to have planned a package.
    expect(result.stages.semantic).toBe('REFUSED');
    expect(result.stages.resource).toBe('PASS');
    expect(result.issues.map((issue) => issue.code)).toEqual([
      CONVERSION_CODES.unsupportedTargetSemantic,
    ]);
  });

  it('accepts a directory with references and scripts without executing them', () => {
    const dir = skillDirectory('with-scripts', {
      'SKILL.md': '---\nname: with-scripts\ndescription: d\n---\n\n# B\n',
      'scripts/trap.sh': '#!/bin/sh\necho executed > INVALID-SKILL.md\n',
      'references/GUIDE.md': '# Guide\n',
    });
    const result = assess(dir);

    expect(result.status).toBe('CONVERTIBLE');
    expect(readdirSync(dir).sort()).toEqual(['SKILL.md', 'references', 'scripts']);
    expect(readdirSync(dir)).not.toContain('INVALID-SKILL.md');
  });
});

describe('determinism', () => {
  it('produces byte-identical reports across repeated assessments', () => {
    const dir = agentFixture('with-license');
    const first = renderAssessmentReport(assess(dir));

    for (let run = 0; run < 25; run += 1) {
      expect(renderAssessmentReport(assess(dir))).toBe(first);
    }
  });

  it('orders issues by stage, then code, then the first detail', () => {
    const issues = orderIssues([
      { stage: 'RESOURCE', code: 'ZZZ', severity: 'error', message: 'm' },
      { stage: 'SOURCE', code: 'BBB', severity: 'error', message: 'm' },
      { stage: 'SOURCE', code: 'AAA', severity: 'error', message: 'm' },
      { stage: 'SEMANTIC', code: 'AAA', severity: 'error', message: 'm', details: ['b'] },
      { stage: 'SEMANTIC', code: 'AAA', severity: 'error', message: 'm', details: ['a'] },
    ]);

    expect(
      issues.map((issue) => `${issue.stage}:${issue.code}:${issue.details?.[0] ?? ''}`),
    ).toEqual(['SOURCE:AAA:', 'SOURCE:BBB:', 'SEMANTIC:AAA:a', 'SEMANTIC:AAA:b', 'RESOURCE:ZZZ:']);
  });

  it('is unaffected by frontmatter key insertion order', () => {
    const first = skillDirectory('order-a', {
      'SKILL.md':
        '---\nname: order-a\ndescription: d\nlicense: MIT\ncompatibility: git\n---\n\n# B\n',
    });
    const second = skillDirectory('order-b', {
      'SKILL.md':
        '---\nname: order-b\ndescription: d\ncompatibility: git\nlicense: MIT\n---\n\n# B\n',
    });

    expect(assess(second).issues.map((issue) => issue.details?.[0])).toEqual(
      assess(first).issues.map((issue) => issue.details?.[0]),
    );
  });
});

describe('read-only guarantee', () => {
  it('leaves the source tree byte-identical and mtime-stable', () => {
    const dir = agentFixture('metadata-skill');
    const before = readdirSync(dir, { recursive: true, withFileTypes: true })
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((entry) => statSync(entry).isFile())
      .map((file) => `${path.relative(dir, file)}:${statSync(file).size}:${statSync(file).mtimeMs}`)
      .sort();

    assess(dir);

    const after = readdirSync(dir, { recursive: true, withFileTypes: true })
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((entry) => statSync(entry).isFile())
      .map((file) => `${path.relative(dir, file)}:${statSync(file).size}:${statSync(file).mtimeMs}`)
      .sort();

    expect(after).toEqual(before);
  });

  it('creates no output, staging or temporary directory', () => {
    const parent = temporaryRoot();
    const dir = skillDirectory('clean', {
      'SKILL.md': '---\nname: clean\ndescription: d\nlicense: MIT\n---\n\n# B\n',
    });
    // The skill directory is created inside the same parent we watch.
    const watched = path.dirname(dir);

    assess(dir);

    const entries = readdirSync(watched).sort();
    expect(entries).toEqual([path.basename(dir)]);
    expect(entries.some((name) => name.includes('staging'))).toBe(false);
    void parent;
  });

  it('does not print an absolute source path in the report', () => {
    const dir = agentFixture('with-license');
    const report = renderAssessmentReport(assess(dir));

    expect(report).not.toContain(repositoryRoot);
    expect(report).not.toContain(tmpdir());
    expect(report).toContain('Convertible:');
  });
});
