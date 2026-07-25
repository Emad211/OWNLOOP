import { DatabaseSync } from "node:sqlite";

import {
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SCHEMA_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
} from "@ownloop/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { CandidateValidationRepository } from "./candidate-validations.js";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function database(): DatabaseSync {
  const value = new DatabaseSync(":memory:");
  databases.push(value);
  value.exec(`
    CREATE TABLE candidate_generations (
      generation_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE candidate_validations (
      validation_id TEXT,
      validation_key TEXT,
      run_id TEXT,
      finalization_id TEXT,
      generation_id TEXT,
      source_candidate_artifact_id TEXT,
      evidence_graph_artifact_id TEXT,
      report_artifact_id TEXT,
      outcome TEXT,
      selected_count INTEGER,
      created_at TEXT,
      record_json TEXT NOT NULL
    );
  `);
  return value;
}

function versions(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    schemaVersion: CANDIDATE_VALIDATION_SCHEMA_VERSION,
    validatorVersion: CANDIDATE_VALIDATOR_VERSION,
    supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
    contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
    absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
    duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
    rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
    selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
    ...overrides,
  });
}

describe("CandidateValidationRepository", () => {
  it("treats only a current-policy validation as satisfying batch eligibility", () => {
    const db = database();
    const repository = new CandidateValidationRepository(db);
    const insertGeneration = db.prepare(
      "INSERT INTO candidate_generations (generation_id, status, completed_at) VALUES (?, 'succeeded', ?)",
    );
    insertGeneration.run("generation-stale", "2026-07-24T00:00:00.000Z");
    insertGeneration.run("generation-current", "2026-07-24T00:01:00.000Z");
    insertGeneration.run("generation-new", "2026-07-24T00:02:00.000Z");
    const insertValidation = db.prepare(
      "INSERT INTO candidate_validations (generation_id, record_json) VALUES (?, ?)",
    );
    insertValidation.run(
      "generation-stale",
      versions({ rankingPolicyVersion: "ownloop-candidate-ranking-v0" }),
    );
    insertValidation.run("generation-current", versions());

    expect(repository.listUnvalidatedGenerationIds(25)).toEqual([
      "generation-stale",
      "generation-new",
    ]);
    expect(repository.listUnvalidatedGenerationIds(1)).toEqual(["generation-stale"]);
  });
});
