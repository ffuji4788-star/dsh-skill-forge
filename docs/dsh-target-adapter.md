# DSH target adapter

`dsh-forge convert <path> --target dsh --out <directory>` turns a local skill into
a DeepSeek Harness skill package.

It is the first phase allowed to write output, so the safety rules below are part
of the contract, not implementation details.

## Pinned target contract

| Field       | Value                                           |
| ----------- | ----------------------------------------------- |
| Target      | `dsh` (the only supported target)               |
| Repository  | https://github.com/deepseek-ai/deepseek-harness |
| Commit      | `5badb15009ae1756c3afe0ae0cef1faafc290ccc`      |
| Verified at | 2026-10-04                                      |

The contract is the same one Phase 3 pinned (`docs/dsh-compatibility-contract.md`).
Phase 5 neither re-fetches nor re-pins it, and it performs no network access at
run time. Generated packages are measured against **this** revision.

## Supported IR fields

| IR field           | Target                               | Notes                                        |
| ------------------ | ------------------------------------ | -------------------------------------------- |
| `name`             | `SKILL.md` frontmatter `name`        | emitted verbatim                             |
| `description`      | `SKILL.md` frontmatter `description` | emitted verbatim, YAML-encoded               |
| `instructions`     | Markdown body                        | emitted verbatim after the frontmatter       |
| `resources`        | files under the output directory     | copied byte-for-byte                         |
| `source.entryFile` | —                                    | not emitted; the target fixes the entry name |

Only these fields cross the boundary. `whenToUse`, `metadata`,
`disable-model-invocation` and `user-invocable` are **not** emitted, even though
the pinned contract understands them, because the IR does not carry interpreted
semantics for them.

## Unmapped-source policy

`source.extraFrontmatter` holds source frontmatter that no phase has interpreted
yet. Phase 5 has no source adapter, so it cannot know whether a source key means
the same thing as a same-named DSH key.

Therefore:

- `source.extraFrontmatter` **non-empty → the conversion is refused** with
  `UNMAPPED_SOURCE_FRONTMATTER`, listing the fields.
- Nothing is dropped, renamed, guessed or passed through — not even
  `disable-model-invocation`, which the target happens to support.
- There is deliberately **no** `--allow-lossy`, `--drop-extra`, `--force-map`,
  `--ignore-unmapped` or `--force` flag. A convenience flag that silently loses
  data is worse than a refusal.

A skill converts only when its frontmatter is exactly `name` and `description`.

## Generated `SKILL.md`

- Frontmatter is produced by the YAML library, never by string interpolation, so a
  description containing a colon, a quote, `#`, a newline, leading or trailing
  spaces, Unicode or emoji is valid YAML and round-trips to the same value.
- Field order is fixed: `name`, then `description`.
- The instructions follow the closing delimiter verbatim. The body is never
  trimmed, reflowed, reformatted or semantically rewritten.
- Output is UTF-8, LF-only, with exactly one trailing newline.

## Resource copying rules

- Resources are re-read from the source skill root; the IR only supplies relative
  references.
- Copying is byte-for-byte. Contents are never decoded as text, reformatted or
  executed.
- Regular files and regular directories are supported; a directory is copied
  recursively.
- **Symbolic links, junctions and every other special node are refused**, never
  followed and never silently skipped.
- Every source path is re-validated against the skill root at copy time, so the
  check is a TOCTOU and symlink defence rather than a restatement of Phase 4.
- Every destination is re-validated against the staging root, so a relative path
  cannot escape the package.
- `SKILL.md` cannot be produced by a resource, and two resources cannot resolve to
  the same destination.

## Portability rules

A generated package is meant to be installable anywhere, so a resource whose path
is not portable to a Windows target is refused:

| Condition                                          | Example                                |
| -------------------------------------------------- | -------------------------------------- |
| Reserved device name, with or without an extension | `CON`, `NUL`, `COM1`, `LPT9`, `con.md` |
| Segment ending in a dot                            | `foo.`                                 |
| Segment ending in a space                          | `foo `                                 |
| Empty segment                                      | `a//b`                                 |
| Case-insensitive collision                         | `Foo.txt` and `foo.txt`                |
| Absolute, drive-qualified or traversal path        | `/x`, `C:\x`, `../x`                   |

These checks run on every platform, so a package generated on Linux is just as
portable as one generated on Windows.

## Output safety and atomicity

- The output path is **never overwritten**. If it exists — as a file, directory or
  symlink — the conversion is refused with `OUTPUT_ALREADY_EXISTS`.
- The output must not be the source skill root or inside it
  (`OUTPUT_INSIDE_SOURCE`), which prevents recursive copies and source pollution.
- The package is written to a staging directory created **beside** the output, so
  the final `rename` stays on one filesystem.
- The staged package is then re-read through the project's own importer, parser,
  generic validator and pinned DSH compatibility validator before anything is
  finalized.
- Only after every check passes is the staging directory renamed into place. On
  any failure the output does not exist and staging is removed — a half-generated
  package is never left behind.
- Self-generated output must be clean: a generic validation error **or** a DSH
  warning is reported as `GENERATED_PACKAGE_INVALID`, never tolerated.
- No manifest, conversion report or tool metadata is added to the package.

## Exit codes

| Code | Meaning                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Package written                                                                                                                                                                  |
| `1`  | Fatal error: missing source, malformed frontmatter, ambiguous entry, filesystem or finalize failure                                                                              |
| `2`  | Conversion refused: unmapped source frontmatter, unsupported resource, existing output, output inside source, generated package invalid, target incompatible, unsupported target |

## Guarantees and non-goals

Guaranteed: lossless-or-refused, non-destructive, atomic, offline, inert, and
deterministic (the same source produces the same file list and the same bytes in
any output location).

Not guaranteed: filesystem metadata. `content is preserved; filesystem metadata
preservation is limited.` Timestamps, ownership, ACLs and POSIX modes are not part
of the contract.

Not implemented: source adapters (Claude Code, Codex, OpenCode), an adapter
registry, GitHub import, license analysis, provenance analysis, LLM providers,
DeepSeek API access, AI rewriting, automatic migration, an installer, a
marketplace or a Web UI. Phase 5 does not validate that a generated package is
_semantically_ the same skill — it preserves what the IR carries and refuses
anything it cannot carry faithfully.
