# DSH Skill Forge — Phase 11 Independent Audit

## Audit result

**PASS WITH EVIDENCE LIMITATION** for the research-only contract decision and local repository facts. OpenCode implementation remains **NONE**; `--source opencode` is **NOT IMPLEMENTED**.

This audit does not certify the pinned upstream source claims as freshly reproduced: the independent reviewer could not fetch the exact pinned OpenCode runtime and test pages due to cache misses. The source links and limitation are explicit in [`docs/opencode-source-contract.md`](../../opencode-source-contract.md).

## Mode and contract pin

- Mode: **RESEARCH ONLY**
- Repository: `anomalyco/opencode`
- Commit: `95daf90670b7c039c436c85537da5fbfe2205b41`
- Selected contract: **Legacy V1**
- Public docs, legacy V1, and Core/V2 are represented as separate surfaces.
- Pin metadata cross-check: the [official commit page](https://github.com/anomalyco/opencode/commit/95daf90670b7c039c436c85537da5fbfe2205b41) confirms the full SHA, subject `fix(acp): restore session options and reasoning boundaries`, parent `0b934e9`, and a seven-file change set limited to ACP source and tests. This verifies the commit identity and context, not the skill-source blobs at that tree.

## Contract review

| Check                                              | Result | Evidence                                                                    |
| -------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Legacy V1 selected as one explicit pinned contract | PASS   | Contract matrix and pinned links in the research document                   |
| Public docs distinguished from runtime acceptance  | PASS   | Description and naming constraints are stated separately                    |
| Legacy V1 distinguished from Core/V2               | PASS   | V2 behavior is comparison-only and its test link is marked unpinned         |
| Agent Skills equivalence claims constrained        | PASS   | Shared `SKILL.md` entry convention is not presented as semantic equivalence |
| Hybrid mega-schema avoided                         | YES    | No docs/V1/V2 behavior is combined                                          |
| Implementation honesty                             | PASS   | No adapter, profile, or CLI source flag is claimed as supported             |

The V1 frontmatter and runtime claims are carried forward from the phase research and linked to the exact pin. In this controller re-review, the official commit metadata page loaded, but the pinned V1 runtime, V1 test, Core/V2 runtime, and pinned documentation blobs still returned cache misses. Raw/API routes were unavailable, and a direct fetch of the exact commit ended with a connection reset. The commit-page cross-check therefore narrows the uncertainty to source content; it does not independently verify the contract behavior claims.

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

This task's bundled pnpm runtime could not reproduce that run: with the same setting it warned, then failed `EPERM realpath` on the worktree's `node_modules` junction before `pnpm test` started. An initial direct Vitest run with TEMP inside the Git worktree also failed an existing CLI assertion because the generated output path contained the repository root. Moving process-local TEMP/TMP/TMPDIR to the isolated task workspace outside the Git worktree removed that path contamination; the full direct suite then passed. A direct TypeScript invocation from the worktree junction produced dependency-type-resolution errors, while the successful pnpm typecheck recorded in `5e75eb1` and an earlier direct invocation targeting the worktree config from the dependency checkout passed. These differences are execution-environment limitations, not source fixes.

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
- This task's bundled pnpm runtime: **BLOCKED** at `EPERM realpath` resolving the worktree's `node_modules` junction, even with the warning setting.
- Direct full test suite after relocating TEMP: **PASS** as recorded above.
- Controller re-run after this audit update: the default pnpm wrapper was blocked before script startup by the same junction `EPERM`. With access to the existing dependency junction and `verify_deps_before_run=warn`, typecheck, lint, format check, and build passed. The test process exited before reporting test files or assertions; a retry reported `memory allocation of 230928 bytes failed` and Windows exit `-1073740791`. A direct Vitest diagnostic also ended in V8 zone-allocation OOM. No install or source change occurred. The earlier successful full-suite result remains recorded, but this follow-up did not reproduce a complete gate pass.
- Source or lockfile defect: **NO evidence found**
- Classification: **EXECUTION ENVIRONMENT VARIANCE**

## Security review

This change is documentation-only. It adds no network access, subprocess execution, `eval`, source mutation, or third-party runtime execution. Remote fetching, implicit discovery, MCP integration, and permission migration remain non-goals.

## Defects found

None in the local repository evidence. The upstream source-fetch limitation is recorded as an evidence risk, not silently treated as a verified fact.

## Remaining risks

1. Public docs are mutable and may move independently of the pinned runtime.
2. The Core/V2 test evidence is exploratory and unpinned.
3. The independent auditor could not re-fetch the pinned V1 runtime and tests; future implementation review should verify those exact sources again.
4. The successful pnpm 11.7.0 gate run cannot be reproduced with this task's bundled pnpm runtime because realpath access to the dependency junction is denied.

## Final status

- OpenCode source implementation: **NO**
- `--source opencode`: **NOT IMPLEMENTED**
- Ready for master integration: **NO**. The controlling review found no local documentation or IR defect, but the exact pinned skill-source and test contents remain unverified in that review. The branch remains research-only and unintegrated.
- Ready for Phase 12: **NO**
- Master integration, cherry-pick, and push: **NOT DONE**
