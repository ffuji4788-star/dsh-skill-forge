# OpenCode source contract reconciliation — Phase 11 design

Status: research-only outcome; final gates passed
Repository baseline: dsh-skill-forge at b770511f098ce6872393d1e80dc56697026c2a47
OpenCode pin: anomalyco/opencode@95daf90670b7c039c436c85537da5fbfe2205b41
Evidence checked: 2026-10-05

## Decision summary

Select the legacy V1 runtime at the pinned OpenCode commit as the only contract considered for this phase. Public documentation and Core/V2 are separate evidence surfaces; neither is merged into the selected runtime contract.

Implementation Safe: NO under the current Phase 11 constraints. An honest OpenCode provenance value would be opencode-v1, but the frozen IR v2 validator only accepts generic-local-skill and agent-skills. Adding opencode-v1 would change IR v2; labeling OpenCode input as either existing value would misstate provenance. OpenCode V1 also accepts a missing description, while the IR core requires a non-empty description. The existing pipeline can report this second case as source-valid but not representable, but it cannot resolve the provenance mismatch.

Recommendation: accept this as a research-only Phase 11 result and do not add --source opencode. This preserves IR v1, IR v2, and the selected runtime boundary without inventing a combined schema.

## Goal and constraints

This document reconciles the OpenCode public Skills documentation, the legacy runtime, and the Core/V2 runtime and tests. It selects one pinned contract and defines the implementation gate.

Any future implementation proposed under a separately approved IR change must remain a local, explicit single-package import. It must reuse the repository frontmatter parser, ParsedSkill representation, and hardened resource walker where those primitives match the selected V1 behavior. It must not add remote URL loading, global or project discovery, MCP or permission migration, LLM behavior, or an adapter registry.

IR v1 remains frozen. IR v2 remains unchanged for this phase. No IR v3 is proposed.

## Pin and evidence

The selected V1 runtime and its tests, along with the comparison runtime source, are pinned to one immutable OpenCode commit. Mutable public docs are linked separately, and the accessible V2 test suite is marked as unpinned exploratory evidence.

| Evidence                                      | Pin or URL                                                                                                                                                                   | Role                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OpenCode repository commit                    | [95daf90670b7c039c436c85537da5fbfe2205b41](https://github.com/anomalyco/opencode/commit/95daf90670b7c039c436c85537da5fbfe2205b41)                                            | Single runtime revision considered by Phase 11                                        |
| Public documentation, reviewed 2026-10-05     | [opencode.ai/docs/skills](https://opencode.ai/docs/skills/)                                                                                                                  | Published format and discovery guidance; mutable documentation, not the runtime pin   |
| Public documentation source at the pin        | [packages/web/src/content/docs/skills.mdx](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/web/src/content/docs/skills.mdx)     | Documentation snapshot associated with the pinned source tree                         |
| Legacy V1 runtime                             | [packages/opencode/src/skill/index.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/skill/index.ts)             | Runtime behavior selected for this phase                                              |
| Legacy V1 tests                               | [packages/opencode/test/skill/skill.test.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/test/skill/skill.test.ts) | Runtime behavior checks, including skills without descriptions                        |
| Core/V2 runtime                               | [packages/core/src/skill.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/core/src/skill.ts)                                 | Separate V2 runtime; comparison only                                                  |
| Current Core/V2 tests (exploratory, unpinned) | [packages/core/test/skill.test.ts](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/core/test/skill.test.ts)                                                | Current-development corroboration only; not evidence for the selected pinned contract |
| V2 public documentation                       | [dev.opencode.ai/v2/docs/skills](https://dev.opencode.ai/v2/docs/skills/)                                                                                                    | V2 behavior reference; not used to define V1                                          |

The runtime commit is a fixed contract pin. The public documentation URLs are recorded separately because the published pages can move independently of that commit.

## Contract matrix

| Surface                                                               | Observed contract                                                                                                                                                                                                                                                                                                                                                                            | Authority and mismatch                                                                                                                                                                       | Phase 11 treatment                                                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Current public docs                                                   | One directory per skill with SKILL.md. Frontmatter requires name and description; license, compatibility, and string-to-string metadata are optional. The docs specify lower-case kebab-case names, a 1–64 character limit, and a match between name and containing directory. Unknown frontmatter fields are ignored. Docs describe project, global, and compatibility discovery locations. | Publicly stated format and UX guidance. It is stricter than legacy V1 runtime acceptance for description and name rules.                                                                     | Reference only. Do not silently treat these documented requirements as V1 runtime enforcement.                        |
| Pinned legacy V1 runtime                                              | The runtime skill information requires a string name and allows description to be absent; a present description is a string. V1 discovery is based on SKILL.md files under its configured roots.                                                                                                                                                                                             | Runtime implementation is the selected behavioral authority. It does not establish the public docs' full name regex, directory-name match, or description requirement as runtime validation. | Selected contract. The importer surface remains one explicitly supplied local skill directory, not runtime discovery. |
| Pinned legacy V1 tests                                                | Tests cover discovery of skills without descriptions and the V1 package/discovery behavior.                                                                                                                                                                                                                                                                                                  | Tests corroborate the pinned runtime; they do not define undocumented V2 behavior.                                                                                                           | Use as the test oracle for V1-only frontmatter acceptance.                                                            |
| Pinned Core/V2 runtime; current-development tests reviewed separately | V2 has a distinct loader and source model. It permits optional name and description, recognizes slash-related fields, derives IDs from paths, supports root Markdown and nested SKILL.md forms, and handles configured sources/precedence. The V2 test suite inspected is on current development and is not pinned evidence.                                                                 | This is a different runtime contract. It has behaviors absent from the selected V1 profile and must not be combined with it.                                                                 | Comparison only; no V2 fields, resolution, discovery, source precedence, or URL behavior are imported.                |

### Material differences

1. Public docs require description; the pinned V1 runtime and tests accept a skill without one.
2. Public docs specify name syntax and directory matching that are not part of the selected V1 runtime validation boundary.
3. Core/V2 introduces path-derived IDs, optional frontmatter, slash/autoinvoke behavior, extra source forms, and precedence. These are not V1 rules.
4. The three surfaces therefore do not form one schema. The V1 profile must not claim to implement the docs and V2 contracts at the same time.

## Selected contract boundary

If implementation is reconsidered after the IR constraint changes, the only candidate contract is the legacy V1 runtime at the pinned commit.

The proposed import boundary is:

- Input is one local directory explicitly supplied by the user.
- The directory must contain the V1 entry file SKILL.md at its root. No recursive skill discovery, global search, or automatic source detection is performed by dsh-forge.
- V1 frontmatter requires name to be a string. Description may be absent; if present, it must be a string.
- Do not add the public documentation's name regex, directory-name equality, or description requirement as V1 runtime rules unless separately proven in the pinned V1 implementation.
- Do not promote license, compatibility, metadata, slash, autoinvoke, permissions, MCP declarations, or other fields into target semantics. Fields not interpreted by this V1 profile remain source data when representable by the existing envelope.
- Reuse the existing YAML frontmatter parser, ParsedSkill builder, and safe local resource enumeration/copying. Use a narrow V1 entry resolver and frontmatter check where Agent Skills resolution or validation is stricter or different.
- Do not call the Agent Skills semantic lifting path for OpenCode V1. Doing so would interpret fields that the selected runtime profile does not establish.
- A V1-valid skill without a description is not representable by the current IR core. It must be reported as source-valid but IR-unsupported; do not synthesize a description.

This boundary deliberately does not implement OpenCode runtime discovery. A path such as .opencode/skills/<name>/SKILL.md is accepted only when the user supplies the individual skill directory; the importer does not search for it.

## Implementation-safety assessment

The current repository's IR v2 source-format allowlist is defined in src/ir/skill-ir-v2.ts and accepts only generic-local-skill and agent-skills. The accurate provenance value for this profile would be opencode-v1.

- Adding opencode-v1 to the IR v2 allowlist would modify IR v2 and violate the phase constraint.
- Writing agent-skills would assert a different source contract and could trigger Agent Skills semantic lifting.
- Writing generic-local-skill would erase the explicit source selection and misstate provenance.
- Omitting provenance is not possible in the current IR v2 shape.

The missing-description difference can use the existing source-valid-but-IR-unsupported refusal path. The provenance mismatch cannot be handled truthfully without changing the frozen IR boundary or changing what IR v2 means.

Therefore Implementation Safe is NO. No --source opencode implementation plan should be approved under the current constraints. Phase 11 may close as research-only with this decision and evidence.

## Explicit non-goals

This phase does not implement or propose:

- HTTP or other remote URL fetching
- global or project-wide source discovery
- config-file source lists, source precedence, or duplicate resolution
- MCP, permissions, autoinvoke, or slash-command migration
- LLM-assisted interpretation
- a generic adapter registry
- a hybrid of public docs, legacy V1, and Core/V2
- IR v1 changes, IR v2 changes, or IR v3

## Acceptance checks if a future phase reopens implementation

These are design assertions, not tests added in this research phase:

- Selecting OpenCode is explicit; omitting --source retains generic behavior.
- A supplied local package is checked only against the pinned V1 contract.
- Missing description passes V1 source validation but is refused by the existing IR representability gate without an invented value.
- Wrong types for required V1 fields are refused with stable source-contract findings.
- V1-ignored fields are not promoted into portable target semantics.
- Resources are enumerated and copied as inert local files through existing safe primitives.
- No network access or implicit discovery occurs.
- A future implementation must show that source provenance can be recorded truthfully without changing a frozen IR contract; this condition remains unmet in Phase 11.

## User decision

The user accepted the V1-only contract selection and research-only outcome on 2026-10-05. No implementation plan or source change is authorized under the unchanged IR v2 constraint.

## Independent audit

A read-only audit reviewed the documentation change from baseline b770511f098ce6872393d1e80dc56697026c2a47 to spec commit 36b637899e8f663fadf16115e07af96b07dd27c8.

The audit found no correctness issues in the local repository evidence and independently confirmed:

- IR v2 requires source.format and accepts only generic-local-skill and agent-skills in src/ir/skill-ir-v2.ts.
- The basic validation and conversion-planning path refuses a missing description as source-valid but not representable after a future source adapter accepts it.
- The current-development V2 test suite is marked unpinned and is not used as evidence for the selected V1 contract.

The auditor could not fetch the pinned OpenCode runtime and test pages because of upstream cache-miss errors. It therefore did not independently re-verify the V1 frontmatter, discovery, and test-coverage details or the pinned Core/V2 runtime details. The contract matrix retains exact pinned links for those source claims; this audit limitation is explicit and does not authorize combining contracts or changing the IR.

The independent audit's assessment is ready as a research-only Phase 11 result, with the upstream fetch limitation noted above. No local defect required correction.

## Verification

The final documentation diff was checked from the isolated `phase11-opencode` worktree. The original `package.json` scripts were run with pnpm 11.7.0 and `pnpm_config_verify_deps_before_run=warn`, which disables automatic dependency installation while retaining the dependency-status warning:

- `pnpm test`: 38 files passed; 1,043 tests passed, 4 skipped, 0 failed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm build`: passed.
- `git diff --check`: passed.

Each pnpm invocation warned that the linked `node_modules` workspace structure had changed since its last install. No install was run. The `package.json` and `pnpm-lock.yaml` are identical between the selected baseline `b770511` and the available `41a9164` revision; this phase changes only this research document and does not change source code, package metadata, or the lockfile.
