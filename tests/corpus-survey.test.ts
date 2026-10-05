/**
 * The corpus survey harness, exercised on a small synthetic corpus.
 *
 * The real Anthropic corpus is a development-time integration survey, not a unit
 * test dependency: it is not vendored, and no test fetches it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  renderSurveyReport,
  serializeSnapshot,
  surveyCorpus,
  toSnapshot,
} from '../src/survey/corpus-survey.js';
import { parseSurveyArgs, runSurveyCli } from '../scripts/survey-agent-skills-corpus.js';
import { ANTHROPIC_SKILLS_COMMIT } from '../src/sources/agent-skills/agent-skills-contract.js';

const repositoryRoot = process.cwd();
const syntheticCorpus = path.join(repositoryRoot, 'fixtures', 'corpus', 'agent-skills');

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-survey-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('corpus discovery', () => {
  const report = surveyCorpus({ skillsRoot: syntheticCorpus });

  it('surveys only immediate child skill directories', () => {
    expect(report.skills.map((skill) => skill.name)).toEqual([
      'alpha-minimal',
      'beta-metadata',
      'delta-compatibility',
      'epsilon-tools',
      'gamma-license',
      'no-entry',
      'source-invalid-skill',
      'zeta-resources',
    ]);
  });

  it('does not discover nested skill trees', () => {
    const nested = temporaryRoot();
    const skills = path.join(nested, 'skills');
    mkdirSync(path.join(skills, 'outer', 'inner'), { recursive: true });
    writeFileSync(
      path.join(skills, 'outer', 'SKILL.md'),
      '---\nname: outer\ndescription: d\n---\n\n# B\n',
    );
    writeFileSync(
      path.join(skills, 'outer', 'inner', 'SKILL.md'),
      '---\nname: inner\ndescription: d\n---\n\n# B\n',
    );

    expect(surveyCorpus({ skillsRoot: skills }).skills.map((skill) => skill.name)).toEqual([
      'outer',
    ]);
  });

  it('records the entry name and a content hash, but no frontmatter values', () => {
    const alpha = report.skills.find((skill) => skill.name === 'alpha-minimal');
    expect(alpha?.entryFile).toBe('SKILL.md');
    expect(alpha?.entrySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(alpha?.frontmatterKeys).toEqual(['description', 'name']);

    const serialized = serializeSnapshot(
      toSnapshot(report, {
        repository: 'https://github.com/anthropics/skills',
        commit: ANTHROPIC_SKILLS_COMMIT,
        surveyRoot: 'skills',
      }),
    );
    // No description text, no body, no license text may appear.
    expect(serialized).not.toContain('A minimal skill that converts');
    expect(serialized).not.toContain('# Alpha');
    expect(serialized).not.toContain('Apache-2.0');
  });

  it('records resource counts and directory names without contents', () => {
    const zeta = report.skills.find((skill) => skill.name === 'zeta-resources');
    expect(zeta?.resourceDirectories).toEqual(['references', 'scripts']);
    expect(zeta?.resourceFiles).toBe(2);

    const alpha = report.skills.find((skill) => skill.name === 'alpha-minimal');
    expect(alpha?.resourceFiles).toBe(0);
    expect(alpha?.resourceDirectories).toEqual([]);
  });

  it('handles a skill directory with no entry', () => {
    const missing = report.skills.find((skill) => skill.name === 'no-entry');
    expect(missing?.entryFile).toBe('');
    expect(missing?.entrySha256).toBe('');
    expect(missing?.status).toBe('SOURCE_INVALID');
  });
});

describe('aggregation', () => {
  const report = surveyCorpus({ skillsRoot: syntheticCorpus });

  it('counts verdicts', () => {
    expect(report.summary.total).toBe(8);
    // `gamma-license` now converts: a license is preserved opaquely rather than
    // refused, which is the Phase 9 change.
    expect(report.summary.convertible).toBe(4);
    expect(report.summary.refused).toBe(2);
    expect(report.summary.sourceInvalid).toBe(2);
  });

  it('counts frontmatter keys', () => {
    expect(report.summary.frontmatterFrequency['name']).toBe(7);
    expect(report.summary.frontmatterFrequency['description']).toBe(7);
    expect(report.summary.frontmatterFrequency['license']).toBe(1);
    expect(report.summary.frontmatterFrequency['compatibility']).toBe(1);
    expect(report.summary.frontmatterFrequency['allowed-tools']).toBe(1);
    expect(report.summary.frontmatterFrequency['metadata']).toBe(1);
  });

  it('counts blockers by code and field', () => {
    // A license is preserved, so it is no longer a blocker.
    expect(report.summary.blockerFrequency['UNSUPPORTED_TARGET_SEMANTIC: license']).toBeUndefined();
    expect(report.summary.blockerFrequency['UNSUPPORTED_TARGET_SEMANTIC: compatibility']).toBe(1);
    expect(report.summary.blockerFrequency['UNMAPPED_SOURCE_FRONTMATTER: allowed-tools']).toBe(1);
    // An unknown-key issue names the offending field inside its message rather
    // than as a detail, so it is counted by code alone.
    expect(report.summary.blockerFrequency['AGENT_SKILLS_UNKNOWN_FRONTMATTER_KEY']).toBe(1);
    expect(report.summary.blockerFrequency['SOURCE_PACKAGE_MISSING_ENTRY']).toBe(1);
  });

  it('counts resource shape', () => {
    expect(report.summary.withScripts).toBe(1);
    expect(report.summary.withReferences).toBe(1);
    expect(report.summary.withAssets).toBe(0);
    // `zeta-resources` has a references/ and a scripts/ directory; `no-entry`
    // counts because it is a directory with a resource file and no entry.
    expect(report.summary.withResources).toBe(2);
  });

  it('sorts skills deterministically by directory name', () => {
    const names = report.skills.map((skill) => skill.name);
    expect(names).toEqual(
      [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  });
});

describe('snapshot determinism', () => {
  it('produces byte-identical snapshots for repeated surveys', () => {
    const provenance = {
      repository: 'https://github.com/anthropics/skills',
      commit: ANTHROPIC_SKILLS_COMMIT,
      surveyRoot: 'skills',
    };

    const first = serializeSnapshot(
      toSnapshot(surveyCorpus({ skillsRoot: syntheticCorpus }), provenance),
    );
    for (let run = 0; run < 5; run += 1) {
      expect(
        serializeSnapshot(toSnapshot(surveyCorpus({ skillsRoot: syntheticCorpus }), provenance)),
      ).toBe(first);
    }
  });

  it('carries no wall-clock timestamp', () => {
    const snapshot = toSnapshot(surveyCorpus({ skillsRoot: syntheticCorpus }), {
      repository: 'https://github.com/anthropics/skills',
      commit: ANTHROPIC_SKILLS_COMMIT,
      surveyRoot: 'skills',
    });
    const serialized = serializeSnapshot(snapshot);

    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(snapshot)).not.toContain('surveyedAt');
    expect(Object.keys(snapshot)).not.toContain('date');
  });
});

describe('argument parsing', () => {
  it('accepts a path alone', () => {
    expect(parseSurveyArgs(['some/skills'])).toEqual({ skillsRoot: 'some/skills' });
  });

  it('accepts --out with a path', () => {
    expect(parseSurveyArgs(['some/skills', '--out', 'out.json'])).toEqual({
      skillsRoot: 'some/skills',
      outPath: 'out.json',
    });
  });

  it('accepts --out=path', () => {
    expect(parseSurveyArgs(['some/skills', '--out=out.json'])).toEqual({
      skillsRoot: 'some/skills',
      outPath: 'out.json',
    });
  });

  it('drops the leading terminator that pnpm forwards', () => {
    expect(parseSurveyArgs(['--', 'some/skills'])).toEqual({ skillsRoot: 'some/skills' });
  });

  it('rejects a missing path', () => {
    expect(parseSurveyArgs([])).toEqual({
      error: 'a corpus path is required: survey:agent-skills -- <checkout>/skills',
    });
  });

  it('rejects --out without a value', () => {
    expect(parseSurveyArgs(['some/skills', '--out'])).toEqual({
      error: "option '--out' expects a path",
    });
  });

  it('rejects an unknown option and a second path', () => {
    expect(parseSurveyArgs(['--json', 'x'])).toEqual({ error: "unknown option '--json'" });
    expect(parseSurveyArgs(['a', 'b'])).toEqual({ error: 'only one corpus path may be given' });
  });
});

describe('survey CLI', () => {
  it('writes the report and an optional snapshot', () => {
    const out = path.join(temporaryRoot(), 'snapshot.json');
    let stdout = '';
    let stderr = '';
    const exitCode = runSurveyCli({
      skillsRoot: syntheticCorpus,
      outPath: out,
      writeOut: (text) => {
        stdout += text;
      },
      writeErr: (text) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Total skills:    8');
    expect(stderr).toContain('snapshot written');

    const snapshot = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
    expect(snapshot['skillCount']).toBe(8);
    expect(snapshot['commit']).toBe(ANTHROPIC_SKILLS_COMMIT);
    expect(snapshot['surveyRoot']).toBe('skills');
  });

  it('skips the snapshot when no output path is given', () => {
    let stdout = '';
    let stderr = '';
    const exitCode = runSurveyCli({
      skillsRoot: syntheticCorpus,
      writeOut: (text) => {
        stdout += text;
      },
      writeErr: (text) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Agent Skills Corpus Survey');
  });

  it('never prints an absolute corpus path', () => {
    let stdout = '';
    runSurveyCli({
      skillsRoot: syntheticCorpus,
      writeOut: (text) => {
        stdout += text;
      },
      writeErr: () => {},
    });

    expect(stdout).not.toContain(repositoryRoot);
    expect(stdout).not.toContain(tmpdir());
  });

  it('renders a per-skill matrix with a primary blocker column', () => {
    const text = renderSurveyReport(surveyCorpus({ skillsRoot: syntheticCorpus }));

    expect(text).toContain('Per skill:');
    expect(text).toContain('alpha-minimal');
    expect(text).toContain('CONVERTIBLE');
    expect(text).toContain('UNSUPPORTED_TARGET_SEMANTIC: compatibility');
  });
});

describe('synthetic corpus safety', () => {
  it('never executes the script trap in the corpus fixture', () => {
    const trap = path.join(syntheticCorpus, 'zeta-resources', 'scripts', 'trap.sh');
    expect(readFileSync(trap, 'utf8')).toContain('INVALID-SKILL.md');
    // The marker would be created beside the fixture if anything ran it.
    expect(existsSync(path.join(syntheticCorpus, 'zeta-resources', 'INVALID-SKILL.md'))).toBe(
      false,
    );
  });
});
