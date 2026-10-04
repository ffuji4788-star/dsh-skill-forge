# Universal Skill IR v1

The Universal Skill IR is the canonical, platform-neutral representation of a
local skill. `dsh-forge normalize <path>` produces it.

It exists so that a later phase can convert a skill to a specific target without
every converter re-reading raw frontmatter and re-deciding what a skill is.

## Purpose

- Give one stable, versioned shape for a skill's portable content.
- Preserve source data faithfully, including fields this phase does not
  interpret.
- Be deterministic: the same input always produces byte-identical output.
- Be serializable and portable: no absolute paths, no local machine context.

## Non-goals

- **Not a conversion format.** It is not written in any target's dialect, and
  nothing here emits a DeepSeek Harness, Claude Code, Codex or OpenCode skill.
- **Not an archive.** Resource _contents_ are never embedded, base64-encoded or
  copied. The IR holds references only.
- **Not a semantic mapping.** It does not decide what a source key such as
  `disable-model-invocation` means. Interpreting source vocabulary is a source
  adapter's job in a later phase.
- **Not a claim of universal semantic equivalence.** See "Known limitations".

## Schema version

```json
{ "schemaVersion": 1 }
```

The literal `1`. Not `"latest"`, not a timestamp, not a random value. If the
schema changes meaning, a new version is introduced; version 1 does not silently
change.

## Core fields

| Field           | Source                       | Notes                                               |
| --------------- | ---------------------------- | --------------------------------------------------- |
| `schemaVersion` | constant                     | `1`                                                 |
| `name`          | frontmatter `name`           | universal core field                                |
| `description`   | frontmatter `description`    | universal core field                                |
| `instructions`  | the Markdown body            | line endings normalised to LF; nothing else changed |
| `resources`     | the importer's resource list | relative, `/`-separated, sorted, deduplicated       |
| `source`        | envelope                     | see below                                           |

Exactly three fields are treated as universal: **name**, **description** and
**instructions**. Other fields are not promoted, because there is not yet
evidence that they carry the same meaning across skill systems.

## Resources

Resources are _references_, relative to the skill root:

```json
"resources": ["assets/data.json", "reference.md"]
```

Rules:

- `/` separators on every platform; a `\` is never emitted.
- Sorted lexicographically and deduplicated, so filesystem enumeration order
  cannot influence the result.
- A path that is absolute, drive-qualified (`C:`), contains `..`, or escapes the
  skill root is **dropped**, never emitted.
- Contents are never read into the IR.

Array order is preserved for frontmatter arrays, but resource order is not an
array of source data — it is a set of references, so it is sorted.

## Source envelope

```json
"source": {
  "format": "generic-local-skill",
  "entryFile": "SKILL.md",
  "extraFrontmatter": { "author": "Alice" }
}
```

- `format` is the neutral `generic-local-skill`. No adapter exists yet, so the IR
  never claims a skill came from Claude, Codex, OpenCode or DeepSeek Harness,
  even when it happens to carry similar-looking fields.
- `entryFile` is relative to the skill root (for example `SKILL.md`), never an
  absolute path.
- `extraFrontmatter` preserves every frontmatter field that is not a universal
  core field, verbatim. `name` and `description` are never repeated here.

There is deliberately **no** `rootPath`: the real local directory is runtime
context, not portable IR.

## extraFrontmatter

Loss-aware by design: a field this phase does not understand is preserved rather
than dropped, and no guessing takes place. A source key stays under its original
name:

```json
"extraFrontmatter": { "disable-model-invocation": true }
```

_not_ a speculative mapping such as `{ "invocation": { "allowModel": false } }`.

Values must be JSON-safe: `string`, `number` (finite), `boolean`, `null`, array
or object. An unsupported value (`undefined`, function, symbol, bigint, `Map`,
`Set`, circular reference, or a `__proto__`-style key) is **reported as an error**
rather than silently coerced.

Object keys are sorted recursively so key insertion order in the source file
cannot change the output. Array order is preserved, because array order may be
meaningful.

## Deterministic serialization

`serializeSkillIR` is the single owner of the byte-level format:

- top-level field order: `schemaVersion`, `name`, `description`, `instructions`,
  `resources`, `source`, then `format`, `entryFile`, `extraFrontmatter`;
- object keys within `extraFrontmatter` are sorted recursively;
- two-space indentation, LF line endings, exactly one trailing newline.

Two semantically identical sources whose frontmatter keys are written in a
different order therefore serialize to identical bytes. The CLI never calls
`JSON.stringify` on an ad-hoc object.

## Validation gate

`normalize` requires that the skill already passed **generic structural
validation** (the same rules `dsh-forge validate` applies). If it did not, no IR
is produced at all — not a partial one — and the command exits `2`.

This means a skill can be:

| Generic validation | DSH compatibility | `validate` | `compat` | `normalize`         |
| ------------------ | ----------------- | ---------- | -------- | ------------------- |
| pass               | compatible        | 0          | 0        | IR, exit 0          |
| fail               | compatible        | 2          | 0        | **refused, exit 2** |
| pass               | incompatible      | 0          | 2        | IR, exit 0          |
| fail               | incompatible      | 2          | 2        | refused, exit 2     |

The second row is a real, deliberate case: a whitespace-only `description` is
accepted by DeepSeek Harness but rejected by the generic validator, so
`normalize` refuses it. See `fixtures/dsh/whitespace-description`.

An empty body is the same: a DSH warning, a generic error, and therefore a
refusal. This is an **IR v1 invariant**, not a bug.

Target compatibility is _not_ consulted. Whether a skill suits one platform is
independent of whether it can be represented canonically.

## Privacy

The IR never contains absolute local paths: no `C:\Users\...`, no `/home/...`, no
working directory and no `rootPath`. Entry file and resource paths are always
skill-root-relative, so an IR document can be committed or shared.

## Exit codes

| Code | Meaning                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | IR produced on stdout                                                                                                                        |
| `1`  | Fatal input error (missing path, unreadable file, malformed YAML frontmatter, ambiguous entry) or a value that cannot be represented as JSON |
| `2`  | The generic validation gate refused the skill; stdout stays empty                                                                            |

stdout carries the IR document and nothing else, so
`dsh-forge normalize ./skill > skill.ir.json` yields a valid JSON file. On
success stderr is empty.

## Known limitations

- **Universal Skill IR v1 does not mean universal skill semantic equivalence.**
  It is a stable canonical representation of a skill's name, description,
  instructions and references, plus its preserved source metadata. It is not a
  proof that any two ecosystems agree on what those fields mean, and it does not
  map any source-specific vocabulary onto a shared one.
- Only `generic-local-skill` is a known `source.format`; adapters will add their
  own in later phases.
- Resource _kinds_ (file vs directory vs binary) are not recorded, and resource
  contents are not represented.
- `whenToUse`, `metadata` and the invocation keys remain uninterpreted source
  data on purpose. Promoting them to universal fields would be a guess.
- The generic validation gate is stricter than some targets: a skill those
  targets accept can still be refused IR here.
