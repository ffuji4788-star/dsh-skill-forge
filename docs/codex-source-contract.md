# The Codex source contract

`dsh-forge --source codex` reads an OpenAI Codex skill. This document states
exactly what that means, which source each claim comes from, and where the
boundary of "can be carried" sits.

## Four sources, deliberately not merged

"Codex format" is not one thing. Four separate authorities are involved, and
conflating them is the main way a compatibility tool invents rules that do not
exist:

| #   | Source                                     | What it is                                         | What it is authoritative for                                              |
| --- | ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | **Agent Skills** `agentskills/agentskills` | the portable specification                         | the package shape, `SKILL.md`, `name`/`description`                       |
| 2   | **Codex runtime** `openai/codex`           | the Rust implementation that actually loads skills | what is _enforced_: which fields are read, what is fatal, what is ignored |
| 3   | **skill-creator authoring guidance**       | a bundled sample skill and its reference docs      | how a human should _write_ a skill — recommendations, not validation      |
| 4   | **`openai/skills`**                        | a distribution corpus of real skills               | evidence about what skills in the wild look like — never a contract       |

This project implements (2) where behaviour is concerned, reuses (1) for the
package contract, treats (3) as advice that is **not** promoted into validation,
and uses (4) only to measure.

## Pins

| Contract      | Pin                                                                     | How it was established                                                     |
| ------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Codex runtime | `openai/codex@7f892275e31002f0422477c6219189284560e689`                 | read from the repository's commit API for `main` at the start of the phase |
| Codex corpus  | `openai/skills@49f948faa9258a0c61caceaf225e179651397431`                | same method                                                                |
| Agent Skills  | `agentskills/agentskills@69ef37e9424c0a7ea9dd2293b559e43ec8176379`      | unchanged since the Agent Skills phase                                     |
| DSH target    | `deepseek-ai/deepseek-harness@5badb15009ae1756c3afe0ae0cef1faafc290ccc` | unchanged since the DSH phase                                              |

Nothing here re-pins or re-fetches. A different commit is a different contract and
would need its own review.

## The package model

A Codex skill is an Agent Skills package plus one optional product file:

```
<skill>/
  SKILL.md                 required — name, description, Markdown body
  agents/openai.yaml       optional — Codex product configuration
  scripts/ references/ assets/ ...   ordinary resources
```

Evidence for the first half comes from the runtime, not from documentation:
`codex-rs/skills/src/parser.rs` deserializes `SKILL.md` frontmatter into exactly
`name`, `description` and `metadata.short-description`. That struct is **not**
marked `deny_unknown_fields`, so a `license`, `compatibility` or `allowed-tools`
key is read past rather than rejected — which is precisely the contract
`--source agent-skills` already implements.

That is why `codex` is a **profile**, not a second adapter. It calls the shared
`loadAgentSkill` and adds only the sidecar check. There is one frontmatter parser,
one name/description validator, one entry resolution and one resource walker in
the project.

## `agents/openai.yaml`

Only three top-level keys mean anything to the runtime:

| Key            | Kind         | This profile         |
| -------------- | ------------ | -------------------- |
| `interface`    | presentation | **carried opaquely** |
| `policy`       | behaviour    | **refused**          |
| `dependencies` | behaviour    | **refused**          |

### interface — carried, never interpreted

`interface` holds a display name, a short description, icon paths, a brand colour
and a default prompt. None of it decides which instructions run, how a skill is
routed, what it is permitted to do, or whether it is invocable. It is UI
presentation, so carrying it cannot change meaning.

It is carried as **the original file**, copied byte-for-byte. It is never parsed
and re-emitted, because that would lose comments, key order and quoting that
belong to the source — and the target does not read it anyway. The existing
resource rules do the copying, so the sidecar is an ordinary resource.

### policy — refused

`policy.allow_implicit_invocation` decides whether Codex injects a skill into the
model context without an explicit `$skill` mention. The runtime default is `true`,
and `SKILL.md`'s `metadata` block is a _different_ mechanism.

There is no proven equivalent in the target. A superficially similar field is not
an equivalent: the two systems differ in catalog visibility, injection timing, and
what an explicit mention means. Because the field is behavioural, carrying it into
a target that ignores it would silently change whether a skill is offered to a
model at all. It is refused with `UNSUPPORTED_CODEX_BEHAVIOR`.

`policy.products` is also parsed by the runtime, which currently only stores it —
the source carries an explicit `TODO` saying product gating is not enforced. It is
treated the same way as the rest of `policy`: refused.

### dependencies — refused

`dependencies.tools` declares runtime tool requirements (currently only MCP
servers, with transport, URL and optional command). The target neither resolves
nor satisfies these. Copying the sidecar and declaring success would produce a
package that looks complete but cannot run, so it is refused with
`UNSUPPORTED_CODEX_DEPENDENCY`.

Nothing is installed, probed, connected to or resolved. A URL in a sidecar is
parsed data and is never fetched — and is never echoed into a report.

## Unknown keys follow the runtime

An unknown top-level key in the sidecar is **preserved, not rejected**, because
the pinned runtime deserializes a known struct and reads past everything else.
Inventing a stricter rule here would refuse skills Codex itself accepts. An
unknown key is classified as presentation, and the file is still copied verbatim.

## Invalid interface values follow the runtime too

This is the boundary most easily got wrong. The runtime does **not** fail on bad
interface metadata — `codex-rs/skills/src/interface.rs` warns and drops:

- an icon that is absolute, outside `assets/`, or escapes via `..` is dropped;
- a `brand_color` that is not exactly `#RRGGBB` is dropped;
- `display_name` is whitespace-collapsed and capped at 64 characters;
- `short_description` and `default_prompt` are capped at 1024 characters;
- if every field is invalid the whole interface resolves to `None` — and the skill
  still loads.

The documented "25–64 characters" for `short_description` is **authoring guidance
with no runtime enforcement**; the actual runtime limit is 1024. This profile
therefore does not treat any interface value as an error, and does not adopt
authoring recommendations as validation rules.

## What a sidecar can be

| Classification   | Meaning                                 | Result                         |
| ---------------- | --------------------------------------- | ------------------------------ |
| `ABSENT`         | no `agents/openai.yaml`                 | converts                       |
| `INTERFACE_ONLY` | present, no behavioural key             | converts, file copied verbatim |
| `BEHAVIOURAL`    | declares `policy` and/or `dependencies` | refused                        |
| `UNREADABLE`     | not valid YAML, or not a mapping        | refused                        |

`UNREADABLE` is deliberately distinct from `BEHAVIOURAL`. A file that cannot be
parsed declares nothing observable, so calling it behavioural would assert a fact
nobody established. Both refuse; the reason differs and the report says which.

A behavioural or unreadable sidecar is a **`target-support`** refusal, not a
source-contract failure: the package is well-formed Codex and the _target_ cannot
express what it declares. The assessment reports `Source Contract: PASS` with
`Semantics: REFUSED`, rather than implying the user's skill is malformed.

## Safety

Reading a Codex skill performs no network access, starts no subprocess, evaluates
nothing, mutates no source file, and never executes a resource — including
anything under `scripts/`. Shell-looking strings, `$(...)`, backticks and
path-like values in a sidecar are inert data.

## Known limitations

- **The target does not understand the sidecar.** Preservation makes it survive,
  not usable. It is not merged into DSH `metadata`, `description` or `whenToUse`.
- **`policy` and `dependencies` are unsupported, not unimplementable.** Supporting
  them needs a target contract that acts on them, not a looser check here.
- **The refusal is all-or-nothing per skill.** A skill with dependencies and an
  otherwise-convertible body is refused whole; there is no partial conversion.
- **`policy.products` is unenforced upstream.** Its meaning may change when the
  runtime's `TODO` is addressed.
- **Icon assets are copied, never inspected.** No image is read or validated.
