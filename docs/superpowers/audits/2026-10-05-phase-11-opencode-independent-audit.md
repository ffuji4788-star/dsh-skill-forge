# DSH Skill Forge — Phase 11 Independent Audit

## Audit result

**PASS** for the research-only contract decision, local IR constraints, and pinned source evidence after follow-up verification. OpenCode implementation remains **NONE**; `--source opencode` is **NOT IMPLEMENTED**.

The initial independent review could not fetch the exact pinned OpenCode runtime and test pages because of upstream cache misses. A follow-up on 2026-10-05 retrieved the pinned files through GitHub's Contents API and verified their Git blob IDs; the original limitation and this follow-up are both recorded below.

## Mode and contract pin

- Mode: **RESEARCH ONLY**
- Repository: `anomalyco/opencode`
- Commit: `95daf90670b7c039c436c85537da5fbfe2205b41`
- Selected contract: **Legacy V1**
- Public docs, legacy V1, and Core/V2 are represented as separate surfaces.
- Pin metadata cross-check: the [official commit page](https://github.com/anomalyco/opencode/commit/95daf90670b7c039c436c85537da5fbfe2205b41) confirms the full SHA, subject `fix(acp): restore session options and reasoning boundaries`, parent `0b934e9`, and a seven-file change set limited to ACP source and tests. The exact skill-related blobs are checked separately below.

## Contract review

| Check                                              | Result | Evidence                                                                    |
| -------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Legacy V1 selected as one explicit pinned contract | PASS   | Contract matrix and pinned links in the research document                   |
| Public docs distinguished from runtime acceptance  | PASS   | Description and naming constraints are stated separately                    |
| Legacy V1 distinguished from Core/V2               | PASS   | V2 is comparison-only; its runtime and tests are pinned to the same commit  |
| Agent Skills equivalence claims constrained        | PASS   | Shared `SKILL.md` entry convention is not presented as semantic equivalence |
| Hybrid mega-schema avoided                         | YES    | No docs/V1/V2 behavior is combined                                          |
| Implementation honesty                             | PASS   | No adapter, profile, or CLI source flag is claimed as supported             |

The initial re-review could verify the official commit metadata page but could not retrieve the pinned content. A later controller follow-up successfully used the official GitHub Contents API with `ref=95daf90670b7c039c436c85537da5fbfe2205b41`. For every fetched file, the decoded local bytes produced the same Git blob ID as the API's `sha` field. A second read-only independent review then checked the corrected contract documents against those snapshots and reported **PASS — no findings**.

The independent follow-up confirmed the legacy V1 string `name` and optional string `description`, V1 discovery boundaries, and the no-description test. It also confirmed the Core/V2 optional `name`, `description`, and `slash` fields, root Markdown name fallback, nested `SKILL.md` scanning, source types and later-source precedence, and the corresponding pinned tests for source loading, permissions, and discovery safety. No current-development or unpinned test evidence remains in the Phase 11 contract claims.

### Follow-up pinned content verification

| Pinned source file                           | Git blob ID                                |
| -------------------------------------------- | ------------------------------------------ |
| `packages/web/src/content/docs/skills.mdx`   | `2ce88ea5682f54abba56f1f56e1ea67e3eb851b4` |
| `packages/opencode/src/skill/index.ts`       | `5a04ec213994a65dd25098b843efca1fbd1c4e0e` |
| `packages/opencode/test/skill/skill.test.ts` | `f365b63f0d7214a84c6889fcc0b356e0bab5caa3` |
| `packages/core/src/skill.ts`                 | `be1cd1d49adcc18643ca3e799d1b00af5313b786` |
| `packages/core/src/skill/discovery.ts`       | `a192ba1023b1658b182f03f7a39aa31341fd8dee` |
| `packages/core/test/skill.test.ts`           | `0f8e1b3cb3d802bbe34a353a692445e0fbc775e7` |
| `packages/core/test/skill-discovery.test.ts` | `e875beb931b2241f111dc17c92e7d92755fe28fd` |

## IR and repository scope

- IR v1: **FROZEN**
- IR v2: **UNCHANGED**; the diff from the Phase 11 base under `src/ir` is empty.
- IR v3: **NONE**
- `src/`: unchanged
- `package.json`, lockfile, TypeScript, ESLint, Vitest, and Prettier configuration: unchanged
- Only research/design documentation is in scope.

The local audit confirmed that `src/ir/skill-ir-v2.ts` requires `source.format` and recognizes only `generic-local-skill` and `agent-skills`. It also requires a non-empty description. This prevents truthful `opencode-v1` provenance under the frozen schema and supports the `Implementation Safe = NO` decision.

## Verification evidence

The package scripts are `vitest run`, `tsc -p tsconfig.json --noEmit`, `eslint .`, `prettier --check .`, and `tsc -p tsconfig.build.json`. Commit `5e75eb1` records a successful run of all five package scripts from the isolated worktree using pnpm 11.7.0 and the process-local setting `pnpm_config_verify_deps_before_run=warn`. Each command emitted a dependency-state warning and then ran; no install was run. Per pnpm's [verifyDepsBeforeRun documentation](https://pnpm.io/settings/build#verifydepsbeforerun), `warn` reports stale `node_modules` instead of automatically installing.

An earlier attempt with the task's default pnpm wrapper failed `EPERM realpath` on the worktree's `node_modules` junction before `pnpm test` started. A direct Vitest run with TEMP inside the Git worktree also failed an existing CLI assertion because the generated output path contained the repository root. Moving process-local TEMP/TMP/TMPDIR outside the Git worktree removed that path contamination. The final package-script rerun below used the existing dependency junction with the warning setting and completed all gates without installing packages.

The package-script results recorded in commit `5e75eb1` are:

| Gate      | Package script result                                        | Script definition                                    |
| --------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Tests     | `pnpm test` — **38 files; 1043 passed; 4 skipped; 0 failed** | `vitest run`; all project-configured test files ran. |
| Typecheck | `pnpm typecheck` — **PASS**                                  | `tsc -p tsconfig.json --noEmit`.                     |
| Lint      | `pnpm lint` — **PASS**                                       | `eslint .`.                                          |
| Format    | `pnpm format:check` — **PASS**                               | `prettier --check .`.                                |
| Build     | `pnpm build` — **PASS**                                      | `tsc -p tsconfig.build.json`.                        |

For the separate direct diagnostic run, Vitest's `--configLoader runner` option used the same `vitest.config.ts`, include pattern, Node environment, and mock restore setting; no CLI file filters or setup files were present. Vitest documents it as an alternative config-processing path at the [Vitest CLI documentation](https://vitest.dev/guide/cli.html#configloader).

The Phase 11 worktree starts at `b770511`, so its suite has 1043 passing tests. The separately reported `master@41a9164` baseline has 1044 tests, including the later resource-count regression case. These counts are not interchangeable. The direct diagnostic run after the documentation additions also passed all 38 files (1043 passed, 4 skipped, 0 failed) when TEMP/TMP/TMPDIR pointed to the isolated task workspace outside the Git worktree.

## Environment limitation

- TEMP/TMP/TMPDIR write, read, delete, and realpath: **PASS** in the isolated task workspace. A Git-worktree-local TEMP path conflicted with an existing absolute-path assertion; Windows denied creating a junction alias.
- Successful package-script run: **PASS** using pnpm 11.7.0 and process-local `verify_deps_before_run=warn`, recorded in commit `5e75eb1`.
- Default sandbox invocation: **BLOCKED** at `EPERM realpath` resolving the worktree's `node_modules` junction. The final rerun was allowed to use the existing junction and completed successfully.
- Direct full test suite after relocating TEMP: **PASS** as recorded above.
- Final Phase 11 follow-up gates after the evidence correction: `pnpm test` **38 files passed; 1,043 passed; 4 skipped; 0 failed**; typecheck, lint, format check, and build **PASS**. The first format check identified only Markdown formatting, which was fixed with the repository Prettier command before the passing format check. The test process used TEMP/TMP/TMPDIR in `work/phase11-test-tmp`, outside the Git worktree. Every pnpm command emitted the existing dependency-state warning; no install occurred.
- Source or lockfile defect: **NO evidence found**
- Classification: **EXECUTION ENVIRONMENT VARIANCE**

## Security review

This change is documentation-only. It adds no network access, subprocess execution, `eval`, source mutation, or third-party runtime execution. Remote fetching, implicit discovery, MCP integration, and permission migration remain non-goals.

## Defects found

The initial evidence table omitted the pinned Core/V2 tests and linked only a current-development test file. The follow-up corrected the source and contract tables and removed the unpinned-test characterization. The final independent review also caught an inaccurate singular-scope phrase in the design spec; it was corrected to say this phase changes only research/design documentation. No other documentation or evidence defect remains.

## Remaining risks

1. Public docs are mutable and may move independently of the pinned runtime.
2. Core/V2 runtime and tests are a separate pinned comparison surface, not the selected V1 contract; their source forms, slash field, precedence, URL catalog, and permissions remain outside Phase 11.
3. Public documentation URLs are mutable and remain a separate reference, not the authority for the selected V1 runtime behavior.
4. The default sandbox invocation still needs access to the existing `node_modules` junction; the final verification completed with that access and no package installation.

## Final status

- OpenCode source implementation: **NO**
- `--source opencode`: **NOT IMPLEMENTED**
- Ready for master integration: **NO**. The branch remains a research-only result and is unintegrated.
- Ready for Phase 12: **NO**
- Master integration, cherry-pick, and push: **NOT DONE**
