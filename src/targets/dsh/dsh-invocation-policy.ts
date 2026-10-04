/**
 * The invocation-policy rules of the pinned DSH contract.
 *
 * Mirrors upstream `parseInvocationPolicy` and `frontmatterBoolean`
 * (`skill-filesystem/src/index.ts`):
 *
 * - a legacy key is rejected outright, which makes the provider ignore the whole
 *   skill rather than merely warning;
 * - `disable-model-invocation` and `user-invocable` accept a boolean, `1`/`0`
 *   (number or string) and the case-insensitive words `true`/`yes`/`on` and
 *   `false`/`no`/`off`;
 * - any other value is rejected, which also drops the whole skill;
 * - omitted fields default to permitting their surface.
 */
import {
  DSH_BOOLEAN_FALSE_WORDS,
  DSH_BOOLEAN_TRUE_WORDS,
  DSH_LEGACY_INVOCATION_KEYS,
} from './dsh-contract.js';

/** The normalised invocation policy a provider projects into the registry. */
export interface DshInvocationPolicy {
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
}

/** A rejected invocation field, with the reason the provider would report. */
export interface DshInvocationProblem {
  readonly key: string;
  /** `legacy` when the field name itself is unsupported; `value` otherwise. */
  readonly kind: 'legacy' | 'value';
  readonly message: string;
}

/**
 * Resolves a boolean the way upstream `frontmatterBoolean` does.
 *
 * @param value Raw frontmatter value.
 * @returns The boolean, or `undefined` when the value is not accepted.
 */
export function parseDshFrontmatterBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === '1') {
    return true;
  }
  if (value === 0 || value === '0') {
    return false;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (DSH_BOOLEAN_TRUE_WORDS.includes(normalized)) {
      return true;
    }
    if (DSH_BOOLEAN_FALSE_WORDS.includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

/** Applies upstream defaults: an omitted field permits its surface. */
export function defaultDshInvocationPolicy(): DshInvocationPolicy {
  return { modelInvocable: true, userInvocable: true };
}

/**
 * Resolves the invocation policy for a frontmatter object.
 *
 * @param frontmatter Parsed frontmatter.
 * @returns The policy, the first problem encountered (if any), and the rest.
 */
export function resolveDshInvocationPolicy(frontmatter: Record<string, unknown>): {
  readonly policy: DshInvocationPolicy;
  readonly problems: readonly DshInvocationProblem[];
} {
  const problems: DshInvocationProblem[] = [];

  // Legacy keys are rejected before the canonical fields are read, matching the
  // order in upstream `parseInvocationPolicy`.
  for (const [legacy, canonical] of DSH_LEGACY_INVOCATION_KEYS) {
    if (Object.hasOwn(frontmatter, legacy)) {
      problems.push({
        key: legacy,
        kind: 'legacy',
        message: `frontmatter field "${legacy}" is unsupported; use "${canonical}"`,
      });
    }
  }

  const disableModelInvocation = resolveBooleanField(
    frontmatter,
    'disable-model-invocation',
    problems,
  );
  const userInvocable = resolveBooleanField(frontmatter, 'user-invocable', problems);

  return {
    policy: {
      modelInvocable: disableModelInvocation !== true,
      userInvocable: userInvocable !== false,
    },
    problems,
  };
}

function resolveBooleanField(
  frontmatter: Record<string, unknown>,
  key: string,
  problems: DshInvocationProblem[],
): boolean | undefined {
  if (!Object.hasOwn(frontmatter, key)) {
    return undefined;
  }

  const parsed = parseDshFrontmatterBoolean(frontmatter[key]);
  if (parsed === undefined) {
    problems.push({
      key,
      kind: 'value',
      message: `frontmatter field "${key}" must be a boolean`,
    });
  }
  return parsed;
}
