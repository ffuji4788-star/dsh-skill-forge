/**
 * Public library entry point of `dsh-skill-forge`.
 *
 * Phase 3 exposes local skill reading, analysis, deterministic structural
 * validation and compatibility checking against a pinned DeepSeek Harness
 * contract. Conversion, remote import, license analysis and model providers are
 * not implemented and are not exported.
 */
export {
  analyzeBasicSkill,
  isKebabCase,
  type SkillAnalysis,
  type SkillCheck,
} from './analyzers/basic-skill-analyzer.js';
export {
  renderAnalysis,
  runAnalyze,
  type RenderAnalysisOptions,
  type RunAnalyzeOptions,
} from './cli/analyze-command.js';
export {
  renderCompatibility,
  runCompat,
  type RenderCompatibilityOptions,
  type RunCompatOptions,
} from './cli/compat-command.js';
export { createProgram, stripOptionTerminator } from './cli/program.js';
export { runCli, type RunOptions } from './cli/run.js';
export {
  renderValidation,
  runValidate,
  type RenderValidationOptions,
  type RunValidateOptions,
} from './cli/validate-command.js';
export {
  SKILL_ENTRY_FILENAME,
  findEntryFile,
  loadLocalSkill,
  readLocalSkill,
  readSkillFile,
  resolveInputPath,
  type SourcePackage,
  type SourceType,
} from './importers/local-importer.js';
export {
  parseFrontmatter,
  type FrontmatterResult,
  type SkillFrontmatter,
} from './parsers/frontmatter-parser.js';
export { buildParsedSkill, type ParsedSkill, type ParsedSkillInput } from './schemas/skill.js';
export type {
  CompatibilityIssue,
  CompatibilityResult,
  CompatibilitySeverity,
  CompatibilityStatus,
} from './schemas/compatibility.js';
export type {
  ValidationIssue,
  ValidationResult,
  ValidationSeverity,
} from './schemas/validation.js';
export {
  AmbiguousSkillError,
  ForgeError,
  FrontmatterError,
  SkillInputError,
} from './utils/errors.js';
export { EXIT_FATAL, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from './utils/exit-codes.js';
export {
  PACKAGE_JSON_FILENAME,
  describeNodeRequirement,
  findPackageJson,
  parsePackageInfo,
  readPackageInfo,
  resetPackageInfoCache,
  type PackageInfo,
} from './utils/package-info.js';
export {
  KEBAB_CASE_EXPLANATION,
  findSkillNameProblem,
  formatSkillNameProblem,
} from './utils/skill-name.js';
export {
  KNOWN_FRONTMATTER_KEYS,
  VALIDATION_CODES,
  validateBasicSkill,
} from './validators/basic-skill-validator.js';
export {
  DSH_CONTRACT_SOURCES,
  DSH_CONTRACT_VERIFIED_AT,
  DSH_DISCOVERY_SHAPES,
  DSH_KNOWN_FRONTMATTER_KEYS,
  DSH_SKILL_NAME_PATTERN,
  DSH_TARGET_ID,
  DSH_TARGET_NAME,
  DSH_UPSTREAM_COMMIT,
  DSH_UPSTREAM_REPOSITORY,
  dshUpstreamShortCommit,
} from './targets/dsh/dsh-contract.js';
export {
  DSH_COMPATIBILITY_CODES,
  validateDshCompatibility,
} from './targets/dsh/dsh-compatibility-validator.js';
export {
  defaultDshInvocationPolicy,
  parseDshFrontmatterBoolean,
  resolveDshInvocationPolicy,
  type DshInvocationPolicy,
  type DshInvocationProblem,
} from './targets/dsh/dsh-invocation-policy.js';
