# DeepSeek Harness Skill Forge

`dsh-skill-forge` is an open-source CLI project intended to read, analyze,
normalize, compatibility-check, convert, validate and test skills from AI coding
agent ecosystems (Claude Code, Codex, OpenCode, ...) so that they can be adapted
for use with DeepSeek Harness.

The long-term goal is a skill conversion toolchain. **Local analysis, structural
validation, pinned DeepSeek Harness compatibility checking, canonical Universal
Skill IR (v1 and v2), safe DSH package conversion, an Agent Skills source adapter,
portable package semantics and read-only compatibility assessment exist so far.**

## Current status

**Phase 8 / Real-world compatibility assessment.**

Six commands exist, and they answer six different questions:

| Command                                                              | Question it answers                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `dsh-forge analyze <path>`                                           | What is in this skill?                                                         |
| `dsh-forge validate <path>`                                          | Is the skill structurally sound?                                               |
| `dsh-forge compat <path>`                                            | Would the pinned DeepSeek Harness skill implementation accept and discover it? |
| `dsh-forge normalize <path> [--source <src>] [--ir-version <1\|2>]`  | What is the canonical, platform-neutral representation of this skill?          |
| `dsh-forge assess <path> [--source <src>] --target dsh`              | Would this skill convert, and if not, why?                                     |
| `dsh-forge convert <path> [--source <src>] --target dsh --out <dir>` | What does this skill look like as a DeepSeek Harness package?                  |

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
dsh-forge normalize <path> [--source <source>] [--ir-version <1|2>]
```

`normalize` emits the canonical, platform-neutral **Universal Skill IR** for a
skill that already passes generic structural validation. stdout carries the JSON
document and nothing else, so it can be redirected straight to a file:

```bash
dsh-forge normalize ./my-skill > my-skill.ir.json
```

**IR v1 is the default and is frozen.** Omitting `--ir-version` produces
byte-identical output to every earlier release. IR v2 appears only when asked for:

```bash
# v2 for a generic skill: no source contract, so semantics stays empty
dsh-forge normalize ./my-skill --ir-version 2

# v2 for an Agent Skill: portable semantics are lifted out of the envelope
dsh-forge normalize ./my-skill --source agent-skills --ir-version 2
```

Naming a source never changes the version on its own, and an unknown version (for
example `--ir-version 3`) or a non-numeric one is refused rather than silently
defaulted. There is no `latest`.

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

Phase 5 performs **lossless conversion from the Universal Skill IR to the pinned
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

- **If a source field cannot be carried faithfully, conversion is refused** rather
  than silently dropping it. A field with no target counterpart is reported, with
  the reason distinguishing the two cases:
  - `UNSUPPORTED_TARGET_SEMANTIC` — the tool _interpreted_ the field (`license`,
    `compatibility`) but this target has nowhere to put it;
  - `UNMAPPED_SOURCE_FRONTMATTER` — the field is still raw source data with no
    interpretation and no home (`allowed-tools`, or any key the generic path read).

  There is deliberately no `--allow-lossy` or `--force` flag.

- **Existing output directories are never overwritten.** If `--out` already
  exists, the conversion is refused and the existing path is left untouched.

### What converts today

Conversion builds IR v2 internally, so a field the source adapter interpreted can
be carried instead of refused. For an Agent Skill that means:

| Agent Skills field                     | Result                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| `name`, `description`, body, resources | converted                                                            |
| `metadata`                             | **converted** — carried into the DSH frontmatter verbatim            |
| `license`                              | **converted** — preserved verbatim in a tool-owned metadata envelope |
| `compatibility`                        | refused: `UNSUPPORTED_TARGET_SEMANTIC`                               |
| `allowed-tools`                        | refused: `UNMAPPED_SOURCE_FRONTMATTER`                               |

```bash
# An Agent Skill with metadata and a license: this converts.
dsh-forge convert ./my-agent-skill --source agent-skills --target dsh --out ./generated/my-skill
```

`metadata` maps because the pinned DSH target only ever _carries_ it: routing uses
`whenToUse` and `description`, invocation uses dedicated keys, and no component
reads inside the object. The evidence is recorded in
[docs/skill-ir-v2.md](./docs/skill-ir-v2.md).

`compatibility` has no DSH field, and folding it into `description`, the body or
`metadata` would invent a meaning the source never stated — so it is refused rather
than approximated. `allowed-tools` is an experimental tool vocabulary, not a
portable package semantic, so it is never promoted at all.

### License preservation

**DSH has no native license semantic, and this project does not invent one.** A
license declaration is instead preserved verbatim in a namespaced, versioned,
tool-owned envelope inside `metadata`:

```yaml
metadata:
  dsh-skill-forge:
    preservationVersion: 1
    preservedSemantics:
      license: Proprietary. LICENSE.txt has complete terms
```

- **Preservation, not mapping.** There is no DSH license field and no top-level
  `license` in the generated frontmatter.
- **DSH does not interpret it,** and neither does this tool.
- **No legal analysis is performed.** Nothing decides whether a license is
  compatible, approved, commercially usable or redistributable.
- **The string is preserved exactly** — no trimming, normalisation, SPDX lookup or
  rewriting.
- **Resource files remain byte-identical copies.** A bundled `LICENSE.txt` is an
  ordinary resource; it is never parsed as a reference, and no missing license file
  is ever synthesised.
- **A source already using the `dsh-skill-forge` metadata key is refused**
  (`TARGET_METADATA_NAMESPACE_COLLISION`) rather than overwritten or merged.

This is why a license may be carried while `compatibility` and `allowed-tools` may
not: a declaration does not govern instructions, routing, permissions or
invocation, but those two describe runtime requirements and permissions —
behavioural facts that would silently change meaning in a target that ignores them.

Full rules: [docs/license-preservation-envelope.md](./docs/license-preservation-envelope.md).

The package is written to a staging directory beside the output and fully
re-validated — generic validation plus pinned DSH compatibility — before being
renamed into place, so a failed conversion leaves nothing behind. Resources are
copied byte-for-byte and are never executed; symbolic links and other special
files are refused, and paths that would not be portable to a Windows target are
refused too.

Full rules: [docs/dsh-target-adapter.md](./docs/dsh-target-adapter.md) and
[docs/skill-ir-v2.md](./docs/skill-ir-v2.md).

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
`resources`, plus `license` and `metadata` as described below.**

`metadata` is carried into the DSH frontmatter verbatim. `license` is **preserved
opaquely** in a tool-owned envelope — see
[License preservation](#license-preservation). `compatibility` is still refused
with `UNSUPPORTED_TARGET_SEMANTIC` because it describes runtime requirements, and
`allowed-tools` is still refused with `UNMAPPED_SOURCE_FRONTMATTER` because it is a
permission vocabulary rather than package information. Neither is dropped or
guessed at.

Source validation and generic IR validation are separate, and they can disagree. A
name like `数据处理` is a valid Agent Skills name but is outside what Universal
Skill IR v1 can represent; that case is reported as
`SOURCE_VALID_BUT_IR_UNSUPPORTED` and states that it is not a source adapter
defect.

Full rules, including every documented divergence between the standard, its
reference validator and Anthropic's helper: [docs/agent-skills-source-contract.md](./docs/agent-skills-source-contract.md).

### Codex source profile

An OpenAI Codex skill can be read explicitly:

```bash
dsh-forge assess ./my-codex-skill --source codex --target dsh

dsh-forge convert ./my-codex-skill \
  --source codex \
  --target dsh \
  --out ./converted
```

**Codex is not a separate package format.** A Codex skill is an Agent Skills
package plus one optional product file, `agents/openai.yaml`, so `--source codex`
**reuses the Agent Skills core handling** — the same parser, validator, entry
resolution and resource walker — and adds only the sidecar check. There is no
second adapter.

| `agents/openai.yaml`        | Result                                         |
| --------------------------- | ---------------------------------------------- |
| absent                      | converts as an ordinary Agent Skills package   |
| `interface` only            | **converts**; the file is copied byte-for-byte |
| `policy` present            | **refused**: `UNSUPPORTED_CODEX_BEHAVIOR`      |
| `dependencies` present      | **refused**: `UNSUPPORTED_CODEX_DEPENDENCY`    |
| unreadable or not a mapping | **refused**: `INVALID_CODEX_SIDECAR`           |

`interface` is UI presentation — a display name, icons, a brand colour, a
suggested prompt. It decides nothing about instructions, routing, permissions or
invocation, so it is carried **opaquely**: the original file is copied
byte-for-byte and never parsed and re-emitted, which keeps its comments, quoting
and key order intact. DSH does not interpret it, and nothing here claims it does.

`policy` and `dependencies` are **behavioural** — implicit invocation and runtime
tool requirements. The target has no equivalent, so carrying them would silently
change what a skill means. They are refused whole; there is no partial conversion.

A behavioural or unreadable sidecar is reported as a **target-support** refusal,
not a broken package: the assessment shows `Source Contract: PASS` with
`Semantics: REFUSED`, because the skill is valid Codex and the _target_ cannot
express what it declares.

**No network, no installation.** A dependency URL in a sidecar is parsed data. It
is never fetched, probed, connected to, or MCP-installed, and never executed.

Invalid `interface` values follow the pinned runtime rather than authoring advice:
Codex warns and drops a bad icon or brand colour instead of failing, so this
profile does not treat any interface value as an error, and does not promote the
documentation's style recommendations into validation.

- [docs/codex-source-contract.md](./docs/codex-source-contract.md) — the full
  contract, the four sources it distinguishes, and the pins.
- [docs/codex-source-profile-survey.md](./docs/codex-source-profile-survey.md) —
  what happened on 44 real Codex skills.

This is **not** a claim that every Claude skill converts automatically. There is
one source adapter, no adapter registry, and no automatic detection.

### Compatibility assessment

```bash
dsh-forge assess ./my-skill \
  --source agent-skills \
  --target dsh
```

`assess` **is read-only**. It does not convert, does not write, and takes no
`--out`. It reports why a conversion would currently succeed or be refused, and
names the stage each blocker came from:

```text
DSH Skill Assessment

Source:
agent-skills

Target:
dsh

Result:
REFUSED

Source Contract:
PASS

IR:
PASS

Semantics:
REFUSED

Resources:
PASS

Target Contract:
PASS

Issues:

[UNSUPPORTED_TARGET_SEMANTIC]
  stage: SEMANTIC
  Semantics were interpreted by the source but have no mapping in this target, so conversion is refused rather than dropping or reinterpreting them
  - license

Convertible:
NO
```

Stages are `SOURCE`, `IR`, `SEMANTIC`, `RESOURCE` and `TARGET`, and a stage that
was never reached is reported as `SKIPPED` rather than as passing. Exit codes are
the project's usual three: `0` convertible, `2` refused, `1` a fatal input or
filesystem failure.

The verdict comes from the same planner a real conversion runs, so an assessment
cannot disagree with `convert`. There is no `--json` yet: the assessment schema is
still under review, and the human-readable report is the contract for now.

Measured against a pinned real-world corpus: [docs/real-world-compatibility-survey.md](./docs/real-world-compatibility-survey.md).
Those percentages describe one repository at one commit and are not a product
promise.

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
- License analysis, SPDX resolution, or compatibility parsing
- Tool-permission translation
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

Neither IR version means universal skill semantic equivalence. v1 is a stable
canonical representation with no interpreted vocabulary; v2 adds a small, curated
set of portable fields, each with recorded evidence. Neither is a completed
mapping of every platform's vocabulary. See
[docs/skill-ir-v1.md](./docs/skill-ir-v1.md) and
[docs/skill-ir-v2.md](./docs/skill-ir-v2.md).

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
├── ir/           # skill-ir.ts (v1, frozen), skill-ir-v2.ts, portable-semantics.ts,
│                 # normalize-skill.ts, normalize-skill-v2.ts, serializers, json-value.ts
├── conversion/   # source-adapter.ts, convert-skill.ts, resource-collector.ts
├── schemas/      # skill.ts, validation.ts, compatibility.ts, conversion.ts
├── utils/        # exit codes, skill-name rule, path boundary, error types, package metadata
├── adapters/     # (empty) further ecosystem adapters — future phase
└── llm/          # (empty) model providers — future phase
docs/             # dsh-compatibility-contract.md, skill-ir-v1.md, skill-ir-v2.md,
                  # dsh-target-adapter.md, agent-skills-source-contract.md
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
