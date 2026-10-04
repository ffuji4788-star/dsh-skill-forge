/**
 * Converting an Agent Skills package into a DSH package through the real CLI.
 *
 * The end-to-end property under test is the one Phase 6 exists for: a minimal
 * standard Agent Skill reaches the DSH target, and anything the IR cannot carry
 * faithfully is refused instead of being dropped.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { loadAgentSkill } from '../src/sources/agent-skills/agent-skills-source-adapter.js';
import { AGENT_SKILLS_CODES } from '../src/sources/agent-skills/agent-skills-validator.js';
import { SOURCE_CODES } from '../src/conversion/source-adapter.js';
import { CONVERSION_CODES } from '../src/schemas/conversion.js';
import { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from '../src/utils/exit-codes.js';

const repositoryRoot = process.cwd();
const agentFixtureRoot = path.join(repositoryRoot, 'fixtures', 'sources', 'agent-skills');
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-forge-agent-cli-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface CapturedRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(...argv: string[]): Promise<CapturedRun> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli({
    argv,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr };
}

/** Lists every file in a package, `/`-separated and sorted. */
function listPackage(root: string): string[] {
  const found: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else {
        found.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }

  return found.sort();
}

describe('Agent Skills to DSH', () => {
  it('converts a minimal Agent Skill end to end', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout, stderr } = await run(
      'convert',
      'fixtures/sources/agent-skills/pdf-processing',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: SUCCESS');
    expect(stdout).toContain('Source adapter: agent-skills');
    expect(stdout).toContain('Source contract: agentskills/agentskills@69ef37e9424c');
    expect(listPackage(out)).toEqual(['SKILL.md']);

    const generated = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    expect(generated).toContain('name: pdf-processing');
    expect(generated).toContain('description: Extract PDF text');
    expect(generated).toContain('# PDF Processing');
  });

  it('produces a package that is generically valid and DSH compatible', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await run(
      'convert',
      'fixtures/sources/agent-skills/pdf-processing',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    const validate = await run('validate', out);
    const compat = await run('compat', out);

    expect(validate.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.exitCode).toBe(EXIT_SUCCESS);
    expect(compat.stdout).toContain('Result: COMPATIBLE');
  });

  it('copies resources from an Agent Skills package', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode } = await run(
      'convert',
      'fixtures/sources/agent-skills/data-analysis',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(listPackage(out)).toEqual(['SKILL.md', 'assets/schema.json', 'references/GUIDE.md']);
  });

  it('preserves the instructions byte-for-byte', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    await run(
      'convert',
      'fixtures/sources/agent-skills/pdf-processing',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    const loaded = loadAgentSkill(path.join(agentFixtureRoot, 'pdf-processing'), repositoryRoot);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const generated = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
      expect(generated.endsWith(loaded.skill.body)).toBe(true);
    }
  });

  it('accepts a lowercase skill.md entry', async () => {
    const root = temporaryRoot();
    const skill = path.join(root, 'lowercase-entry');
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      path.join(skill, 'skill.md'),
      '---\nname: lowercase-entry\ndescription: d\n---\n\n# Lower\n',
    );

    const out = path.join(root, 'generated');
    const { exitCode } = await run(
      'convert',
      skill,
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(existsSync(path.join(out, 'SKILL.md'))).toBe(true);
  });

  it('refuses a bare Markdown file rather than guessing a source', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/sources/agent-skills/pdf-processing/SKILL.md',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(SOURCE_CODES.notADirectory);
    expect(existsSync(out)).toBe(false);
  });
});

describe('optional source semantics and the target', () => {
  // Phase 7 lifted license/compatibility/metadata into portable semantics, so the
  // refusal for a *known* semantic is now UNSUPPORTED_TARGET_SEMANTIC rather than
  // UNMAPPED_SOURCE_FRONTMATTER. The distinction is deliberate: the meaning is
  // known, and this target simply has no field for it.
  it.each([
    ['license', 'with-license', 'license'],
    ['compatibility', 'with-compatibility-check', 'compatibility'],
  ])(
    'refuses %s with UNSUPPORTED_TARGET_SEMANTIC rather than dropping it',
    async (_label, fixture, field) => {
      const out = path.join(temporaryRoot(), 'generated');
      const { exitCode, stdout, stderr } = await run(
        'convert',
        `fixtures/sources/agent-skills/${fixture}`,
        '--source',
        'agent-skills',
        '--target',
        'dsh',
        '--out',
        out,
      );

      expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
      expect(stderr).toBe('');
      expect(stdout).toContain(CONVERSION_CODES.unsupportedTargetSemantic);
      expect(stdout).toContain(`- ${field}`);
      expect(stdout).toContain('No output was created.');
      expect(existsSync(out)).toBe(false);
    },
  );

  it('converts a metadata-only Agent Skill and preserves its metadata', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout, stderr } = await run(
      'convert',
      'fixtures/sources/agent-skills/with-metadata-check',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toBe('');
    expect(stdout).toContain('Result: SUCCESS');
    expect(existsSync(path.join(out, 'SKILL.md'))).toBe(true);
  });

  it('refuses allowed-tools as unmapped source data, not as a target semantic', async () => {
    // allowed-tools is never promoted: it is an experimental tool vocabulary,
    // not a portable package semantic, so it stays raw source data.
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/sources/agent-skills/with-allowed-tools-check',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(CONVERSION_CODES.unmappedSourceFrontmatter);
    expect(stdout).not.toContain(CONVERSION_CODES.unsupportedTargetSemantic);
    expect(stdout).toContain('- allowed-tools');
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a skill declaring every optional field, naming the unmapped source field', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/sources/agent-skills/with-all-optionals-check',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    // Unmapped source data is reported first: until every source field has a
    // home, the target's own semantic gaps are not yet the blocking question.
    expect(stdout).toContain(CONVERSION_CODES.unmappedSourceFrontmatter);
    expect(stdout).toContain('- allowed-tools');
    expect(existsSync(out)).toBe(false);
  });
});

describe('source contract refusals', () => {
  it('refuses an unknown frontmatter field at the source adapter', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/sources/agent-skills/unknown-key-check',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(AGENT_SKILLS_CODES.unknownFrontmatterKey);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a directory-name mismatch', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/sources/agent-skills/name-directory-mismatch',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(AGENT_SKILLS_CODES.nameDirectoryMismatch);
    expect(existsSync(out)).toBe(false);
  });

  it('reports a source-valid skill the IR cannot represent distinctly', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      path.join(agentFixtureRoot, '数据处理'),
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(SOURCE_CODES.sourceValidIrUnsupported);
    expect(stdout).toContain('not a source adapter defect');
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an unknown source name', async () => {
    const out = path.join(temporaryRoot(), 'generated');
    const { exitCode, stdout } = await run(
      'convert',
      'fixtures/convert/minimal',
      '--source',
      'claude',
      '--target',
      'dsh',
      '--out',
      out,
    );

    expect(exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(stdout).toContain(SOURCE_CODES.unknownSource);
    expect(existsSync(out)).toBe(false);
  });
});

describe('generic conversion is unchanged', () => {
  it('omitting --source keeps the generic path and the exact same bytes', async () => {
    const withoutSource = path.join(temporaryRoot(), 'generic');
    const withSource = path.join(temporaryRoot(), 'explicit-generic');

    const first = await run(
      'convert',
      'fixtures/convert/with-directory-resource',
      '--target',
      'dsh',
      '--out',
      withoutSource,
    );
    const second = await run(
      'convert',
      'fixtures/convert/with-directory-resource',
      '--source',
      'generic-local',
      '--target',
      'dsh',
      '--out',
      withSource,
    );

    expect(first.exitCode).toBe(EXIT_SUCCESS);
    expect(second.exitCode).toBe(EXIT_SUCCESS);
    expect(first.stdout).toContain('Source adapter: generic-local');
    expect(listPackage(withSource)).toEqual(listPackage(withoutSource));

    for (const relative of listPackage(withoutSource)) {
      expect(readFileSync(path.join(withSource, relative))).toEqual(
        readFileSync(path.join(withoutSource, relative)),
      );
    }
  });

  it('does not treat an Agent Skills package as generic entry selection', async () => {
    // A directory whose only Markdown is README.md has no generic entry either,
    // so this asserts the generic path is not silently relaxed.
    const { exitCode } = await run('analyze', 'fixtures/sources/agent-skills/data-analysis');

    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it('advertises the --source option only as an explicit opt-in', async () => {
    const { stdout } = await run('convert', '--help');

    expect(stdout).toContain('--source <source>');
    expect(stdout).toContain('omit for the generic local path');
  });

  it('rejects an unknown command with exit code 1', async () => {
    const { exitCode, stderr } = await run('migrate');

    expect(exitCode).toBe(EXIT_FATAL);
    expect(stderr).toContain('unknown command');
  });
});

describe('determinism across sources', () => {
  it('produces identical packages for the same Agent Skill in two locations', async () => {
    const first = path.join(temporaryRoot(), 'first');
    const second = path.join(temporaryRoot(), 'second');

    await run(
      'convert',
      'fixtures/sources/agent-skills/data-analysis',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      first,
    );
    await run(
      'convert',
      'fixtures/sources/agent-skills/data-analysis',
      '--source',
      'agent-skills',
      '--target',
      'dsh',
      '--out',
      second,
    );

    expect(listPackage(second)).toEqual(listPackage(first));
    for (const relative of listPackage(first)) {
      expect(readFileSync(path.join(second, relative))).toEqual(
        readFileSync(path.join(first, relative)),
      );
    }
  });
});
