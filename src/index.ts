/**
 * Public library entry point of `dsh-skill-forge`.
 *
 * Phase 1 exposes local skill reading and basic analysis. DSH compatibility
 * validation, conversion, remote import, license analysis and model providers
 * are not implemented and are therefore not exported.
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
export { createProgram, stripOptionTerminator } from './cli/program.js';
export { runCli, type RunOptions } from './cli/run.js';
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
export {
  AmbiguousSkillError,
  ForgeError,
  FrontmatterError,
  SkillInputError,
} from './utils/errors.js';
export {
  PACKAGE_JSON_FILENAME,
  describeNodeRequirement,
  findPackageJson,
  parsePackageInfo,
  readPackageInfo,
  resetPackageInfoCache,
  type PackageInfo,
} from './utils/package-info.js';
