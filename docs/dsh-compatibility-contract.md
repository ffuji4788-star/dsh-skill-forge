# DeepSeek Harness compatibility contract

This document records **where** the `dsh-forge compat` rules come from and **what**
they are. It is our interpretation of one pinned upstream revision, not a copy of
upstream source.

DeepSeek Harness is in **developer preview**. The contract below is pinned to a
single commit; it does not follow `master`, and it is never fetched at run time.
When upstream changes, this profile and its tests are what must be updated.

## Provenance

| Field               | Value                                           |
| ------------------- | ----------------------------------------------- |
| Upstream repository | https://github.com/deepseek-ai/deepseek-harness |
| Upstream commit     | `5badb15009ae1756c3afe0ae0cef1faafc290ccc`      |
| Commit date         | 2026-10-03                                      |
| Verified at         | 2026-10-04                                      |
| Verified by         | `dsh-skill-forge` Phase 3 contract research     |

This revision is pinned deliberately: it is a specific commit, not `latest` and
not a moving branch.

### Source files inspected

| File                                                             | What it established                                                                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/skill/skill/src/index.ts`                              | `SKILL_NAME` pattern; `validateDefinition`; `validateCandidate`; `validateInvocation`                                                                                                     |
| `packages/skill/skill-filesystem/src/index.ts`                   | `parseSkillFile`; `stringField`; `optionalString`; `optionalMetadata`; `parseInvocationPolicy`; `frontmatterBoolean`; `rejectLegacyInvocationKey`; `discoverRoot`; `isPotentialSkillPath` |
| `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` | official expectations, including boolean spellings and rejected legacy/invalid invocation frontmatter                                                                                     |
| `packages/skill/skill-filesystem/README.md`                      | stated discovery shapes and documented boolean spellings                                                                                                                                  |
| `docs/subsystems/skills.md`                                      | stated frontmatter keys and policy projection                                                                                                                                             |

Code and official tests take precedence over prose. Where the README and the
implementation disagree, the implementation is what this profile follows.

## Implemented rules

### Required fields

| Rule                                          | Upstream evidence                         | Our severity                         |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| `name` is a string with `length > 0`          | `stringField`                             | error if absent, non-string or empty |
| `name` matches `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` | `SKILL_NAME`, applied in `parseSkillFile` | error                                |
| `description` is a string with `length > 0`   | `stringField`                             | error if absent, non-string or empty |

`stringField` checks `length > 0` and does **not** trim. A description made only
of spaces is therefore **accepted** by the pinned contract, even though
`dsh-forge validate` reports it as a generic structural problem. That difference
is intentional and asserted in the test suite.

### Optional fields

| Field        | Upstream behaviour                                                                                            | Our severity                          |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `whenToUse`  | `optionalString`: kept when it is a string with `length > 0`, otherwise dropped silently                      | warning `DSH_IGNORED_WHEN_TO_USE`     |
| `metadata`   | `optionalMetadata`: kept when it is an object that is neither `null` nor an array, otherwise dropped silently | warning `DSH_IGNORED_METADATA`        |
| unknown keys | not read, not rejected                                                                                        | warning `DSH_IGNORED_FRONTMATTER_KEY` |

Silently ignored values are warnings, never errors: the pinned provider accepts
such a skill and simply does not carry the value through.

### Invocation frontmatter

`parseInvocationPolicy` reads the exact kebab-case keys
`disable-model-invocation` and `user-invocable` and projects them into
`{ modelInvocable, userInvocable }`:

- `disable-model-invocation` omitted → `modelInvocable: true`;
  `true` → `modelInvocable: false`.
- `user-invocable` omitted → `userInvocable: true`; `false` →
  `userInvocable: false`.

`frontmatterBoolean` accepts:

| Accepted                 | Values                                |
| ------------------------ | ------------------------------------- |
| boolean                  | `true`, `false`                       |
| number                   | `1`, `0`                              |
| string digits            | `'1'`, `'0'`                          |
| words (case-insensitive) | `true`/`yes`/`on`, `false`/`no`/`off` |

Anything else raises `frontmatter field "<key>" must be a boolean`, and
`parseSkillFile` then **ignores the whole skill**. We report that as
`DSH_INVALID_INVOCATION_VALUE` with severity **error**.

### Legacy invocation keys

`rejectLegacyInvocationKey` rejects these field names outright:

| Legacy key               | Canonical replacement      |
| ------------------------ | -------------------------- |
| `disableModelInvocation` | `disable-model-invocation` |
| `modelInvocable`         | `disable-model-invocation` |
| `userInvocable`          | `user-invocable`           |

The rejection throws during parsing, so the pinned provider ignores the whole
skill. We report `DSH_LEGACY_INVOCATION_KEY` with severity **error**.

### Body

`parseSkillFile` stores `parsed.body.trim()` and `validateDefinition` only requires
`content` to be a string. An empty body is **accepted**; we report
`DSH_EMPTY_CONTENT` as a **warning** because nothing would be injected.

### Discovery shape

`discoverRoot` lists one scanned root and considers exactly two shapes:

- `<scanned-root>/<name>/SKILL.md` (directory bundle)
- `<scanned-root>/<name>.md` (flat file)

`isPotentialSkillPath` rejects any path deeper than two segments, so a nested
`**/SKILL.md` is deliberately **not** discovered.

The directory or file name is **not** compared with the frontmatter `name`; the
provider reads the name from frontmatter. The pinned code therefore does not
require `directory name == frontmatter name`, nor `flat filename == frontmatter
name`, and this profile does not require it either.

Because the scanned root a skill will be installed into is a deployment decision,
`dsh-forge compat` reports package compatibility only and states that the actual
installation and discovery location is not verified.

## Deliberate divergences from upstream

| Difference                                                               | Reason                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Malformed YAML is a **fatal** error (exit 1) instead of a per-file skip  | `dsh-forge` checks one skill at a time and cannot report a validation result for a document that could not be parsed; the pinned provider warns and continues scanning siblings, which is a multi-file discovery concern |
| Generic structural validation (`validate`) is stricter than this profile | It answers a different question ("is the skill well formed?") and must not be loosened to match a target's acceptance rules                                                                                              |

## Network policy

The contract is researched and pinned at development time. Running
`dsh-forge compat` performs no network access; `tests/dsh-contract.test.ts` has an
opt-in live check that runs only when `DSH_FORGE_VERIFY_UPSTREAM=1` is set.
