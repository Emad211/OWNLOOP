from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


# A partial hooks.json installation is distinct and always requires repair.
replace_exact(
    "packages/contracts/src/codex-capability.ts",
    '''export const CODEX_CONFIGURATION_STATES = [
  "missing",
  "exact",''',
    '''export const CODEX_CONFIGURATION_STATES = [
  "missing",
  "partial",
  "exact",''',
)
replace_exact(
    "packages/contracts/src/codex-capability.ts",
    '''  if (facts.configurationState === "ambiguous" || facts.configurationState === "invalid") {
    return "repair_needed";
  }''',
    '''  if (
    facts.configurationState === "partial" ||
    facts.configurationState === "ambiguous" ||
    facts.configurationState === "invalid"
  ) {
    return "repair_needed";
  }''',
)
replace_exact(
    "packages/contracts/tests/codex-capability.test.ts",
    '''    [facts({ configurationState: "ambiguous" }), "repair_needed"],''',
    '''    [facts({ configurationState: "partial" }), "repair_needed"],
    [facts({ configurationState: "ambiguous" }), "repair_needed"],''',
)

# Wire the bounded observation repository into the persistence composition root.
persistence = "apps/daemon/src/persistence/index.ts"
replace_exact(
    persistence,
    'import { CandidateValidationRepository } from "./repositories/candidate-validations.js";\n',
    'import { CandidateValidationRepository } from "./repositories/candidate-validations.js";\n'
    'import { CodexCapabilityRepository } from "./repositories/codex-capability.js";\n',
)
replace_exact(
    persistence,
    '''  ingressReceipts: IngressReceiptRepository;
  lifecycleResolutions: LifecycleResolutionRepository;''',
    '''  ingressReceipts: IngressReceiptRepository;
  codexCapabilities: CodexCapabilityRepository;
  lifecycleResolutions: LifecycleResolutionRepository;''',
)
replace_exact(
    persistence,
    '''    ingressReceipts: new IngressReceiptRepository(database),
    lifecycleResolutions: new LifecycleResolutionRepository(database),''',
    '''    ingressReceipts: new IngressReceiptRepository(database),
    codexCapabilities: new CodexCapabilityRepository(database),
    lifecycleResolutions: new LifecycleResolutionRepository(database),''',
)
replace_exact(
    persistence,
    'export { CandidateGenerationRepository } from "./repositories/candidate-generations.js";\n',
    'export { CandidateGenerationRepository } from "./repositories/candidate-generations.js";\n'
    'export type { CodexCapabilityObservationFacts } from "./repositories/codex-capability.js";\n'
    'export { CodexCapabilityRepository } from "./repositories/codex-capability.js";\n',
)

# Use the accepted contract bound rather than a duplicated numeric constant.
repository = "apps/daemon/src/persistence/repositories/codex-capability.ts"
replace_exact(
    repository,
    '''  CodexAdapterIngressSchema,
  CodexSourceSurfaceSchema,''',
    '''  CODEX_SOURCE_SURFACES,
  CodexAdapterIngressSchema,
  CodexSourceSurfaceSchema,''',
)
replace_exact(repository, ".all(7);", ".all(CODEX_SOURCE_SURFACES.length + 1);")
replace_exact(
    repository,
    "    if (surfaceRows.length > 6) {",
    "    if (surfaceRows.length > CODEX_SOURCE_SURFACES.length) {",
)

# Make the service available to runtime composition and diagnostics without creating an endpoint yet.
replace_exact(
    "apps/daemon/src/index.ts",
    'export * from "./candidate-generation/index.js";\n',
    'export * from "./candidate-generation/index.js";\nexport * from "./codex-capability/index.js";\n',
)
