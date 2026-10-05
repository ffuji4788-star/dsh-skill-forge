# Real-world compatibility survey

How much of a real Agent Skills corpus can this converter actually convert, and
why not the rest? This document answers that with measurement against a pinned
revision, not with an estimate.

## Corpus

| Field           | Value                                      |
| --------------- | ------------------------------------------ |
| Repository      | https://github.com/anthropics/skills       |
| Commit          | `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4` |
| Survey root     | `skills/`                                  |
| Skills surveyed | **19**                                     |
| Source adapter  | `agent-skills`                             |
| Target          | `dsh`                                      |

The corpus was retrieved once, at development time, as a read-only archive outside
this repository. It is **not vendored**, no file from it is committed, and nothing
in it was executed. All findings are derived facts: skill names, entry hashes,
frontmatter key names, resource counts, verdicts and issue codes.

Reproducibility snapshot: `docs/data/anthropic-skills-8a1541c-survey.json`.

## Methodology

1. Enumerate the immediate child directories of `skills/`. Nested skill trees are
   deliberately not discovered, so the survey is reproducible from the layout.
2. Assess each directory with the **same planner the converter uses**
   (`planConversion`), so a verdict cannot disagree with a real conversion.
3. Derive counts from the verdicts. No values from `SKILL.md` bodies,
   descriptions, license texts or resource contents are recorded anywhere.
4. Cross-check by hand: the raw tree was re-read independently for the sampled
   skills below, comparing frontmatter keys, resource directory names and resource
   file counts against the snapshot.

## Safety

- **No execution.** The corpus contains real `scripts/` directories. Every one was
  treated as a filename and stat'd or copied as bytes; nothing was run. A scan for
  marker files the traps would create found **0** markers after the full survey.
- **Read-only.** No file in the corpus was created, modified or deleted; entry
  content and mtimes were verified unchanged after assessment.
- **No scripts in the loop.** The survey is a TypeScript program that reads,
  parses, stats and hashes. It runs no Python, shell, PowerShell, Node or npm code
  from the corpus.
- **No network at survey time.** The archive was fetched once; the survey itself
  fetches nothing.

## Results

| Metric          | Count |
| --------------- | ----- |
| Total skills    | 19    |
| **Convertible** | **2** |
| Refused         | 16    |
| Source invalid  | 1     |
| IR unsupported  | 0     |

### Compatibility rate

2 of 19 skills (≈11%) would convert with the current lossless policy.

### Blocker frequency

| Blocker                                | Stage    | Skills |
| -------------------------------------- | -------- | ------ |
| `UNSUPPORTED_TARGET_SEMANTIC: license` | SEMANTIC | 16     |
| `AGENT_SKILLS_DESCRIPTION_TOO_LONG`    | SOURCE   | 1      |

`UNMAPPED_SOURCE_FRONTMATTER`, `UNREPRESENTABLE_IR_VALUE`, resource blockers and
`SOURCE_VALID_BUT_IR_UNSUPPORTED` did **not** occur in this corpus.

### Frontmatter distribution

| Field           | Skills | Notes                                                     |
| --------------- | ------ | --------------------------------------------------------- |
| `name`          | 19     | every skill; every one equals its directory name          |
| `description`   | 19     | every skill; one exceeds the 1024-character limit         |
| `license`       | 17     | the dominant blocker                                      |
| `compatibility` | 0      | absent from this corpus                                   |
| `metadata`      | 0      | absent from this corpus                                   |
| `allowed-tools` | 0      | absent from this corpus                                   |
| unknown keys    | 0      | no source-contract violations other than the length limit |

### Resource distribution

| Shape              | Skills |
| ------------------ | ------ |
| with any resources | 18     |
| with `scripts/`    | 8      |
| with `references/` | 1      |
| with `assets/`     | 1      |

Resource counts range from 0 to 82 files per skill.

### Per-skill matrix

| Skill                 | Source  | IR      | Semantic | Resources | Final              | Primary blocker                        |
| --------------------- | ------- | ------- | -------- | --------- | ------------------ | -------------------------------------- |
| academy-guide         | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| algorithmic-art       | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| brand-guidelines      | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| canvas-design         | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| claude-api            | REFUSED | SKIPPED | SKIPPED  | SKIPPED   | **SOURCE_INVALID** | `AGENT_SKILLS_DESCRIPTION_TOO_LONG`    |
| discernment-nudge     | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| doc-coauthoring       | PASS    | PASS    | PASS     | PASS      | **CONVERTIBLE**    | —                                      |
| docx                  | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| frontend-design       | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| internal-comms        | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| mcp-builder           | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| pdf                   | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| pptx                  | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| skill-creator         | PASS    | PASS    | PASS     | PASS      | **CONVERTIBLE**    | —                                      |
| slack-gif-creator     | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| theme-factory         | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| web-artifacts-builder | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| webapp-testing        | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |
| xlsx                  | PASS    | PASS    | REFUSED  | PASS      | REFUSED            | `UNSUPPORTED_TARGET_SEMANTIC: license` |

## Observations

1. **`license` is the dominant blocker in this pinned corpus.** 16 of 19 skills
   carry it. This is a fact about the corpus and the current target contract; it is
   not an argument for changing either. Folding a license into `metadata`, the
   description or the body would invent a meaning the source never stated, which is
   exactly what the lossless policy exists to prevent.
2. **The corpus is otherwise highly compatible.** Every skill satisfied the source
   contract except one, every one passed the IR stage, every one passed resource
   safety, and every directory name matched its declared name. The only reason
   conversion stops is a semantic the target has no field for.
3. **`metadata`, `compatibility` and `allowed-tools` never appear.** The one field
   Phase 7 maps is absent here, and the two fields it refuses alongside `license`
   are absent too. The observed blocker is narrower than the rule set.
4. **One real-world skill violates the Agent Skills contract.** `claude-api` has a
   1068-character `description`, over the specification's 1024 limit. This was
   confirmed independently of this project's code, and the pinned reference
   validator enforces the same limit. It is a finding about the corpus, not a
   defect in the assessor.
5. **Resource shape is rich but unproblematic.** 8 skills ship `scripts/`, and the
   largest bundle has 82 files. None produced a resource blocker, and none was
   executed.
6. **Parity holds on real data.** For all 19 skills, the verdict matched what an
   actual `convert` did: 2 succeeded and generated packages that are generically
   valid and DSH `COMPATIBLE` with zero warnings; 17 did not convert.
7. **The two convertible skills are the two without a license.** That correlation
   is worth stating plainly, while remembering that frequency is not semantic
   equivalence: it tells us `license` is _common_, not that any particular mapping
   for it would be correct.

## Limitations

- **One corpus, one revision, one ecosystem.** These numbers describe the pinned
  commit of one repository. They are not a general compatibility rate, and later
  revisions may differ.
- **The corpus is Anthropic's implementation, not the standard.** Agent Skills is
  a standard with multiple implementations; this survey measures one of them.
- **`license` presence is recorded, not evaluated.** No license text was read for
  legal meaning, no SPDX analysis was performed, and no conclusion is drawn about
  what any license permits. Deciding that belongs to a license-policy phase.
- **Assessment is a preflight, not a guarantee of semantic fidelity.** It reports
  whether the _current_ policy can carry a skill losslessly; it does not claim the
  result behaves like the original in an agent runtime.
- **The snapshot proves identity, not integrity.** Entry hashes are recorded so a
  later run can tell it surveyed the same bytes; they are not a security control.

## Implications for the next phase

Stated as options from evidence, not as recommendations to implement:

- The single highest-leverage change for this corpus would be a **DSH target field
  with defined semantics for a license declaration**. That requires a target
  contract, not a same-name guess, and it must not become license _evaluation_.
- A **description-length policy** is a separate question: the source contract
  correctly refuses `claude-api` as written. Whether an over-long description
  should ever be truncated is a lossy decision and would need its own explicit,
  documented rule — not a silent transform.
- Everything else in this corpus already passes. The remaining risk is not these
  19 skills; it is the fields this corpus happens not to use (`compatibility`,
  `metadata`, `allowed-tools`), which other corpora exercise.
