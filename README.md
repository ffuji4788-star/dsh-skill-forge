# DeepSeek Harness Skill Forge

`dsh-skill-forge` is an open-source CLI project intended to read, analyze,
normalize, compatibility-check, convert, validate and test skills from AI coding
agent ecosystems (Claude Code, Codex, OpenCode, ...) so that they can be adapted
for use with DeepSeek Harness.

The long-term goal is a skill conversion toolchain. **Local analysis, structural
validation, pinned DeepSeek Harness compatibility checking, canonical Universal
Skill IR normalization, safe DSH package conversion and an Agent Skills source
adapter exist so far.**

## Current status

**Phase 6 / Agent Skills source adapter.**

Five commands exist, and they answer five different questions:

| Command                                                                 | Question it answers                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `dsh-forge analyze <path>`                                              | What is in this skill?                                                         |
| `dsh-forge validate <path>`                                             | Is the skill structurally sound?                                               |
| `dsh-forge compat <path>`                                               | Would the pinned DeepSeek Harness skill implementation accept and discover it? |
| `dsh-forge normalize <path>`                                            | What is the canonical, platform-neutral representation of this skill?          |
| `dsh-forge convert <path> [--source <source>] --target dsh --out <dir>` | What does this skill look like as a DeepSeek Harness package?                  |

Anything the tool cannot carry faithfully, it refuses rather than dropping.
Nothing is imported from the network, sent to a model, or executed.

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
pnpm dev -- convert fixtures/convert/minimal --target dsh --out ./generated/minimal
pnpm dev -- convert fixtures/sources/agent-skills/pdf-processing --source agent-skills --target dsh --out ./generated/pdf
```

All five commands accept the same kinds of path:

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

### Converting to a DeepSeek Harness package

```bash
dsh-forge convert ./my-skill --target dsh --out ./generated/my-skill
```

Phase 5 performs **lossless conversion from Universal Skill IR v1 to the pinned
DSH target contract** (`deepseek-ai/deepseek-harness@5badb15009ae`). It writes a
directory containing `SKILL.md` and the skill's resources:

```text
DSH Conversion

Target: DeepSeek Harness
Contract: deepseek-ai/deepseek-harness@5badb15009ae
Contract verified: 2026-10-04

Source: fixtures/convert/minimal
Output: D:\generated\minimal

Result: SUCCESS
Files: 1
  SKILL.md
```

Two rules matter most:

- **If un-interpreted `source.extraFrontmatter` is present, conversion is
  refused** rather than silently dropping it. A source key such as `author`,
  `version`, `metadata`, `whenToUse` or `disable-model-invocation` has no mapping
  yet, so the tool stops and lists it instead of guessing. There is deliberately
  no `--allow-lossy` or `--force` flag.
- **Existing output directories are never overwritten.** If `--out` already
  exists, the conversion is refused and the existing path is left untouched.

The package is written to a staging directory beside the output and fully
re-validated — generic validation plus pinned DSH compatibility — before being
renamed into place, so a failed conversion leaves nothing behind. Resources are
copied byte-for-byte and are never executed; symbolic links and other special
files are refused, and paths that would not be portable to a Windows target are
refused too.

Full rules: [docs/dsh-target-adapter.md](./docs/dsh-target-adapter.md).

`content is preserved; filesystem metadata preservation is limited.` Timestamps,
ownership, ACLs and POSIX modes are not part of the conversion contract.

### Agent Skills source

A standard [Agent Skills](https://agentskills.io) package can be read explicitly:

```bash
dsh-forge convert ./my-agent-skill \
  --source agent-skills \
  --target dsh \
  --out ./generated/my-skill
```

`--source` is an explicit opt-in. Omitting it keeps the generic local path, and
the source is **never** guessed from a directory's contents — a skill that looks
like an Agent Skill is still read generically unless you say otherwise.

The source contract is pinned to `agentskills/agentskills@69ef37e9424c` and is
verified against the specification, its reference validator, and Anthropic's
public implementation as secondary evidence. A package must be a directory whose
entry is `SKILL.md` (then `skill.md`); a bare Markdown file is refused rather than
silently read as something else.

**Currently supported lossless subset: `name`, `description`, `instructions` and
`resources`.**

The optional Agent Skills fields — `license`, `compatibility`, `metadata` and
`allowed-tools` — are validated and preserved verbatim in the IR's
`source.extraFrontmatter`, but **conversion to DSH is currently refused** with
`UNMAPPED_SOURCE_FRONTMATTER` rather than dropping or guessing them. Mapping
`compatibility` onto a DSH field, or assuming a source `metadata` key means what a
same-named DSH key means, would be a guess; that mapping needs a later phase. A
skill therefore converts when its frontmatter is exactly `name` and `description`.

Source validation and generic IR validation are separate, and they can disagree. A
name like `数据处理` is a valid Agent Skills name but is outside what Universal
Skill IR v1 can represent; that case is reported as
`SOURCE_VALID_BUT_IR_UNSUPPORTED` and states that it is not a source adapter
defect.

Full rules, including every documented divergence between the standard, its
reference validator and Anthropic's helper: [docs/agent-skills-source-contract.md](./docs/agent-skills-source-contract.md).

This is **not** a claim that every Claude skill converts automatically. There is
one source adapter, no adapter registry, and no automatic detection.

### Exit codes

| Code | Meaning                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Analysis completed / validation passed / compatible / IR produced / package written                                                                                                                                               |
| `1`  | Fatal input, filesystem or parser error, for example a missing path, malformed YAML frontmatter, an ambiguous directory, or a failed finalize                                                                                     |
| `2`  | The operation completed and was refused: `validate` found an `error` issue, `compat` found the skill incompatible, `normalize` hit the generic validation gate, or `convert` refused the source, environment or generated package |

A refused check is a normal outcome: for `validate`, `compat` and `convert` the
report is written to stdout with a non-zero code. `normalize` writes nothing to
stdout when it refuses, so a redirect never produces a half-written document. A
fatal error is written to stderr. A malformed frontmatter block is always fatal
(`1`) and is never reported as a validation or compatibility issue, because the
skill could not be read in the first place. A source contract violation — an
unknown frontmatter field, a name/directory mismatch — is a deterministic refusal
(`2`), not a crash.

`pnpm build` compiles TypeScript to `dist/`, producing a runnable CLI:

```bash
node dist/src/cli/index.js convert fixtures/sources/agent-skills/pdf-processing \
  --source agent-skills --target dsh --out ./generated/pdf
# or, after `pnpm link` / a global install, the `dsh-forge` binary
```

The CLI reads its version, description and the Node.js requirement it prints
from the nearest `package.json` found at or above the current working directory,
so none of them can drift from the published package.

## Not implemented yet

None of the following exists, not even as a stub:

- Claude / Codex / OpenCode **source** adapters (reading other ecosystems' skills)
- A source or target adapter registry, or any target other than `dsh`
- Automatic migration
- GitHub import
- License analysis or rewriting
- Provenance analysis
- DeepSeek or any other LLM provider integration
- AI-assisted rewriting
- Skill installer, registry or marketplace
- Web UI

`import` and `install` do not exist, so passing them returns an unknown-command
error. `convert` supports exactly one target (`--target dsh`) and explicitly
selects at most one source (`--source agent-skills` or `--source generic-local`);
there is no Claude, Codex or OpenCode conversion, and no automatic source
detection. `compat` reports whether the **pinned** DeepSeek Harness implementation
would accept a skill — it makes no claim about future upstream revisions.
`normalize` produces a canonical representation only, and writes nothing.

Universal Skill IR v1 does **not** mean universal skill semantic equivalence — it
is a stable canonical representation, not a completed mapping of every platform's
vocabulary. See [docs/skill-ir-v1.md](./docs/skill-ir-v1.md).

## Project layout

```text
src/
├── cli/          # entry point, program definition, run loop, and the five commands
├── importers/    # local-importer.ts, skill-files.ts — reads a skill from disk
├── parsers/      # frontmatter-parser.ts — YAML frontmatter and Markdown body
├── analyzers/    # basic-skill-analyzer.ts — describes a skill
├── validators/   # basic-skill-validator.ts — platform-independent structural rules
├── sources/
│   └── agent-skills/  # pinned Agent Skills contract, source validator, source adapter
├── targets/
│   └── dsh/      # pinned contract, invocation policy, compatibility validator, target adapter
├── ir/           # skill-ir.ts, normalize-skill.ts, serialize-skill-ir.ts, json-value.ts
├── conversion/   # source-adapter.ts, convert-skill.ts, resource-collector.ts
├── schemas/      # skill.ts, validation.ts, compatibility.ts, conversion.ts
├── utils/        # exit codes, skill-name rule, path boundary, error types, package metadata
├── adapters/     # (empty) further ecosystem adapters — future phase
└── llm/          # (empty) model providers — future phase
docs/             # dsh-compatibility-contract.md, skill-ir-v1.md, dsh-target-adapter.md,
                  # agent-skills-source-contract.md
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

`analyze`, `validate`, `compat` and `normalize` only read: resources are
enumerated and read, never run, and no input file is modified. `.gitattributes`
pins text files to LF so a Windows checkout cannot rewrite them. `compat`
additionally performs no network access — its contract is pinned at development
time. `normalize` writes nothing itself: it prints the IR to stdout and leaves
redirection to the shell, so it never creates or overwrites a file, and it never
rewrites the skill it reads.

`convert` is the only command that writes, and it writes only inside its staging
directory and the requested output directory — never into the source skill. It
refuses an existing output path, never overwrites, copies resources byte-for-byte
without executing them, and leaves no partial package behind if anything fails.
It performs no network access.

Reading an Agent Skill is not different in kind: the source adapter only reads,
parses, validates and adapts. `scripts/`, `references/` and `assets/` are
enumerated and copied, and a script in an Agent Skills package is never run. The
Agent Skills contract itself is pinned at development time, so selecting
`--source agent-skills` still performs no network access.

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
