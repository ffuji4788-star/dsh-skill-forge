# OpenCode source contract research

Status: **RESEARCH ONLY**. This repository does not implement an OpenCode source adapter or `--source opencode`.

- Research baseline: `b770511f098ce6872393d1e80dc56697026c2a47`
- OpenCode pin: `anomalyco/opencode@95daf90670b7c039c436c85537da5fbfe2205b41`
- Evidence reviewed: 2026-10-05

## Decision

For this phase, the only selected contract is the **legacy V1 runtime** at the pinned OpenCode commit. Public documentation and Core/V2 are separate evidence surfaces. They are not combined into one schema.

Implementation is unsafe under the current IR constraints. An accurate source value would be `opencode-v1`, but IR v2 currently accepts only `generic-local-skill` and `agent-skills`. Either existing value would misstate provenance. V1 also accepts a missing description, while the current IR requires a non-empty description. The missing-description case has an existing refusal path; the provenance conflict does not.

IR v1 stays frozen; IR v2 remains unchanged; no IR v3 is proposed. The Phase 11 result is research-only.

## Evidence and pin

| Evidence surface             | Source                                                                                                                                                                                                                                                                                                              | Use in this research                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| OpenCode repository revision | [Commit `95daf90670b7c039c436c85537da5fbfe2205b41`](https://github.com/anomalyco/opencode/commit/95daf90670b7c039c436c85537da5fbfe2205b41)                                                                                                                                                                          | Immutable runtime pin for legacy V1 and the Core/V2 comparison source              |
| Public Skills docs           | [opencode.ai/docs/skills](https://opencode.ai/docs/skills/)                                                                                                                                                                                                                                                         | Current published guidance; mutable and not the runtime pin                        |
| Docs source at the pin       | [packages/web/src/content/docs/skills.mdx](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/web/src/content/docs/skills.mdx)                                                                                                                                            | Pinned documentation snapshot                                                      |
| Legacy V1 runtime            | [packages/opencode/src/skill/index.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/skill/index.ts)                                                                                                                                                    | Selected behavioral contract                                                       |
| Legacy V1 tests              | [packages/opencode/test/skill/skill.test.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/test/skill/skill.test.ts)                                                                                                                                        | Runtime corroboration, including acceptance of skills without descriptions         |
| Core/V2 runtime              | [packages/core/src/skill.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/core/src/skill.ts), [discovery.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/core/src/skill/discovery.ts)                              | Separate comparison contract and URL discovery implementation, not selected for V1 |
| Core/V2 tests                | [packages/core/test/skill.test.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/core/test/skill.test.ts), [skill-discovery.test.ts](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/core/test/skill-discovery.test.ts) | Pinned comparison tests for source precedence, loading, and URL discovery safety   |
| V2 public docs               | [dev.opencode.ai/v2/docs/skills](https://dev.opencode.ai/v2/docs/skills/)                                                                                                                                                                                                                                           | Separate V2 reference                                                              |

The first independent review could not retrieve the pinned source pages. In a follow-up on 2026-10-05, the controller retrieved the seven pinned source files through GitHub's Contents API with the full commit SHA as `ref`, then confirmed each local Git blob ID matched the API's blob SHA. The verified IDs and audit scope are recorded in the [Phase 11 audit](superpowers/audits/2026-10-05-phase-11-opencode-independent-audit.md).

## Contract matrix

| Surface                  | Observed behavior                                                                                                                                                                                                                                                                                                                                       | Phase 11 interpretation                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public docs              | A skill directory contains `SKILL.md`. `name` and `description` are required; `license`, `compatibility`, and string-to-string `metadata` are optional. Docs specify lower-case kebab-case names, 1–64 characters, a name/directory match, and ignoring unknown frontmatter. They also describe project, global, and compatibility discovery locations. | Public format and UX guidance. Do not present these requirements as legacy runtime validation unless the pinned runtime proves them.                           |
| Pinned legacy V1 runtime | Runtime information requires `name` to be a string. `description` may be absent; when present it must be a string. V1 discovers `SKILL.md` files under configured roots.                                                                                                                                                                                | Selected contract. The importer boundary, if reconsidered, would be one explicitly supplied local skill directory; DSH would not implement OpenCode discovery. |
| Pinned legacy V1 tests   | Tests cover skills without descriptions and V1 package/discovery behavior.                                                                                                                                                                                                                                                                              | Corroborate the pinned V1 runtime only.                                                                                                                        |
| Pinned Core/V2 runtime   | A distinct loader accepts optional `name`, `description`, and `slash`; scans root `*.md` plus `**/SKILL.md`; derives a missing name from a root Markdown filename; and supports embedded, directory, and URL sources. Later sources replace earlier entries with the same name.                                                                         | Comparison only. Do not import V2 fields, resolution, precedence, discovery, or URL behavior into V1.                                                          |
| Pinned Core/V2 tests     | Tests exercise source deduplication and precedence, a root Markdown name fallback, slash metadata, nested `SKILL.md`, URL source loading, permission filtering, and URL-catalog path/origin checks and cache updates.                                                                                                                                   | Corroborate the pinned Core/V2 runtime only. These V2 fields and behaviors remain outside the selected V1 contract and Phase 11 implementation scope.          |

The public docs' description and naming rules are stricter than the V1 runtime acceptance boundary. Core/V2 also has behaviors absent from V1. These differences are explicit; no docs/V1/V2 mega-schema is defined. The pinned V2 tests corroborate only the Core/V2 comparison surface; they do not change the selected V1 contract.

## Agent Skills relationship

OpenCode V1 and Agent Skills share the `SKILL.md` entry convention, but that overlap does not establish full semantic equivalence. V1's runtime acceptance of missing descriptions differs from the public docs and from the DSH IR core. OpenCode provenance must not be labeled `agent-skills`, and the Agent Skills semantic-lifting path must not be applied to V1 input.

## Candidate boundary if reconsidered

Any separately approved future implementation would be limited to one local directory explicitly supplied by the user. It would require a root `SKILL.md`, validate only the pinned V1 runtime rules, reuse the existing YAML parser and safe resource walker where behavior matches, and refuse values not representable in IR without inventing data.

This is not an implementation authorization. This phase adds no adapter, CLI source flag, remote fetching, global/project discovery, configured source precedence, MCP or permission migration, LLM interpretation, registry, or IR change. No OpenCode runtime behavior is added to DSH.

## Security and known risks

- No OpenCode adapter or source-processing runtime is added in this research phase.
- Remote URLs, implicit discovery, permission migration, and MCP migration are out of scope.
- The public documentation is mutable; the V2 documentation URL is a separate reference and is not used to define V1 behavior.
- OpenCode contracts may evolve. Revisit only with a new explicit pin and separate evidence for each runtime generation.
- A future implementation needs an IR change or another truthful provenance design before it can safely emit OpenCode V1 input.
