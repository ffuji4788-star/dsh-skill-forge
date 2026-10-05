/**
 * The deterministic Codex corpus survey.
 *
 * The property under test: the survey counts what is really there, keeps
 * behavioural keys independent of one another, and never lets a source value into
 * a snapshot.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseCodexSurveyArgs,
  serializeCodexSnapshot,
  surveyCodexCorpus,
  CODEX_SURVEY_COLLECTIONS,
} from '../scripts/survey-codex-corpus.js';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-codex-survey-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Writes one skill into a corpus root. */
function writeSkill(
  corpusRoot: string,
  collection: string,
  name: string,
  options: {
    readonly license?: string;
    readonly sidecar?: string;
    readonly description?: string;
  } = {},
): void {
  const root = path.join(corpusRoot, collection, name);
  mkdirSync(root, { recursive: true });
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(options.description ?? 'A description.')}`,
    ...(options.license === undefined ? [] : [`license: ${options.license}`]),
    '---',
    '',
    '# Body',
    '',
  ];
  writeFileSync(path.join(root, 'SKILL.md'), lines.join('\n'));
  if (options.sidecar !== undefined) {
    mkdirSync(path.join(root, 'agents'), { recursive: true });
    writeFileSync(path.join(root, 'agents', 'openai.yaml'), options.sidecar);
  }
}

describe('the selection rule', () => {
  it('surveys exactly the documented collections', () => {
    expect([...CODEX_SURVEY_COLLECTIONS]).toEqual(['.curated', '.system']);
  });

  it('counts both collections and ignores anything else', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'curated-one', { sidecar: 'interface: {}\n' });
    writeSkill(corpus, '.system', 'system-one', { sidecar: 'interface: {}\n' });
    // Outside the selection rule: must not be counted.
    writeSkill(corpus, '.experimental', 'experimental-one', { sidecar: 'interface: {}\n' });
    mkdirSync(path.join(corpus, 'loose-directory'), { recursive: true });

    const report = surveyCodexCorpus(corpus);

    expect(report.summary.total).toBe(2);
    expect(report.skills.map((skill) => skill.name).sort()).toEqual(['curated-one', 'system-one']);
  });

  it('ignores a directory with no SKILL.md', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'real-skill', { sidecar: 'interface: {}\n' });
    mkdirSync(path.join(corpus, '.curated', 'not-a-skill'), { recursive: true });

    expect(surveyCodexCorpus(corpus).summary.total).toBe(1);
  });
});

describe('classification and verdicts', () => {
  it('separates convertible from refused by the sidecar', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'no-sidecar');
    writeSkill(corpus, '.curated', 'interface-only', {
      sidecar: 'interface:\n  display_name: "X"\n',
    });
    writeSkill(corpus, '.curated', 'with-policy', {
      sidecar: 'policy:\n  allow_implicit_invocation: false\n',
    });
    writeSkill(corpus, '.curated', 'with-deps', {
      sidecar: 'dependencies:\n  tools:\n    - type: "mcp"\n',
    });
    writeSkill(corpus, '.curated', 'unreadable', { sidecar: 'interface: [unclosed\n' });

    const { summary } = surveyCodexCorpus(corpus);

    expect(summary.total).toBe(5);
    expect(summary.convertible).toBe(2);
    expect(summary.refused).toBe(3);
    expect(summary.absent).toBe(1);
    expect(summary.interfaceOnly).toBe(1);
    expect(summary.behavioural).toBe(2);
    expect(summary.unreadable).toBe(1);
  });

  it('counts dependencies and policy independently rather than assuming exclusivity', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'deps-only', { sidecar: 'dependencies: {}\n' });
    writeSkill(corpus, '.curated', 'policy-only', { sidecar: 'policy: {}\n' });
    // The skill that makes mutual exclusivity a wrong assumption.
    writeSkill(corpus, '.curated', 'both-keys', { sidecar: 'dependencies: {}\npolicy: {}\n' });

    const { summary } = surveyCodexCorpus(corpus);

    expect(summary.withDependencies).toBe(2);
    expect(summary.withPolicy).toBe(2);
    expect(summary.behaviouralUnion).toBe(3);
    expect(summary.behavioural).toBe(3);
    // The union is what explains the refusal count, not either key alone.
    expect(summary.refused).toBe(3);
  });

  it('reports the union as no larger than the number of refused skills', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'both-keys', { sidecar: 'dependencies: {}\npolicy: {}\n' });
    writeSkill(corpus, '.curated', 'fine', { sidecar: 'interface: {}\n' });

    const { summary } = surveyCodexCorpus(corpus);

    expect(summary.behaviouralUnion).toBe(summary.refused);
    expect(summary.withDependencies + summary.withPolicy).toBeGreaterThan(summary.refused);
  });
});

describe('snapshot contents', () => {
  it('records key names, counts and hashes, never values', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'with-secrets', {
      license: 'Proprietary. LICENSE.txt has complete terms',
      sidecar:
        'interface:\n  display_name: "SHOULD-NOT-APPEAR"\n  default_prompt: "NEITHER-SHOULD-THIS"\n',
      description: 'A description that must not be recorded verbatim.',
    });

    const snapshot = serializeCodexSnapshot(surveyCodexCorpus(corpus));

    // Key names are expected.
    expect(snapshot).toContain('frontmatterKeys');
    expect(snapshot).toContain('"license"');
    expect(snapshot).toContain('descriptionLength');
    // Values are not.
    expect(snapshot).not.toContain('SHOULD-NOT-APPEAR');
    expect(snapshot).not.toContain('NEITHER-SHOULD-THIS');
    expect(snapshot).not.toContain('Proprietary');
    expect(snapshot).not.toContain('must not be recorded verbatim');
  });

  it('records a description length rather than the description', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'measured', {
      description: 'twelve chars',
      sidecar: 'interface: {}\n',
    });

    const skill = surveyCodexCorpus(corpus).skills[0];

    expect(skill?.descriptionLength).toBe('twelve chars'.length);
  });

  it('records entry and sidecar hashes', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'hashed', { sidecar: 'interface: {}\n' });

    const skill = surveyCodexCorpus(corpus).skills[0];

    expect(skill?.entrySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(skill?.sidecarSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(skill?.sidecarPresent).toBe(true);
  });

  it('leaves the sidecar hash null when there is no sidecar', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'bare');

    expect(surveyCodexCorpus(corpus).skills[0]?.sidecarSha256).toBeNull();
  });

  it('never records an absolute path', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'no-paths', { sidecar: 'interface: {}\n' });

    const snapshot = serializeCodexSnapshot(surveyCodexCorpus(corpus));

    expect(snapshot).not.toContain(corpus);
    expect(snapshot).not.toContain(tmpdir());
  });

  it('counts a license frontmatter key and an over-long description', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'licensed', { license: 'MIT', sidecar: 'interface: {}\n' });
    writeSkill(corpus, '.curated', 'long', {
      description: 'd'.repeat(1030),
      sidecar: 'interface: {}\n',
    });

    const { summary } = surveyCodexCorpus(corpus);

    expect(summary.withLicenseFrontmatter).toBe(1);
    expect(summary.overDescriptionLimit).toBe(1);
  });

  it('counts an unknown sidecar key', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'unknown-key', { sidecar: 'interface: {}\nfuture: {}\n' });
    writeSkill(corpus, '.curated', 'known-keys', { sidecar: 'interface: {}\n' });

    expect(surveyCodexCorpus(corpus).summary.unknownSidecarKeys).toBe(1);
  });
});

describe('determinism', () => {
  it('serializes the same corpus identically every time', () => {
    const corpus = temporaryRoot();
    writeSkill(corpus, '.curated', 'zeta', { sidecar: 'interface: {}\n' });
    writeSkill(corpus, '.curated', 'alpha', { sidecar: 'dependencies: {}\n' });
    writeSkill(corpus, '.system', 'beta');

    const first = serializeCodexSnapshot(surveyCodexCorpus(corpus));
    const second = serializeCodexSnapshot(surveyCodexCorpus(corpus));

    expect(second).toBe(first);
    // Skills are grouped by collection and sorted by name inside each one, so
    // enumeration order cannot leak into the snapshot.
    const names = surveyCodexCorpus(corpus).skills.map((skill) => skill.name);
    expect(names).toEqual(['alpha', 'zeta', 'beta']);
  });

  it('is unaffected by the order the filesystem hands back', () => {
    const corpus = temporaryRoot();
    for (const name of ['mike', 'alpha', 'zulu', 'bravo']) {
      writeSkill(corpus, '.curated', name, { sidecar: 'interface: {}\n' });
    }

    const names = surveyCodexCorpus(corpus).skills.map((skill) => skill.name);

    expect(names).toEqual(['alpha', 'bravo', 'mike', 'zulu']);
  });
});

describe('arguments', () => {
  it('accepts a corpus root and an out path', () => {
    expect(parseCodexSurveyArgs(['/corpus/skills', '--out', 'snap.json'])).toEqual({
      corpusRoot: '/corpus/skills',
      out: 'snap.json',
    });
  });

  it('drops the separator a package script forwards', () => {
    expect(parseCodexSurveyArgs(['--', '/corpus/skills'])).toEqual({
      corpusRoot: '/corpus/skills',
      out: 'docs/data/openai-skills-49f948fa-codex-profile-survey.json',
    });
  });

  it('accepts --out=<path>', () => {
    expect(parseCodexSurveyArgs(['/corpus', '--out=other.json']).out).toBe('other.json');
  });

  it('reports a missing corpus root', () => {
    expect(parseCodexSurveyArgs([]).corpusRoot).toBeUndefined();
  });
});
