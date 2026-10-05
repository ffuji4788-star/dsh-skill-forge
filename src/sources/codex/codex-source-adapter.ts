/**
 * The Codex source adapter.
 *
 * Codex is **not** a second package format, so this adapter does not parse
 * `SKILL.md`, walk resources, validate names or resolve the entry file. It calls
 * {@link loadAgentSkill} — the same implementation `--source agent-skills` uses —
 * and then adds the one thing Codex has that Agent Skills does not: the optional
 * `agents/openai.yaml` product sidecar.
 *
 * That is the whole reason this is a *profile* and not another adapter:
 *
 *     Codex package
 *       → agent-skills package contract   (reused, not copied)
 *       → Codex sidecar inspection        (this file)
 *       → Universal IR v2                 (unchanged)
 *       → DSH target                      (unchanged)
 *
 * The sidecar itself is never parsed into the IR and never re-serialized when it
 * is accepted. It stays an ordinary resource, copied byte-for-byte, because
 * re-emitting it would lose comments, ordering and quoting that belong to the
 * source — and because the target does not interpret it anyway.
 *
 * Nothing here executes a resource, mutates the source, or touches the network:
 * a sidecar URL is data that is classified and never fetched.
 */
import { loadAgentSkill } from '../agent-skills/agent-skills-source-adapter.js';
import type { SourceLoadResult } from '../../conversion/source-adapter.js';
import { inspectCodexSidecar, CODEX_SOURCE_ID } from './codex-contract.js';

/**
 * Reads a Codex skill package.
 *
 * A refusal from the shared Agent Skills contract is passed through unchanged: the
 * package contract is identical, so a failure there is a failure here for the same
 * reason. Only after the package itself is valid does the sidecar get a say.
 *
 * @param inputPath Directory to read; relative paths resolve against `cwd`.
 * @param cwd Directory used to resolve a relative input path.
 * @returns The parsed skill, or a refusal describing what was wrong.
 * @throws SkillInputError when the path is missing or unreadable.
 */
export function loadCodexSkill(inputPath: string, cwd: string): SourceLoadResult {
  const loaded = loadAgentSkill(inputPath, cwd, CODEX_SOURCE_ID);
  if (!loaded.ok) {
    return loaded;
  }

  const sidecar = inspectCodexSidecar(loaded.sourceRoot);
  if (sidecar.issues.length > 0) {
    return {
      ok: false,
      source: CODEX_SOURCE_ID,
      // The package itself is valid Codex; what it *declares* is behavioural and
      // the target cannot express it. Calling this a source-contract failure
      // would report a well-formed skill as malformed.
      issues: sidecar.issues,
      selection: 'target-support',
      codexSidecar: sidecar.kind,
    };
  }

  return { ...loaded, codexSidecar: sidecar.kind };
}

/**
 * Reports which sidecar a Codex package carried.
 *
 * Kept separate from the load result so a caller that only needs the verdict does
 * not have to narrow the union.
 *
 * @param result A successful Codex load.
 * @returns The sidecar kind, defaulting to `ABSENT` when unreported.
 */
export function codexSidecarKindOf(result: SourceLoadResult): string {
  if (!result.ok || result.source !== CODEX_SOURCE_ID) {
    return 'ABSENT';
  }
  return result.codexSidecar ?? 'ABSENT';
}
