# Agent Skills source contract

`dsh-forge convert <path> --source agent-skills --target dsh --out <directory>` reads
an Agent Skills package and converts it to a DeepSeek Harness package.

This document records exactly which upstream behaviour the adapter implements, so
the implementation can be checked against its sources rather than against
recollection.

## Provenance

| Role                                     | Repository                                 | Commit                                     | Verified   |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------ | ---------- |
| Primary (standard + reference validator) | https://github.com/agentskills/agentskills | `69ef37e9424c0a7ea9dd2293b559e43ec8176379` | 2026-10-04 |
| Secondary (public implementation)        | https://github.com/anthropics/skills       | `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4` | 2026-10-04 |

Primary files inspected:

- `docs/specification.mdx` — the normative format specification
- `skills-ref/src/skills_ref/validator.py` — `validate_metadata`, `validate`, `MAX_*`
- `skills-ref/src/skills_ref/parser.py` — `find_skill_md`, `parse_frontmatter`, `read_properties`
- `skills-ref/src/skills_ref/errors.py` — `ParseError`, `ValidationError`
- `skills-ref/src/skills_ref/models.py` — `SkillProperties`

Secondary files inspected:

- `README.md` — states this repository is Anthropic's implementation of skills and
  refers to the standard at agentskills.io
- `skills/skill-creator/SKILL.md` — the authoring guide
- `skills/skill-creator/scripts/quick_validate.py` — the validation helper
- `skills/docx/SKILL.md` — a real published skill, used to confirm the optional
  `license` field in practice

**The adapter performs no network access at run time.** These pins exist only in
source, documentation and tests.

## Implemented rules

### Package

- The source must be a **directory**. A single Markdown file is refused with
  `SOURCE_PACKAGE_SHAPE_INVALID`; it is never downgraded to generic mode.
- A directory with no entry file is refused with `SOURCE_PACKAGE_MISSING_ENTRY`.
- Any files and directories beyond the entry are resources — `scripts/`,
  `references/` and `assets/` are conventions, not an allow-list. Resources are
  copied byte-for-byte and never executed.

### Entry

- Entry names are `SKILL.md` and then `skill.md`, in that order, matching
  `find_skill_md`.
- Entry resolution compares case-insensitively against the directory's real
  entries. On a case-sensitive filesystem this is equivalent to the reference's
  exact lookup; on a case-insensitive one it is the only workable reading, because
  `existsSync('SKILL.md')` there also answers for `Skill.md`.
- The entry file is excluded from the resource list.

### Name

| Rule                    | Limit / check                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Required                | else `AGENT_SKILLS_MISSING_NAME`                                                            |
| Type                    | must be a string, else `AGENT_SKILLS_INVALID_NAME_TYPE`                                     |
| Non-empty after trim    | else `AGENT_SKILLS_EMPTY_NAME`                                                              |
| Normalization           | NFKC, applied before the length and character checks                                        |
| Length                  | max 64 (`AGENT_SKILLS_NAME_TOO_LONG`)                                                       |
| Lowercase               | `name != name.lower()` (`AGENT_SKILLS_NAME_NOT_LOWERCASE`)                                  |
| Leading/trailing hyphen | `AGENT_SKILLS_NAME_HYPHEN_EDGE`                                                             |
| Consecutive hyphens     | `AGENT_SKILLS_NAME_CONSECUTIVE_HYPHENS`                                                     |
| Characters              | Unicode letters, Unicode digits and hyphens only (`AGENT_SKILLS_NAME_INVALID_CHARACTERS`)   |
| Directory match         | NFKC-normalized directory name must equal the name (`AGENT_SKILLS_NAME_DIRECTORY_MISMATCH`) |

### Description

Required, string, non-empty after trim, max 1024 characters. No judgement is made
about quality, phrasing or "pushiness" — that is content, not parsing.

### Compatibility

Optional. Must be a string, max 500 characters.

### Optional fields

`license`, `metadata` and `allowed-tools` are accepted, validated for type, and
preserved verbatim in `source.extraFrontmatter`.

## Deliberate divergences

Every entry below is a place where our adapter does **not** exactly equal the
reference. None of them widens what is accepted in a way that could lose data.

Checked and **not** a divergence: a non-string `name` (for example `name: 42`).
The reference's `isinstance` guard short-circuits before the NFKC call, so it
returns the same "must be a non-empty string" error we report as
`AGENT_SKILLS_INVALID_NAME_TYPE`. Verified by evaluating the reference helper's
exact code path against `42`, `1.5`, `True`, `None`, `''` and `'  '`.

| #   | Area                            | Reference behaviour                                                                                                                                | Our behaviour                                                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `compatibility: ""`             | The specification says 1–500 characters if provided, but `_validate_compatibility` only checks the type and the maximum, so an empty string passes | Accepted, matching the reference                                                               | Following the reference rather than inventing a stricter minimum the reference does not enforce                                                                                                                                                                                                                                                                                                                     |
| 2   | `license` type                  | The validator and parser never check it, so `license: 42` passes                                                                                   | Refused unless it is a string (`AGENT_SKILLS_INVALID_LICENSE_TYPE`)                            | A non-string would enter the IR as an ambiguous JSON value; a string is what both the specification and every observed skill uses                                                                                                                                                                                                                                                                                   |
| 3   | `metadata` values               | `parse_frontmatter` silently coerces keys and values with `str()`, so `version: 1.0` becomes the string `"1.0"`                                    | Refused unless every key and value is already a string (`AGENT_SKILLS_INVALID_METADATA_VALUE`) | A silent type coercion changes a user's data without telling them; refusing and naming the field is loss-aware                                                                                                                                                                                                                                                                                                      |
| 4   | `metadata` shape                | Only the specification states "a map from string keys to string values"; neither implementation checks it                                          | Refused when it is not a plain mapping (`AGENT_SKILLS_INVALID_METADATA_TYPE`)                  | Same reason as 3                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | `allowed-tools` type            | Not checked by either implementation                                                                                                               | Refused unless it is a string                                                                  | Without the check a YAML list would be stored as a JSON array, silently reinterpreting an experimental field                                                                                                                                                                                                                                                                                                        |
| 6   | Body text                       | `parse_frontmatter` returns `parts[2].strip()`, so the body is trimmed                                                                             | The body is preserved exactly as parsed                                                        | The IR's preservation policy is the project's own; trimming is a rewrite, and `docs/skill-ir-v1.md` promises instructions are never trimmed                                                                                                                                                                                                                                                                         |
| 7   | Entry case                      | `find_skill_md` tests the exact names `SKILL.md` then `skill.md`                                                                                   | Same order, resolved case-insensitively against real directory entries                         | `existsSync` cannot distinguish casings on a case-insensitive filesystem; precedence remains identical                                                                                                                                                                                                                                                                                                              |
| 8   | Unknown fields                  | An error listing the unexpected fields                                                                                                             | An error, one issue per key, sorted, reported before the name and description checks           | Deterministic ordering; the reference builds its message from a `set`                                                                                                                                                                                                                                                                                                                                               |
| 9   | Minimum name/description length | The specification says 1–64 and 1–1024; the reference reaches this through its non-empty-string check                                              | Always an error when empty after trim                                                          | Same outcome, stated directly                                                                                                                                                                                                                                                                                                                                                                                       |
| 10  | Character set for `name`        | `all(c.isalnum() or c == "-")` under the interpreter's Unicode tables                                                                              | `\p{L}\p{Lt}\p{N}\p{Nd}\p{Nl}\p{No}`, which is exactly Python's eight `isalnum` categories     | Listing the categories documents an equality rather than widening it. Verified exhaustively: of all 137,935 `isalnum` codepoints, the pattern rejects none.                                                                                                                                                                                                                                                         |
| 11  | Unicode version                 | Whatever `unicodedata` the interpreter ships — Unicode 15.0.0 for the Python 3.12 used to check this                                               | Whatever Unicode version the Node.js runtime ships — Unicode 16.0 for the Node 24 used here    | A version skew, not a rule difference. A letter assigned after Unicode 15.0, such as `U+1C8A CYRILLIC SMALL LETTER TJE`, is an unassigned codepoint in the Unicode 15.0 tables the reference interpreter uses, so such a name is accepted here and refused there. Pinning the adapter to one Unicode version would be a fiction; the direction is locked by a test that asserts against `process.versions.unicode`. |

## Standard versus Anthropic implementation

The two upstreams disagree. The standard wins, and the disagreement is recorded
here rather than resolved silently.

| Area                               | Agent Skills standard / reference                                                     | Anthropic `quick_validate.py`                                                               | Resolution                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Name characters                    | Unicode lowercase alphanumeric plus hyphen: `all(c.isalnum() or c == "-")` after NFKC | ASCII only: `re.match(r'^[a-z0-9-]+$', name)`                                               | Follow the standard. `数据处理` is accepted as a source name; `PDF-Processing` is refused as uppercase by both  |
| Directory-name match               | Required: `Directory name 'x' must match skill name 'y'`                              | **Not checked at all**                                                                      | Follow the standard. A mismatch is refused                                                                      |
| Angle brackets in `description`    | **Not mentioned and not checked**                                                     | Refused: `Description cannot contain angle brackets (< or >)`                               | Follow the standard: `use <tag> syntax` is accepted. This is the single largest behavioural gap between the two |
| Description emptiness              | Empty or whitespace-only is an error                                                  | Empty or whitespace-only is silently accepted                                               | Follow the standard                                                                                             |
| Name emptiness                     | Empty or whitespace-only is an error                                                  | Empty or whitespace-only is silently accepted                                               | Follow the standard                                                                                             |
| `compatibility` type               | Must be a string when present                                                         | Checked only when truthy, so `compatibility: []` passes                                     | Follow the standard                                                                                             |
| `compatibility` empty string       | Accepted (max-only check)                                                             | Accepted (falsy, so skipped)                                                                | Both accept                                                                                                     |
| `metadata` / `allowed-tools` types | Not checked                                                                           | Not checked                                                                                 | We check them anyway (divergences 3–5)                                                                          |
| Entry file                         | `SKILL.md` then `skill.md`                                                            | `SKILL.md` only                                                                             | Follow the standard, so a lowercase-entry package is accepted                                                   |
| `license` in practice              | Documented optional field                                                             | Confirmed in `skills/docx/SKILL.md`: `license: Proprietary. LICENSE.txt has complete terms` | Preserved verbatim                                                                                              |

`skills/skill-creator/SKILL.md` corroborates the standard's directory layout
(`scripts/`, `references/`, `assets/`) and the optional `compatibility` field, and
its `description` is a plain unquoted plain scalar, while `skills/docx/SKILL.md`
uses a double-quoted description containing single quotes and full stops.

## Loss policy

The adapter understands `license`, `compatibility`, `metadata` and `allowed-tools`,
but **understanding is not permission to drop them**. Universal Skill IR v1 has no
universal field for any of them, so they are preserved verbatim in
`source.extraFrontmatter`, and the DSH target then refuses the conversion with
`UNMAPPED_SOURCE_FRONTMATTER`.

That refusal is the intended behaviour, not a gap: mapping `compatibility` onto
DSH `description` or `whenToUse`, or `metadata` onto DSH `metadata`, would be
guessing that a source key means what a same-named target key means. That guess
belongs to a future phase with a real semantic mapping.

Consequently a skill converts only when its frontmatter is exactly `name` and
`description`.

## Source-valid but IR-unsupported

A package can satisfy this contract and still be outside what IR v1 can represent.
The clearest case is a valid Unicode name such as `数据处理`: the Agent Skills
standard allows it, and the generic v1 gate does not.

This is reported as `SOURCE_VALID_BUT_IR_UNSUPPORTED` with the failing generic
rules listed, and the message states explicitly that it is not a source adapter
defect. IR v1 is deliberately left unchanged by Phase 6.

## Runtime guarantees

- No network access, at any point.
- No execution of `scripts/*.sh`, `*.py`, `*.ps1`, `*.bat`, `*.js` or anything
  else found in the package.
- The source skill is never modified.
- Resource copying reuses the Phase 5 safety rules: symlinks and special nodes
  are refused, and source and destination containment are re-validated at copy
  time.
- Converted output is atomic and never overwrites an existing path.

## Known limitations

- The standard is evolving. These rules are pinned to one commit and are not
  claims about later revisions.
- `metadata` coercion differences mean a skill whose metadata uses native YAML
  types is refused here but silently stringified by the reference parser.
- The `name` character set follows the JavaScript runtime's Unicode version, which
  may be newer than the reference interpreter's (divergence 11). A name built from
  a letter assigned after Unicode 15.0 is accepted here.
- Only one source adapter exists. Omitting `--source` keeps the generic local path
  unchanged; no automatic source detection is performed, by design.
- `license` is preserved and never evaluated: there is no license compliance,
  SPDX validation or license inference anywhere in this project.
