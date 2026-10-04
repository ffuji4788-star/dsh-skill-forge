/**
 * Public library entry point of `dsh-skill-forge`.
 *
 * Phase 4 exposes local skill reading, analysis, deterministic structural
 * validation, compatibility checking against a pinned DeepSeek Harness contract,
 * and canonical Universal Skill IR normalization. Conversion, source or target
 * adapters, remote import, license analysis and model providers are not
 * implemented and are not exported.
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
export { runNormalize, type RunNormalizeOptions } from './cli/normalize-command.js';
export { runConvert, type RunConvertOptions } from './cli/convert-command.js';
export {
  convertSkillToTarget,
  renderConversionReport,
  SUPPORTED_TARGET,
  targetContractReference,
  verifyGeneratedPackage,
  type ConvertOptions,
  type ConvertOutcome,
} from './conversion/convert-skill.js';
export {
  collectResources,
  findUnportableSegmentProblem,
  type ResourceCollection,
  type ResourceNode,
} from './conversion/resource-collector.js';
export {
  buildConversionResult,
  CONVERSION_CODES,
  type ConversionIssue,
  type ConversionResult,
  type ConversionSeverity,
} from './schemas/conversion.js';
export {
  DSH_ENTRY_FILENAME,
  renderDshFrontmatter,
  renderDshSkillMarkdown,
  type RenderedEntry,
} from './targets/dsh/dsh-target-adapter.js';
export { isAtOrBelow, isPathWithin } from './utils/path-boundary.js';
export {
  PORTABLE_SEMANTIC_FIELDS,
  toSerializedSemantics,
  validatePortableSemantics,
  type PortableSemantics,
  type SemanticsProblem,
  type SerializedSemantics,
} from './ir/portable-semantics.js';
export {
  AGENT_SKILLS_FORMAT,
  GENERIC_LOCAL_SKILL_FORMAT as GENERIC_LOCAL_FORMAT_V2,
  KNOWN_V2_SOURCE_FORMATS,
  SKILL_IR_V2_SCHEMA_VERSION,
  validateSkillIRV2,
  type SkillIRV2,
  type SkillIRV2Source,
} from './ir/skill-ir-v2.js';
export { GENERIC_PROVENANCE, toSkillIRV2, type SourceProvenance } from './ir/normalize-skill-v2.js';
export { serializeSkillIRV2 } from './ir/serialize-skill-ir-v2.js';
export {
  DEFAULT_IR_VERSION,
  SUPPORTED_IR_VERSIONS,
  type RunNormalizeOptions as RunNormalizeOptionsV2,
} from './cli/normalize-command.js';
export {
  renderDshEntry,
  renderDshSkillMarkdownV2,
  toDshEmitExtras,
  unsupportedDshSemantics,
  type DshEmitExtras,
} from './targets/dsh/dsh-target-adapter.js';
export {
  AGENT_SKILLS_ALLOWED_FIELDS,
  AGENT_SKILLS_CONTRACT_SOURCES,
  AGENT_SKILLS_ENTRY_NAMES,
  AGENT_SKILLS_MAX_COMPATIBILITY_LENGTH,
  AGENT_SKILLS_MAX_DESCRIPTION_LENGTH,
  AGENT_SKILLS_MAX_NAME_LENGTH,
  AGENT_SKILLS_SOURCE_ID,
  AGENT_SKILLS_SOURCE_NAME,
  AGENT_SKILLS_UPSTREAM_COMMIT,
  AGENT_SKILLS_UPSTREAM_REPOSITORY,
  ANTHROPIC_SKILLS_COMMIT,
  ANTHROPIC_SKILLS_REPOSITORY,
  ANTHROPIC_SKILLS_SOURCES,
  agentSkillsUpstreamReference,
} from './sources/agent-skills/agent-skills-contract.js';
export {
  AGENT_SKILLS_CODES,
  validateAgentSkillFrontmatter,
  type AgentSkillIssue,
  type AgentSkillSeverity,
  type AgentSkillValidationResult,
} from './sources/agent-skills/agent-skills-validator.js';
export {
  AGENT_SKILLS_PACKAGE_CODES,
  findAgentSkillEntry,
  liftAgentSkillSemantics,
  loadAgentSkill,
} from './sources/agent-skills/agent-skills-source-adapter.js';
export {
  AVAILABLE_SOURCE_IDS,
  GENERIC_LOCAL_SOURCE_ID,
  isKnownSourceId,
  loadSourceSkill,
  SOURCE_CODES,
  type SourceFailure,
  type SourceIssue,
  type SourceIssueSeverity,
  type SourceLoadResult,
  type SourceSuccess,
} from './conversion/source-adapter.js';
export {
  comparePaths,
  enumerateResources,
  MARKDOWN_EXTENSIONS,
  readSkillFile,
  SKIPPED_DIRECTORY_NAMES,
  statOrThrow,
  toRelativePosixPath,
} from './importers/skill-files.js';
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
  resolveInputPath,
  type SourcePackage,
  type SourceType,
} from './importers/local-importer.js';
export { isJsonSafe, toCanonicalJson, type JsonObject, type JsonValue } from './ir/json-value.js';
export {
  normalizeEntryFile,
  normalizeSkill,
  SkillIRError,
  SkillNotNormalizableError,
  toLf,
  toSkillIR,
  type NormalizeResult,
} from './ir/normalize-skill.js';
export { serializeSkillIR } from './ir/serialize-skill-ir.js';
export {
  GENERIC_LOCAL_SKILL_FORMAT,
  isSkillIR,
  KNOWN_SOURCE_FORMATS,
  SKILL_IR_SCHEMA_VERSION,
  validateSkillIR,
  type SkillIR,
  type SkillIRSource,
} from './ir/skill-ir.js';
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
