# Codex source profile — real-world corpus survey

What the `--source codex` profile does when pointed at a real distribution corpus,
measured rather than assumed.

## Corpus and selection rule

|             |                                            |
| ----------- | ------------------------------------------ |
| Repository  | `https://github.com/openai/skills`         |
| Commit      | `49f948faa9258a0c61caceaf225e179651397431` |
| Survey root | `skills/`                                  |
| Collections | `.curated`, `.system`                      |

**Selection rule (reproducible):** every immediate child directory of
`skills/.curated/` and `skills/.system/` that contains a `SKILL.md`.

`skills/` contains only those two collections. A future `.experimental`
collection, or anything outside `skills/`, is **excluded** rather than folded into
an opaque total — collections differ in review status, and averaging them would
hide that.

**Result: 39 (`.curated`) + 5 (`.system`) = 44 skills.**

## Sidecar findings

Every one of the 44 skills ships an `agents/openai.yaml`. No skill in this corpus
is sidecar-free, so the `ABSENT` path is exercised only by fixtures.

| Composition                           | Count |
| ------------------------------------- | ----- |
| interface only                        | 27    |
| interface + `dependencies`            | 16    |
| interface + `dependencies` + `policy` | 1     |
| interface + `policy` only             | 0     |
| `dependencies` only                   | 0     |
| `policy` only                         | 0     |

Counted independently, because the two behavioural keys are **not** mutually
exclusive:

| Measure                            | Count  |
| ---------------------------------- | ------ |
| skills with `dependencies`         | 17     |
| skills with `policy`               | 1      |
| **behavioural union** (either key) | **17** |
| convertible                        | **27** |
| refused                            | **17** |

27 + 17 = 44, so the split is total: every skill is either convertible or refused
by exactly one of these boundaries.

`resourceFiles` excludes each skill’s `SKILL.md` entry and counts the remaining
files beneath that skill directory, including `agents/openai.yaml`.

The corpus therefore **does** exercise both sides of the policy. It is not a
corpus that this tool refuses wholesale, and not one it accepts wholesale.

## What the corpus never exercises

| Feature                                                      | Occurrences         | Consequence                                                  |
| ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------ |
| `license` in `SKILL.md` frontmatter                          | **0**               | the license-preservation envelope is untested by this corpus |
| `compatibility` frontmatter                                  | **0**               | likewise                                                     |
| `allowed-tools` frontmatter                                  | **0**               | likewise                                                     |
| any frontmatter key beyond `name`, `description`, `metadata` | **0**               | the corpus is narrower than the specification                |
| description over 1024 characters                             | **0** (longest 703) | the over-long-description refusal is untested here           |
| `interface.brand_color`                                      | **0**               | that interface field is untested here                        |
| `policy.products`                                            | **0**               | unexercised, and unenforced upstream                         |
| unknown sidecar top-level keys                               | **0**               | the permissive unknown-key path is untested by real data     |

This is the most useful thing the survey says: the corpus is clean and narrow. It
confirms the _dependency_ boundary against real skills and says nothing at all
about licenses, compatibility, allowed-tools, brand colours or long descriptions.
Those paths rest on unit tests and on the pinned runtime reading — not on this
corpus, and should not be described as if they did.

## Observations

- **`metadata` appears in 8 skills**, so the native metadata mapping is exercised
  by real data.
- **Two layout conventions coexist.** Four `notion-*` skills use singular
  `reference/` alongside `evaluations/` and `examples/`; everything else uses
  plural `references/`. Resource directories are ordinary resources, so the
  profile is indifferent to the naming.
- **A duplicate skill exists across collections.** `openai-docs` is present in both
  `.curated` and `.system` with a byte-identical sidecar. Any aggregate must say
  which collection it counted, or it counts this skill twice.
- **All 17 dependency declarations are `mcp`**, matching the runtime, which
  documents `mcp` as the only supported dependency category.
- **License files are ordinary resources.** No skill carries a `license`
  frontmatter key, but most ship a `LICENSE.txt`/`LICENSE.TXT` resource — which the
  profile copies byte-for-byte without reading.

## Reproducing

The survey never touches the network. Supply a checkout of the pinned commit:

```bash
git clone https://github.com/openai/skills.git /tmp/openai-skills
git -C /tmp/openai-skills checkout 49f948faa9258a0c61caceaf225e179651397431
pnpm survey:codex -- /tmp/openai-skills/skills --out docs/data/openai-skills-49f948fa-codex-profile-survey.json
```

The snapshot records derived facts only: repository, commit, collection, skill
name, entry and sidecar SHA-256, frontmatter and sidecar **key names**, description
_length_, resource counts, classification, status and issue codes. It never
records a description, a body, a `display_name`, a `default_prompt`, a dependency
URL, raw YAML, an absolute path, or a timestamp — so repeated runs over the same
checkout are byte-identical.

## Committed snapshot

The pinned-corpus measurement is committed as
`docs/data/openai-skills-49f948fa-codex-profile-survey.json` (34879 bytes,
SHA-256 `295FEB9A84A1CC4BB1B526CABC49B963AA67BE880BCFA5D699FB96FE22FC1096`). The current survey definition excludes the entry file from
`resourceFiles`; all 44 snapshot rows were corrected by removing their recorded
`SKILL.md` entry once. The original pinned checkout was not available during this
follow-up, so this resource-count correction was derived row by row from the
committed snapshot and the previous counter’s behavior. Every other per-skill
field and all classification totals are unchanged. Re-run the command against the
pinned checkout to independently regenerate the corrected snapshot.

The initial survey was generated in four independent runs over the same checkout
and produced byte-identical output. That established determinism for the original
measurement; the corrected resource counts have not yet been independently
regenerated from the source checkout.

The snapshot is generated, so it is not owned by the formatter: `docs/data/` is
excluded in `.prettierignore`, because reformatting a committed snapshot would
destroy the property that makes it useful.
