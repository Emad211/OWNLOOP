import type {
  ChangeClassificationEvidenceKind,
  ChangeClassificationLabel,
} from "@ownloop/contracts";

export type ParsedClassificationPath = Readonly<{
  value: string;
  lower: string;
  segments: readonly string[];
  basename: string;
  extension: string | null;
}>;

export type ChangeClassificationRule = Readonly<{
  ruleId: string;
  precedence: number;
  label: Exclude<ChangeClassificationLabel, "unknown">;
  confidenceBasisPoints: number;
  evidenceKind: Exclude<ChangeClassificationEvidenceKind, "fallback">;
  matches(path: ParsedClassificationPath): boolean;
}>;

type ChangeClassificationRuleDefinition = Omit<ChangeClassificationRule, "precedence">;

const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);
const UI_EXTENSIONS = new Set(["tsx", "jsx", "css", "scss", "sass", "less", "styl"]);
const DOCUMENTATION_EXTENSIONS = new Set(["md", "mdx", "rst", "adoc"]);
const TEST_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "e2e",
  "integration",
  "fixtures",
]);
const SOURCE_SEGMENTS = new Set([
  "src",
  "app",
  "lib",
  "server",
  "services",
  "service",
  "domain",
  "usecases",
  "use-cases",
  "handlers",
  "workers",
]);

function hasSegment(path: ParsedClassificationPath, values: ReadonlySet<string>): boolean {
  return path.segments.some((segment) => values.has(segment));
}

function exactBasename(...values: readonly string[]) {
  const accepted = new Set(values);
  return (path: ParsedClassificationPath): boolean => accepted.has(path.basename);
}

function extensionIn(values: ReadonlySet<string>) {
  return (path: ParsedClassificationPath): boolean =>
    path.extension !== null && values.has(path.extension);
}

function segmentIn(...values: readonly string[]) {
  const accepted = new Set(values);
  return (path: ParsedClassificationPath): boolean => hasSegment(path, accepted);
}

function testPath(path: ParsedClassificationPath): boolean {
  return (
    hasSegment(path, TEST_SEGMENTS) ||
    /(?:^|\.)(?:test|spec|e2e)\.(?:[cm]?[jt]sx?)$/u.test(path.basename) ||
    /(?:^|_)(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(path.basename)
  );
}

function configurationFilename(path: ParsedClassificationPath): boolean {
  return (
    /^(?:tsconfig|jsconfig)(?:\.[a-z0-9_-]+)?\.json$/u.test(path.basename) ||
    /^(?:vite|vitest|eslint|prettier|biome|webpack|rollup|babel|jest|playwright|cypress|turbo|nx)\.config\./u.test(
      path.basename,
    ) ||
    /^\.?(?:eslint|prettier|npm|yarn|pnpm)rc(?:\..+)?$/u.test(path.basename) ||
    /^\.?(?:env)(?:\..+)?(?:\.example|\.sample|\.template)?$/u.test(path.basename)
  );
}

const CHANGE_CLASSIFICATION_RULE_DEFINITIONS: readonly ChangeClassificationRuleDefinition[] = [
  {
    ruleId: "authentication.path_segment",
    label: "authentication_authorization",
    confidenceBasisPoints: 8500,
    evidenceKind: "path_segment",
    matches: segmentIn(
      "auth",
      "authentication",
      "authorization",
      "authorisation",
      "oauth",
      "oidc",
      "rbac",
      "acl",
      "permission",
      "permissions",
      "session",
      "sessions",
      "identity",
      "access-control",
    ),
  },
  {
    ruleId: "authentication.filename_prefix",
    label: "authentication_authorization",
    confidenceBasisPoints: 7500,
    evidenceKind: "path_pattern",
    matches: (path) => /^(?:auth|session|permission|rbac|oauth|oidc)[._-]/u.test(path.basename),
  },
  {
    ruleId: "behavior.source_code",
    label: "behavior",
    confidenceBasisPoints: 6500,
    evidenceKind: "path_pattern",
    matches: (path) =>
      path.extension !== null &&
      CODE_EXTENSIONS.has(path.extension) &&
      !path.basename.endsWith(".d.ts") &&
      hasSegment(path, SOURCE_SEGMENTS) &&
      !testPath(path) &&
      !configurationFilename(path) &&
      !hasSegment(path, new Set(["migrations", "migration"])),
  },
  {
    ruleId: "configuration.ci_workflow",
    label: "configuration_infrastructure",
    confidenceBasisPoints: 9800,
    evidenceKind: "path_pattern",
    matches: (path) => path.lower.startsWith(".github/workflows/"),
  },
  {
    ruleId: "configuration.exact_filename",
    label: "configuration_infrastructure",
    confidenceBasisPoints: 9500,
    evidenceKind: "exact_filename",
    matches: exactBasename(
      "dockerfile",
      "compose.yml",
      "compose.yaml",
      "docker-compose.yml",
      "docker-compose.yaml",
      "biome.json",
      "biome.jsonc",
      "turbo.json",
      "nx.json",
      "vercel.json",
      "netlify.toml",
      "fly.toml",
      "wrangler.toml",
    ),
  },
  {
    ruleId: "configuration.filename_pattern",
    label: "configuration_infrastructure",
    confidenceBasisPoints: 9000,
    evidenceKind: "path_pattern",
    matches: configurationFilename,
  },
  {
    ruleId: "configuration.infrastructure_segment",
    label: "configuration_infrastructure",
    confidenceBasisPoints: 8500,
    evidenceKind: "path_segment",
    matches: segmentIn(
      ".github",
      "infrastructure",
      "infra",
      "terraform",
      "kubernetes",
      "k8s",
      "helm",
      "deploy",
      "deployment",
      "ci",
    ),
  },
  {
    ruleId: "database.extension",
    label: "database_migration",
    confidenceBasisPoints: 9500,
    evidenceKind: "extension",
    matches: extensionIn(new Set(["sql", "prisma"])),
  },
  {
    ruleId: "database.path_segment",
    label: "database_migration",
    confidenceBasisPoints: 8500,
    evidenceKind: "path_segment",
    matches: segmentIn(
      "database",
      "databases",
      "db",
      "migration",
      "migrations",
      "prisma",
      "drizzle",
    ),
  },
  {
    ruleId: "database.migration_filename",
    label: "database_migration",
    confidenceBasisPoints: 9000,
    evidenceKind: "path_pattern",
    matches: (path) => /(?:^|[._-])migration(?:s)?[._-]/u.test(path.basename),
  },
  {
    ruleId: "dependency.package_manifest",
    label: "dependency",
    confidenceBasisPoints: 10_000,
    evidenceKind: "exact_filename",
    matches: exactBasename(
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
      "deno.json",
      "deno.jsonc",
      "deno.lock",
    ),
  },
  {
    ruleId: "documentation.extension",
    label: "documentation",
    confidenceBasisPoints: 9500,
    evidenceKind: "extension",
    matches: extensionIn(DOCUMENTATION_EXTENSIONS),
  },
  {
    ruleId: "documentation.exact_filename",
    label: "documentation",
    confidenceBasisPoints: 9800,
    evidenceKind: "exact_filename",
    matches: (path) =>
      /^(?:readme|changelog|contributing|code_of_conduct|security|license)(?:\.[a-z0-9_-]+)?$/u.test(
        path.basename,
      ),
  },
  {
    ruleId: "documentation.path_segment",
    label: "documentation",
    confidenceBasisPoints: 8500,
    evidenceKind: "path_segment",
    matches: segmentIn("docs", "doc", "documentation"),
  },
  {
    ruleId: "public_api.exact_definition",
    label: "public_api",
    confidenceBasisPoints: 9500,
    evidenceKind: "path_pattern",
    matches: (path) => /^(?:openapi|swagger)(?:\.|$)/u.test(path.basename),
  },
  {
    ruleId: "public_api.filename_prefix",
    label: "public_api",
    confidenceBasisPoints: 7000,
    evidenceKind: "path_pattern",
    matches: (path) =>
      /^(?:api|route|routes|router|controller|endpoint|graphql|rpc)[._-]/u.test(path.basename),
  },
  {
    ruleId: "public_api.path_segment",
    label: "public_api",
    confidenceBasisPoints: 7500,
    evidenceKind: "path_segment",
    matches: segmentIn(
      "api",
      "apis",
      "route",
      "routes",
      "router",
      "routers",
      "controller",
      "controllers",
      "endpoint",
      "endpoints",
      "contracts",
      "graphql",
      "rpc",
      "openapi",
      "swagger",
    ),
  },
  {
    ruleId: "tests.path_or_suffix",
    label: "tests",
    confidenceBasisPoints: 9500,
    evidenceKind: "path_pattern",
    matches: testPath,
  },
  {
    ruleId: "ui.component_path",
    label: "ui",
    confidenceBasisPoints: 8500,
    evidenceKind: "path_segment",
    matches: segmentIn(
      "ui",
      "component",
      "components",
      "page",
      "pages",
      "view",
      "views",
      "screen",
      "screens",
      "styles",
      "theme",
    ),
  },
  {
    ruleId: "ui.frontend_extension",
    label: "ui",
    confidenceBasisPoints: 8500,
    evidenceKind: "extension",
    matches: extensionIn(UI_EXTENSIONS),
  },
];

const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const ruleIds = new Set<string>();
for (const rule of CHANGE_CLASSIFICATION_RULE_DEFINITIONS) {
  if (
    !RULE_ID_PATTERN.test(rule.ruleId) ||
    ruleIds.has(rule.ruleId) ||
    !Number.isInteger(rule.confidenceBasisPoints) ||
    rule.confidenceBasisPoints < 1 ||
    rule.confidenceBasisPoints > 10_000
  ) {
    throw new Error("The deterministic change-classification rule set is invalid.");
  }
  ruleIds.add(rule.ruleId);
}

export const CHANGE_CLASSIFICATION_RULES: readonly ChangeClassificationRule[] = Object.freeze(
  CHANGE_CLASSIFICATION_RULE_DEFINITIONS.map((rule, precedence) =>
    Object.freeze({ ...rule, precedence }),
  ),
);
