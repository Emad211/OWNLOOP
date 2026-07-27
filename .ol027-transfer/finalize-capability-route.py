from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


server = "apps/daemon/src/ingress/server.ts"
replace_exact(
    server,
    'import type { LocalArtifactStore } from "../artifact-store/index.js";\n',
    'import type { LocalArtifactStore } from "../artifact-store/index.js";\n'
    'import {\n'
    '  type CodexCapabilityEnvironmentFacts,\n'
    '  registerCodexCapabilityRoute,\n'
    '} from "../codex-capability/index.js";\n',
)
replace_exact(
    server,
    '''  customSecretFieldPatterns?: () => readonly string[];
  settings?: LocalSettingsService;''',
    '''  customSecretFieldPatterns?: () => readonly string[];
  codexCapabilityEnvironment?: () => CodexCapabilityEnvironmentFacts;
  settings?: LocalSettingsService;''',
)
replace_exact(
    server,
    '''  if (dependencies.replay !== undefined) {
    registerReplayRoutes(server, {
      persistence: dependencies.replay.persistence,
      artifactStore: dependencies.replay.artifactStore,
      tokenVerifier,
      clock,
    });
  }''',
    '''  if (dependencies.replay !== undefined) {
    registerCodexCapabilityRoute(server, {
      persistence: dependencies.replay.persistence,
      tokenVerifier,
      ...(dependencies.codexCapabilityEnvironment === undefined
        ? {}
        : { environment: dependencies.codexCapabilityEnvironment }),
    });
    registerReplayRoutes(server, {
      persistence: dependencies.replay.persistence,
      artifactStore: dependencies.replay.artifactStore,
      tokenVerifier,
      clock,
    });
  }''',
)
