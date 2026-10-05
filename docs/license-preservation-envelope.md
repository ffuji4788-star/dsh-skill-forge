# License preservation envelope

`dsh-skill-forge` carries an Agent Skills `license` declaration into a generated
DSH package **without interpreting it**.

This is **preservation**, not a native mapping. DSH has no license semantic, and
this project deliberately does not invent one.

## Purpose

Phase 8 measured a pinned real-world corpus and found that 16 of 19 Agent Skills
were refused for exactly one reason: they declare a `license`, and the target had
no field to carry it. The declaration was not the problem — the missing carrier
was.

Phase 9 adds a carrier:

```text
Agent Skills license
  → IR v2 semantics.license          (interpreted by the source adapter)
  → DSH metadata                     (a tool-owned, versioned envelope)
```

The declaration survives byte-for-byte. Nothing downstream understands it, and
nothing downstream needs to.

The envelope is a **non-behavioral carrier**: it transports a declaration into the
target without the target, or this tool, acting on it.

## Why preservation is safe

A license declaration is **declarative package information**. It does not govern:

- which instructions run,
- how a skill is routed or selected (`description`, `whenToUse`),
- whether a skill is invocable (`disable-model-invocation`, `user-invocable`),
- what any component is permitted to do (no permission model reads it),
- the instruction body.

Because it changes no behaviour, copying it across cannot change behaviour. That
is the whole argument, and it is why `license` may be carried opaquely while
`compatibility` and `allowed-tools` may not:

| Field           | Kind of fact                                      | Policy                 |
| --------------- | ------------------------------------------------- | ---------------------- |
| `license`       | declarative package information                   | **preserved opaquely** |
| `metadata`      | declarative package information                   | **native mapping**     |
| `compatibility` | runtime / environment requirement — _behavioural_ | **refused**            |
| `allowed-tools` | pre-approved permissions — _behavioural_          | **refused**            |

Carrying a behavioural fact into a target that does not act on it would silently
change what the skill means. Refusing is the honest outcome.

## Why this is not a native mapping

DSH's `metadata` field is documented as provider-specific frontmatter that the
registry carries without reading. So the envelope is placed _inside metadata_, and
the field name inside it is ours:

```yaml
metadata:
  dsh-skill-forge:
    preservationVersion: 1
    preservedSemantics:
      license: Complete terms in LICENSE.txt
```

Nothing here says "DSH understands this license". There is no top-level `license`
field, no DSH license API, and no compliance behaviour. A reader who only looks at
`metadata` sees an opaque, namespaced, versioned blob — which is exactly what it
is.

## Envelope schema

| Path                       | Type   | Meaning                                       |
| -------------------------- | ------ | --------------------------------------------- |
| `metadata.dsh-skill-forge` | object | the tool-owned namespace                      |
| `…preservationVersion`     | number | schema version of the envelope. Currently `1` |
| `…preservedSemantics`      | object | field name → exact original string value      |

Constants live in `src/targets/dsh/dsh-metadata-envelope.ts`:

- `DSH_SKILL_FORGE_METADATA_NAMESPACE` = `dsh-skill-forge`
- `DSH_PRESERVATION_VERSION` = `1`
- `PRESERVABLE_SEMANTIC_FIELDS` = `['license']`

The envelope is **versioned** so a future structural change has an upgrade path
instead of an ambiguity. Bumping it is a documented migration, not an edit.

Only fields in `PRESERVABLE_SEMANTIC_FIELDS` are ever written, and only when the
source actually supplied them. A skill with no license produces no envelope at all.

## Namespace collision policy

Source metadata that already uses `dsh-skill-forge` is **refused**:

```text
TARGET_METADATA_NAMESPACE_COLLISION
```

No overwrite, no merge, no rename of source data. Both a plain value and an
existing envelope (for example `preservationVersion: 999`) are refusals, because
merging would either destroy source data or guess at a structure this tool does not
own. The check runs during planning, before any staging directory exists, so a
collision leaves no output.

## License string fidelity

The declaration is copied **verbatim**. There is no trimming, lowercasing,
rewriting, SPDX normalisation, translation, classification, splitting, filename
parsing or URL parsing.

`Apache-2.0` stays `Apache-2.0`. `Complete terms in LICENSE.txt` stays exactly
that. `Proprietary. LICENSE.txt has complete terms` stays exactly that.

Fidelity is asserted through the whole pipeline for values including colons,
single and double quotes, embedded newlines, Unicode, emoji, leading and trailing
spaces, and strings that YAML would otherwise resolve differently — `"true"`,
`"false"`, `"1"`, `"null"`, `"~"`, `"- not a list"`, `"#hash-start"`.

The emitter relies on YAML 1.2 core schema resolution, which both this project
(`yaml@2.9.1`) and the target (`yaml`) use, so `yes` is a string rather than a
boolean; values that would resolve differently even under 1.2 are quoted by the
emitter. This is the same mechanism the native `metadata` mapping has used since
Phase 7 and is covered by the same round-trip tests.

## LICENSE resource policy

A `LICENSE`, `LICENSE.txt`, `LICENSE.md` or any other file in the skill is an
**ordinary resource**. It is copied byte-for-byte under the Phase 5 resource rules —
same relative path, same size, same SHA-256.

This project does **not**:

- parse the declaration as a file reference,
- open the file to see what the license says,
- synthesise a missing `LICENSE` file for a declaration that names one,
- require the named file to exist.

A skill declaring `license: Apache-2.0` with no license file converts fine.

## compatibility boundary

`compatibility` continues to be refused with `UNSUPPORTED_TARGET_SEMANTIC`.

It describes runtime and environment requirements. If DSH does not act on them,
converting could change whether the skill actually works in its intended
environment — a silent semantic change. It is **not** placed in the envelope, not
folded into `description`, not appended to the body and not merged into `metadata`.

## allowed-tools boundary

`allowed-tools` continues to be refused with `UNMAPPED_SOURCE_FRONTMATTER`.

It is never promoted to a portable semantic at all, because it is an experimental
permission vocabulary rather than package information. It is never mapped to
`disable-model-invocation`, `user-invocable`, `metadata` or the body.

The distinction between the two refusal codes matters and is preserved: a
_preservable_ field with no target home would be `UNSUPPORTED_TARGET_SEMANTIC`,
while `allowed-tools` is reported as uninterpreted source data because it never
reached the semantic layer.

## Runtime semantics

A preserved license changes nothing about the generated package's runtime
behaviour. The generated `SKILL.md` gains no `whenToUse`, no invocation key, no
permission key, and no change to `description` or body. Every generated package is
re-validated and must be generically valid and DSH `COMPATIBLE` with **zero
warnings**; a warning is treated as an emitter bug, not something to tolerate.

## Security

No network access, no subprocess, no `eval`, no resource execution, and no source
mutation. A license value is pure data: it is never fetched as a URL, never used
to open a document, never executed as a path, and never interpreted as code.

## Legal non-goals

This project performs **no legal analysis**. It does not:

- decide whether a license is compatible with anything,
- approve or reject a license,
- determine whether commercial use is allowed,
- assess redistributability,
- judge whether a skill is "open-source safe",
- read license text to reach any conclusion.

The only claim it makes is: _the license declaration was preserved._

## Corpus before / after

Pinned corpus `anthropics/skills` at
`8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`, survey root `skills/`.

|                | Phase 8 | Phase 9 |
| -------------- | ------- | ------- |
| Total          | 19      | 19      |
| Convertible    | 2       | **18**  |
| Refused        | 16      | **0**   |
| Source invalid | 1       | 1       |
| IR unsupported | 0       | 0       |

The Phase 8 baseline is preserved unchanged in
`docs/data/anthropic-skills-8a1541c-survey.json` (byte-identical to the commit that
produced it). The Phase 9 measurement is a separate file,
`docs/data/anthropic-skills-8a1541c-license-preservation-survey.json`.

All 18 convertible skills were actually converted and re-validated: every generated
package is generically valid and DSH `COMPATIBLE` with zero warnings.

`claude-api` remains `SOURCE_INVALID`: its `description` is 1068 characters against
the Agent Skills limit of 1024. The source contract is not bent to reach 19/19 — the
description is not truncated, rewritten, moved into the body or auto-fixed.

## Known limitations

- **The target still does not understand the declaration.** Preservation makes it
  survive, not usable. Any future behaviour that acts on a license needs its own
  target contract and its own phase.
- **The envelope lives inside `metadata`,** so it is subject to whatever the target
  eventually does with `metadata`. That field is currently inert and documented as
  provider-owned; if a future revision gives it behavioural meaning, this envelope
  must be re-evaluated, not assumed safe.
- **Only `license` is preservable today.** `compatibility` and `allowed-tools` are
  refused because they are behavioural; admitting them would need a target that
  acts on them.
- **Collision refusal is all-or-nothing.** A source that uses our namespace for its
  own purposes cannot be converted at all, which is deliberate but blunt.
- **No legal meaning is attached, ever.** A reader should not treat a preserved
  license as a statement about what the skill may be used for.
