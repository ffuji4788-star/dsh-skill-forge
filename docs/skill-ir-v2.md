# Universal Skill IR v2

Phase 7 introduces schema 2 of the Universal Skill IR. It exists for one reason:
some skill fields have a meaning that is genuinely portable, and v1 had nowhere
to put them, so a target could only refuse them as uninterpreted raw data.

v2 is a **separate schema**, not v1 with optional extras. v1 is frozen.

## Why v2 exists

In v1 every frontmatter key beyond `name` and `description` is raw source data in
`source.extraFrontmatter`. The DSH target refuses any such key with
`UNMAPPED_SOURCE_FRONTMATTER`, because it cannot know whether a source key means
what a same-named target key means — and it must not guess.

That is correct but blunt. An Agent Skills `metadata` map and a DSH `metadata`
object carry the _same kind of fact_, and refusing to carry it across loses a
real capability for no safety benefit. v2 gives interpreted, portable fields a
home:

- a source adapter that has validated its own vocabulary against a contract may
  promote fields into `semantics`;
- the IR layer only validates and canonicalizes what it is handed;
- a target may then map a semantic it can express, or refuse one it cannot.

Interpretation still belongs to the adapter. `src/ir` contains no branch on
source vocabulary and no target knowledge.

## The v1 stability promise

`dsh-forge normalize <path>` with no `--ir-version` produces **byte-identical v1
output** to what it produced before v2 existed. This is not an aspiration; it is
checked against a build of the Phase 4 commit.

v1 keeps `schemaVersion: 1`, its own serializer, its own normalizer, and its own
provenance list. Nothing in v1 changed. v2 is produced only when `--ir-version 2`
is passed, and naming a source never switches the version on its own.

## Schema

```json
{
  "schemaVersion": 2,
  "name": "metadata-skill",
  "description": "…",
  "instructions": "…",
  "resources": ["references/GUIDE.md"],
  "semantics": {
    "license": "Apache-2.0",
    "compatibility": "Requires git",
    "metadata": { "author": "example-org", "version": "1.0" }
  },
  "source": {
    "format": "agent-skills",
    "entryFile": "SKILL.md",
    "extraFrontmatter": { "allowed-tools": "Read" }
  }
}
```

| Field                     | Rule                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| `schemaVersion`           | Literal `2`.                                                            |
| `name`, `description`     | Non-empty strings. The universal core.                                  |
| `instructions`            | Markdown body, LF-normalized, otherwise untouched.                      |
| `resources`               | Skill-root-relative, `/`-separated, sorted, deduplicated, no traversal. |
| `semantics`               | Always present. `{}` when the source offers nothing.                    |
| `source.format`           | Provenance: `generic-local-skill` or `agent-skills`.                    |
| `source.entryFile`        | Skill-root-relative entry file name.                                    |
| `source.extraFrontmatter` | Everything not promoted, verbatim, recursively sorted keys.             |

A field that reaches `semantics` is **moved** out of `extraFrontmatter`, never
copied: one fact must not have two homes that could disagree. The schema enforces
this, so a document cannot express the same semantic twice.

### `source.format` is provenance, not semantics

`agent-skills` names the standard the bytes came from. It is not a vendor claim
and not a target claim; there is deliberately no `claude` provenance.

## Portable semantics

### `license`

The source's license declaration or reference, verbatim.

- Must be a string.
- Never evaluated: no SPDX validation, no license-file check, no judgement about
  commercial usability. Phase 7 has no license engine.
- Has **no** DSH counterpart, so the DSH target refuses it.

### `compatibility`

The source's declarative environment or runtime requirements, verbatim.

- Must be a string.
- Never parsed: no system-package extraction, no network-requirement analysis, no
  conversion into capability flags.
- Has **no** DSH counterpart, so the DSH target refuses it.

### `metadata`

Arbitrary string keys to string values, copied exactly.

- Values must be strings. A non-string value would be silently coerced by some
  parsers, and a coercion is a loss, so it is refused at the source contract.
- Keys are stored in canonical sorted order; values are never trimmed, lowercased
  or rewritten.
- Maps to the DSH `metadata` object. See the evidence below.

## Source-specific extras

`allowed-tools` stays in `source.extraFrontmatter` and is never promoted.

It is an experimental pre-approved-tool vocabulary. A tool-permission list is a
different kind of fact from a license or a metadata pair, and different agent
runtimes do not agree on what a tool grant means. Promoting it would invite a
mapping that looks plausible and is not.

Consequently `allowed-tools` refuses as `UNMAPPED_SOURCE_FRONTMATTER` — raw
source data with no home — **not** as `UNSUPPORTED_TARGET_SEMANTIC`, which would
wrongly imply the tool had interpreted it as a portable semantic.

## Semantic mapping matrix

| Agent Skills field | IR v2                     | DSH           | Result                                   |
| ------------------ | ------------------------- | ------------- | ---------------------------------------- |
| `name`             | core `name`               | `name`        | mapped                                   |
| `description`      | core `description`        | `description` | mapped                                   |
| body               | `instructions`            | Markdown body | mapped                                   |
| `metadata`         | `semantics.metadata`      | `metadata`    | **mapped**                               |
| `license`          | `semantics.license`       | —             | **REFUSE** `UNSUPPORTED_TARGET_SEMANTIC` |
| `compatibility`    | `semantics.compatibility` | —             | **REFUSE** `UNSUPPORTED_TARGET_SEMANTIC` |
| `allowed-tools`    | `source.extraFrontmatter` | —             | **REFUSE** `UNMAPPED_SOURCE_FRONTMATTER` |

A skill therefore converts to DSH when it uses `name`, `description` and
optionally `metadata`. **This is not a claim that every Agent Skill is
convertible.**

## Why `metadata` is considered portable

The mapping was accepted only after reading the pinned DSH implementation.

Repository `https://github.com/deepseek-ai/deepseek-harness`, commit
`5badb15009ae1756c3afe0ae0cef1faafc290ccc`. Files inspected:
`packages/skill/skill/src/index.ts`, `packages/skill/skill-filesystem/src/index.ts`,
`packages/skill/skill-filesystem/README.md`, `docs/subsystems/skills.md`.

What the target actually does with `metadata`:

1. **It only carries it.** `optionalMetadata()` in the filesystem provider keeps
   an object that is neither null nor an array and stores the reference;
   `parseSkillFile`, `discoverRoot` and `get()` pass that object through
   untouched. Nothing iterates its keys, and nothing reads a value.
2. **It is described as inert.** The registry documents `SkillCandidate.metadata`
   and `SkillDefinition.metadata` as "Parsed optional metadata object from
   provider-specific skill frontmatter".
3. **It is not routing.** Routing uses `name`, `description` and `whenToUse`,
   which has its own frontmatter key.
4. **It is not invocation.** `modelInvocable` and `userInvocable` are resolved
   from the dedicated `disable-model-invocation` and `user-invocable` keys by
   `parseInvocationPolicy`, which never consults `metadata`.
5. **It is not permission.** There is no permission field in the DSH skill model
   at all, so `metadata` cannot be one.
6. **It never reaches a consumer.** `toSummary()` — used by `list()` and
   `snapshot()` — does not carry `metadata`, so the model-facing catalog cannot
   see it. `renderSkillContent()` renders only `name`, `provider`, `resourceBase`
   and `content`.

Type domains: DSH accepts `Record<string, unknown>`; Agent Skills metadata is
`Record<string, string>`. `Record<string, string>` is therefore a **strict
subset**, so lifting it cannot invent a value the target would not accept.

Because the target neither interprets nor acts on `metadata`, copying a string map
across cannot change which skills load, what a model may invoke, or what any
component is permitted to do. The mapping is informational and lossless.

If a future revision gives `metadata` behavioural meaning, this mapping must be
withdrawn and reclassified as `UNSUPPORTED_TARGET_SEMANTIC`. The audit in
`docs/dsh-target-adapter.md` records the pinned revision this rests on.

### Round-trip fidelity

`metadata` survives source → IR v2 → DSH YAML → parse unchanged, including empty
strings, surrounding whitespace, `"1.0"`, `"true"`, `"yes"`, `"null"`, `"~"`,
colons, quotes, newlines, braces and Unicode. This is asserted by a test that
converts a skill whose metadata uses all of those.

The emitter writes via the YAML library and relies on YAML 1.2 core schema
resolution, which both this project (`yaml@2.9.1`) and the target (`yaml`) use,
so `yes` is a string rather than a boolean. Values that would resolve to a
different type under 1.2 — `"true"`, `"1"`, `"1.0"`, `"null"` — are quoted by the
emitter, which the round-trip test pins.

## Migration strategy

None is needed, deliberately.

- v1 documents remain valid and remain byte-stable.
- v1 is the default output of `normalize` and the internal shape of no
  conversion: `convert` builds v2 internally for every source, and a source with
  no portable semantics produces an empty `semantics` that emits exactly the
  frontmatter v1 did. That is why generic conversion is byte-identical to
  Phase 5/6.
- Nothing rewrites an existing v1 file, and there is no `--migrate`.

## Non-goals

Phase 7 does not add: IR v2 for any second source adapter, a Codex, OpenCode or
proprietary Claude adapter, an adapter registry, a license analyser or SPDX
resolver, a compatibility parser, a tool-permission translator, an LLM provider,
a DeepSeek API client, AI rewriting, automatic migration, or any lossy override
(`--allow-lossy`, `--drop-license`, `--ignore-compatibility`, `--force`,
`--pass-through`). Conversion remains lossless-or-refused.

## Known limitations

- `license` and `compatibility` still cannot be converted to DSH. Their semantics
  are portable but the target has nowhere to put them; a future phase would need a
  real target contract for them, not a same-name guess.
- `metadata` portability rests on the pinned DSH revision. An upstream change that
  gives `metadata` behaviour would invalidate the proof, not just the code.
- The DSH target emits `metadata` but its own registry drops it before any
  consumer sees it, so metadata is preserved for other tooling and for
  round-tripping, not to influence the running agent.
- Metadata values must be strings. A skill whose metadata uses native YAML types
  is refused by the Agent Skills source contract rather than coerced.
- `source.format` covers two provenances. No automatic source detection exists, so
  a skill read without `--source` is `generic-local-skill` and its `metadata` key
  is **not** lifted, even if it looks identical to an Agent Skills one.
