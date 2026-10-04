# DeepSeek Harness Skill Forge

`dsh-skill-forge` is an open-source CLI project intended to read, analyze,
normalize, compatibility-check, convert, validate and test skills from AI coding
agent ecosystems (Claude Code, Codex, OpenCode, ...) so that they can be adapted
for use with DeepSeek Harness.

The long-term goal is a skill conversion toolchain. **Only local skill analysis
and local structural validation exist so far.**

## Current status

**Phase 2 / Deterministic Skill Validator.**

The CLI can read a local skill, report what it contains, and check it against a
fixed set of structural rules. Nothing is converted, checked for DeepSeek Harness
compatibility, imported from the network, or sent to a model. Validation is
deterministic: the same input always produces the same issues in the same order,
with no network access and no execution of anything found beside the skill.

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
pnpm dev -- validate fixtures/validate-valid
```

Both commands accept the same kinds of path:

- a single Markdown file, for example `SKILL.md`;
- a directory, in which case `SKILL.md` is used when present. If it is absent, a
  single top-level Markdown file is accepted. If several top-level Markdown files
  exist, the command **fails with an ambiguity error** rather than picking one.

Discovery is top-level only; nested directories are not searched.

### Analyzing a skill

```bash
dsh-forge analyze <path>
```

Example output:

```text
Skill Analysis

Name: example-skill
Description: A minimal example skill used to verify local skill analysis.
Entry File: SKILL.md
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
present, and the `name` is kebab-case. `analyze` reports; it does not fail a
skill, so it exits `0` even when a check shows `FAIL`.

### Validating a skill

```bash
dsh-forge validate <path>
```

The Phase 2 validator performs **deterministic local structural validation**. The
current rules are:

| Rule                                                                      | Severity |
| ------------------------------------------------------------------------- | -------- |
| `name` is present                                                         | error    |
| `name` is not empty                                                       | error    |
| `name` is kebab-case                                                      | error    |
| `name` contains no path separator, traversal segment or control character | error    |
| `description` is present                                                  | error    |
| `description` is not empty or whitespace only                             | error    |
| the Markdown body is not empty                                            | error    |
| every frontmatter key is known (`name`, `description`)                    | warning  |

An unknown frontmatter key is only a warning, so a skill carrying extra metadata
still passes.

Example output for a skill with a warning:

```text
Skill Validation

Name: validate-warning-unknown-key
Entry File: SKILL.md

Result: PASS
Errors: 0
Warnings: 2

Warnings
- UNKNOWN_FRONTMATTER_KEY: Unknown frontmatter key: author
- UNKNOWN_FRONTMATTER_KEY: Unknown frontmatter key: version
```

Example output for a skill that fails:

```text
Skill Validation

Name: (none)
Entry File: SKILL.md

Result: FAIL
Errors: 1
Warnings: 0

Errors
- MISSING_NAME: Missing required field: name
```

### Exit codes

| Code | Meaning                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Validation passed (warnings allowed) / analysis completed                                                                 |
| `1`  | Fatal input, filesystem or parser error, for example a missing path, malformed YAML frontmatter or an ambiguous directory |
| `2`  | Validation completed and found at least one `error` severity issue                                                        |

A validation failure is a normal outcome: the report is written to stdout and the
exit code carries the status. A fatal error is written to stderr. A malformed
frontmatter block is always fatal (`1`) and is never reported as a validation
issue, because the skill could not be read in the first place.

`pnpm build` compiles TypeScript to `dist/`, producing a runnable CLI:

```bash
node dist/src/cli/index.js validate fixtures/validate-valid
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

Conversion, compatibility checking and import commands do not exist, so passing
`convert`, `import` or `install` returns an unknown-command error. The
`validate` command checks local structure only; it does **not** decide whether a
skill is compatible with DeepSeek Harness.

## Project layout

```text
src/
├── cli/          # entry point, program definition, run loop, analyze/validate commands
├── importers/    # local-importer.ts — reads a skill from disk
├── parsers/      # frontmatter-parser.ts — YAML frontmatter and Markdown body
├── analyzers/    # basic-skill-analyzer.ts — describes a skill
├── validators/   # basic-skill-validator.ts — structural rules and issue codes
├── schemas/      # skill.ts (ParsedSkill), validation.ts (issues and result)
├── utils/        # exit codes, skill-name rule, error types, package metadata
├── adapters/     # (empty) ecosystem adapters — future phase
└── llm/          # (empty) model providers — future phase
tests/            # Vitest test suites
fixtures/         # skills used by the tests, including deliberately broken ones
```

`src/adapters` and `src/llm` are reserved module boundaries. They contain no
code, no interfaces and no placeholders; files are added when a phase implements
them.

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

Both commands only read: resources are enumerated and read, never run, and no
input file is modified. `.gitattributes` pins text files to LF so a Windows
checkout cannot rewrite them.

The fixtures under `fixtures/script-resources` contain real `.sh`, `.ps1`, `.py`
and `.bat` files that each leave a marker file behind if executed; the test suite
asserts that no marker ever appears.

See [SECURITY.md](./SECURITY.md). No API key, token or secret is read or stored,
and `.env` is git-ignored while `.env.example` is tracked.

## Requirements

- Node.js >= 20.19.0
- pnpm

## License

MIT — see [LICENSE](./LICENSE).
