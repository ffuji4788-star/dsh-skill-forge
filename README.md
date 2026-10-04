# DeepSeek Harness Skill Forge

`dsh-skill-forge` is an open-source CLI project intended to read, analyze,
normalize, compatibility-check, convert, validate and test skills from AI coding
agent ecosystems (Claude Code, Codex, OpenCode, ...) so that they can be adapted
for use with DeepSeek Harness.

The long-term goal is a skill conversion toolchain. **Only local skill analysis
exists so far.**

## Current status

**Phase 1 / Local Skill Analyzer.**

The CLI can read a local skill and report what it contains. Nothing is converted,
validated for DeepSeek Harness, imported from the network, or sent to a model.

## What actually works today

Requires Node.js per the `engines` field in `package.json` (currently `>=20.19.0`)
and pnpm.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev -- --help
pnpm dev -- --version
pnpm dev -- analyze fixtures/valid-skill
```

### Analyzing a skill

```bash
dsh-forge analyze <path>
```

The path may be either:

- a single Markdown file, for example `SKILL.md`;
- a directory, in which case `SKILL.md` is used when present. If it is absent, a
  single top-level Markdown file is accepted. If several top-level Markdown files
  exist, analysis **fails with an ambiguity error** rather than picking one.

Discovery is top-level only; Phase 1 does not search nested directories.

Example output:

```text
Skill Analysis

Name: example-skill
Description: A minimal example skill used to verify local skill analysis.
Entry File: fixtures/valid-skill/SKILL.md
Resources: 2
Body Length: 218
Frontmatter Keys: name, description

Basic Checks:
  Name: PASS
  Description: PASS
  Kebab Case: PASS

Resource Files:
  extra/config.json
  reference.md
```

The report includes the frontmatter keys, the Markdown body length, the number of
resource files, and three checks: the `name` is present, the `description` is
present, and the `name` is kebab-case. Bad input (a missing path, malformed YAML
frontmatter, or an ambiguous directory) exits with a non-zero status and a
readable error on stderr.

`pnpm build` compiles TypeScript to `dist/`, producing a runnable CLI:

```bash
node dist/src/cli/index.js analyze fixtures/valid-skill
# or, after `pnpm link` / a global install, the `dsh-forge` binary
```

The CLI reads its version, description and the Node.js requirement it prints
from the nearest `package.json` found at or above the current working directory,
so none of them can drift from the published package.

## Not implemented yet

None of the following exists, not even as a stub:

- Universal skill IR (intermediate representation)
- DSH compatibility validation
- Claude / Codex / OpenCode adapters
- Skill conversion or rewriting
- GitHub import
- License analysis
- DeepSeek or any other LLM provider integration
- AI-assisted rewriting
- Skill installer, registry or marketplace
- Web UI

Conversion, validation and import commands do not exist, so passing `convert`,
`validate` or `import` returns an unknown-command error.

## Project layout

```text
src/
├── cli/          # CLI entry point, program definition, run loop, analyze command
├── importers/    # local-importer.ts — reads a skill from disk
├── parsers/      # frontmatter-parser.ts — YAML frontmatter and Markdown body
├── analyzers/    # basic-skill-analyzer.ts — Phase 1 checks and counts
├── schemas/      # skill.ts — the minimal ParsedSkill shape
├── utils/        # package metadata, error types, error formatting
├── adapters/     # (empty) ecosystem adapters — future phase
├── validators/   # (empty) validation — future phase
└── llm/          # (empty) model providers — future phase
tests/            # Vitest test suites
fixtures/         # skills used by the tests, including deliberately broken ones
```

`src/adapters`, `src/validators` and `src/llm` are reserved module boundaries.
They contain no code, no interfaces and no placeholders; files are added when a
phase implements them.

## Development scripts

| Script              | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `pnpm dev`          | Run the CLI from TypeScript sources via tsx |
| `pnpm build`        | Compile to `dist/` with `tsc`               |
| `pnpm clean`        | Remove `dist/`                              |
| `pnpm test`         | Run the Vitest suite once                   |
| `pnpm test:watch`   | Run Vitest in watch mode                    |
| `pnpm typecheck`    | Type-check sources and tests, no emit       |
| `pnpm lint`         | Run ESLint over the repository              |
| `pnpm format`       | Format with Prettier                        |
| `pnpm format:check` | Check formatting without writing            |

## Security stance

All third-party skills, files and repositories are treated as **untrusted
input**. `dsh-skill-forge` does not automatically execute anything from a
third-party skill: no shell or PowerShell commands, no Python, no npm lifecycle
scripts, no executables or binaries.

When analyzing a skill, its resources are only enumerated and read. The fixtures
under `fixtures/script-resources` contain real `.sh`, `.ps1`, `.py` and `.bat`
files that each leave a marker file behind if executed; the test suite asserts
that no marker ever appears.

See [SECURITY.md](./SECURITY.md). No API key, token or secret is read or stored,
and `.env` is git-ignored while `.env.example` is tracked.

## Requirements

- Node.js >= 20.19.0
- pnpm

## License

MIT — see [LICENSE](./LICENSE).
