# DeepSeek Harness Skill Forge

`dsh-skill-forge` is an open-source CLI project intended to read, analyze,
normalize, compatibility-check, convert, validate and test skills from AI coding
agent ecosystems (Claude Code, Codex, OpenCode, ...) so that they can be adapted
for use with DeepSeek Harness.

The long-term goal is a skill conversion toolchain. **Only local skill analysis,
local structural validation, pinned DeepSeek Harness compatibility checking and
canonical Universal Skill IR normalization exist so far.**

## Current status

**Phase 4 / Universal Skill IR v1.**

Four commands exist, and they answer four different questions:

| Command                      | Question it answers                                                            |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `dsh-forge analyze <path>`   | What is in this skill?                                                         |
| `dsh-forge validate <path>`  | Is the skill structurally sound?                                               |
| `dsh-forge compat <path>`    | Would the pinned DeepSeek Harness skill implementation accept and discover it? |
| `dsh-forge normalize <path>` | What is the canonical, platform-neutral representation of this skill?          |

Nothing is converted, imported from the network, or sent to a model. Every
command is deterministic and offline: the same input always produces the same
report in the same order, and nothing found beside a skill is ever executed.

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
pnpm dev -- compat fixtures/dsh/compatible-minimal
pnpm dev -- normalize fixtures/normalize/minimal
```

All four commands accept the same kinds of path:

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

### Checking DeepSeek Harness compatibility

```bash
dsh-forge compat <path>
```

Compatibility is evaluated against:

```text
deepseek-ai/deepseek-harness@5badb15009ae
```

The contract is pinned to one upstream commit and researched at development
time. `compat` performs **no network access**; it never asks GitHub what the rules
are today. The rules implemented are documented in
[docs/dsh-compatibility-contract.md](./docs/dsh-compatibility-contract.md),
including the upstream files they were read from.

Example output:

```text
DSH Compatibility

Target: DeepSeek Harness
Contract: deepseek-ai/deepseek-harness@5badb15009ae
Contract verified: 2026-10-04

Name: dsh-minimal
Entry File: SKILL.md

Result: COMPATIBLE
Errors: 0
Warnings: 0
```

Example with warnings:

```text
Result: COMPATIBLE_WITH_WARNINGS
Errors: 0
Warnings: 2

Warnings
- DSH_IGNORED_FRONTMATTER_KEY: frontmatter key "author" is ignored by the pinned DSH contract
- DSH_IGNORED_FRONTMATTER_KEY: frontmatter key "version" is ignored by the pinned DSH contract
```

Example that fails the pinned contract:

```text
Result: INCOMPATIBLE
Errors: 1
Warnings: 0

Errors
- DSH_INVALID_INVOCATION_VALUE: frontmatter field "user-invocable" must be a boolean
```

#### What `compat` checks

| Rule                                                                           | Severity |
| ------------------------------------------------------------------------------ | -------- |
| `name` is a non-empty string matching `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`           | error    |
| `description` is a non-empty string                                            | error    |
| `whenToUse` is a usable string (otherwise ignored upstream)                    | warning  |
| `metadata` is an object (otherwise ignored upstream)                           | warning  |
| `disable-model-invocation` / `user-invocable` use an accepted boolean spelling | error    |
| legacy `disableModelInvocation` / `modelInvocable` / `userInvocable` keys      | error    |
| frontmatter keys the contract does not read                                    | warning  |
| empty Markdown body (accepted upstream, injects nothing)                       | warning  |

Compatibility is deliberately **not** the same as generic validation. Where the
pinned implementation is lenient, this profile is lenient too: a whitespace-only
`description` fails `dsh-forge validate` but is `COMPATIBLE`, because upstream
only requires a non-empty string. An empty body is a generic error but only a
compatibility warning, because upstream accepts it.

`compat` reports **package** compatibility. It cannot know which scanned root a
skill will be installed into, so it states that the installation and discovery
location is not verified.

DeepSeek Harness is in **developer preview**. Future upstream changes may require
updating this compatibility profile; the pinned commit above is what the current
results describe.

### Normalizing a skill to Universal Skill IR

```bash
dsh-forge normalize <path>
```

`normalize` emits the canonical, platform-neutral **Universal Skill IR v1** for a
skill that already passes generic structural validation. stdout carries the JSON
document and nothing else, so it can be redirected straight to a file:

```bash
dsh-forge normalize ./my-skill > my-skill.ir.json
```

Example output:

```json
{
  "schemaVersion": 1,
  "name": "normalize-minimal",
  "description": "The smallest skill that can be normalized into Universal Skill IR v1.",
  "instructions": "\n# Normalize Minimal\n\nRequired frontmatter only, so the IR contains no extra frontmatter.\n",
  "resources": [],
  "source": {
    "format": "generic-local-skill",
    "entryFile": "SKILL.md",
    "extraFrontmatter": {}
  }
}
```

The IR treats exactly three fields as universal — `name`, `description` and
`instructions` — and preserves every other frontmatter field verbatim in
`source.extraFrontmatter`, so nothing is lost and nothing is guessed at. It
carries no absolute paths, no resource contents, and no target-specific
vocabulary. The full contract is in
[docs/skill-ir-v1.md](./docs/skill-ir-v1.md).

If generic validation fails, `normalize` produces **no** IR — not even a partial
one — and exits `2`. That is a deliberate IR v1 invariant, and it means
compatibility and normalization are independent:

```text
$ dsh-forge compat fixtures/dsh/whitespace-description   # exit 0, COMPATIBLE
$ dsh-forge validate fixtures/dsh/whitespace-description # exit 2, EMPTY_DESCRIPTION
$ dsh-forge normalize fixtures/dsh/whitespace-description # exit 2, refused
```

### Exit codes

| Code | Meaning                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Analysis completed / validation passed / compatible / IR produced                                                                                                 |
| `1`  | Fatal input, filesystem or parser error, for example a missing path, malformed YAML frontmatter or an ambiguous directory                                         |
| `2`  | The operation completed and was refused: `validate` found an `error` issue, `compat` found the skill incompatible, or `normalize` hit the generic validation gate |

A refused check is a normal outcome: for `validate` and `compat` the report is
written to stdout with a non-zero code. `normalize` writes nothing to stdout when
it refuses, so a redirect never produces a half-written document. A fatal error is
written to stderr. A malformed frontmatter block is always fatal (`1`) and is never
reported as a validation or compatibility issue, because the skill could not be
read in the first place.

`pnpm build` compiles TypeScript to `dist/`, producing a runnable CLI:

```bash
node dist/src/cli/index.js normalize fixtures/normalize/minimal
# or, after `pnpm link` / a global install, the `dsh-forge` binary
```

The CLI reads its version, description and the Node.js requirement it prints
from the nearest `package.json` found at or above the current working directory,
so none of them can drift from the published package.

## Not implemented yet

None of the following exists, not even as a stub:

- Skill conversion or rewriting
- DeepSeek Harness emitter or writer
- Claude / Codex / OpenCode adapters
- Source or target adapter registry
- Automatic migration
- GitHub import
- License analysis or rewriting
- Provenance analysis
- DeepSeek or any other LLM provider integration
- AI-assisted rewriting
- Skill installer, registry or marketplace
- Web UI

Conversion and import commands do not exist, so passing `convert`, `import` or
`install` returns an unknown-command error. `compat` answers a narrower question
than conversion: it reports whether the **pinned** DeepSeek Harness
implementation would accept and discover a skill — it does not migrate, rewrite or
install one, and it makes no claim about future upstream revisions. `normalize`
produces a canonical representation only; it does not write, convert or install
anything, and it emits no target-specific skill.

Universal Skill IR v1 does **not** mean universal skill semantic equivalence — it
is a stable canonical representation, not a completed mapping of every platform's
vocabulary. See [docs/skill-ir-v1.md](./docs/skill-ir-v1.md).

## Project layout

```text
src/
├── cli/          # entry point, program definition, run loop, analyze/validate/compat/normalize
├── importers/    # local-importer.ts — reads a skill from disk
├── parsers/      # frontmatter-parser.ts — YAML frontmatter and Markdown body
├── analyzers/    # basic-skill-analyzer.ts — describes a skill
├── validators/   # basic-skill-validator.ts — platform-independent structural rules
├── targets/
│   └── dsh/      # pinned DeepSeek Harness contract, invocation policy, compatibility validator
├── ir/           # skill-ir.ts, normalize-skill.ts, serialize-skill-ir.ts, json-value.ts
├── schemas/      # skill.ts, validation.ts (generic), compatibility.ts (target)
├── utils/        # exit codes, skill-name rule, error types, package metadata
├── adapters/     # (empty) ecosystem adapters — future phase
└── llm/          # (empty) model providers — future phase
docs/             # dsh-compatibility-contract.md, skill-ir-v1.md
tests/            # Vitest test suites
fixtures/         # skills used by the tests, including deliberately broken ones
```

The generic validator in `src/validators` stays platform-independent; everything
specific to DeepSeek Harness lives under `src/targets/dsh`, and the
platform-neutral IR lives in `src/ir` with no target vocabulary at all, so a
future upstream or adapter change touches one layer rather than the whole project.

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

All four commands only read: resources are enumerated and read, never run, and no
input file is modified. `.gitattributes` pins text files to LF so a Windows
checkout cannot rewrite them. `compat` additionally performs no network access —
its contract is pinned at development time. `normalize` writes nothing itself: it
prints the IR to stdout and leaves redirection to the shell, so it never creates
or overwrites a file, and it never rewrites the skill it reads.

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
