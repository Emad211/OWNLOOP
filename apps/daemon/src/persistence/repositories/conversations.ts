import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredString, type SqliteRow } from "../row-mapping.js";

export const AGENT_CONVERSATION_STATUSES = ["Active", "Ended"] as const;
export type AgentConversationStatus = (typeof AGENT_CONVERSATION_STATUSES)[number];

export type AgentConversation = Readonly<{
  conversationId: string;
  workspaceId: string;
  source: string;
  sourceSessionId: string;
  startMode: string | null;
  startedAt: string;
  lastObservedAt: string;
  endedAt: string | null;
  status: AgentConversationStatus;
}>;

export type NewAgentConversation = AgentConversation;

function mapConversation(row: SqliteRow): AgentConversation {
  return {
    conversationId: requiredString(row, "conversation_id"),
    workspaceId: requiredString(row, "workspace_id"),
    source: requiredString(row, "source"),
    sourceSessionId: requiredString(row, "source_session_id"),
    startMode: nullableString(row, "start_mode"),
    startedAt: requiredString(row, "started_at"),
    lastObservedAt: requiredString(row, "last_observed_at"),
    endedAt: nullableString(row, "ended_at"),
    status: requiredString(row, "status") as AgentConversationStatus,
  };
}

const CONVERSATION_SELECT = `SELECT
  conversation_id,
  workspace_id,
  source,
  source_session_id,
  start_mode,
  started_at,
  last_observed_at,
  ended_at,
  status
FROM agent_conversations`;

export class AgentConversationRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(conversation: NewAgentConversation): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO agent_conversations (
             conversation_id,
             workspace_id,
             source,
             source_session_id,
             start_mode,
             started_at,
             last_observed_at,
             ended_at,
             status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          conversation.conversationId,
          conversation.workspaceId,
          conversation.source,
          conversation.sourceSessionId,
          conversation.startMode,
          conversation.startedAt,
          conversation.lastObservedAt,
          conversation.endedAt,
          conversation.status,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert agent conversation");
    }
  }

  get(conversationId: string): AgentConversation | null {
    const row = this.#database
      .prepare(`${CONVERSATION_SELECT} WHERE conversation_id = ?`)
      .get(conversationId);
    return row === undefined ? null : mapConversation(row);
  }

  getBySourceSession(source: string, sourceSessionId: string): AgentConversation | null {
    const row = this.#database
      .prepare(`${CONVERSATION_SELECT} WHERE source = ? AND source_session_id = ?`)
      .get(source, sourceSessionId);
    return row === undefined ? null : mapConversation(row);
  }

  touch(conversationId: string, observedAt: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE agent_conversations
           SET last_observed_at = CASE
             WHEN last_observed_at < ? THEN ?
             ELSE last_observed_at
           END
           WHERE conversation_id = ?`,
        )
        .run(observedAt, observedAt, conversationId).changes === 1
    );
  }

  reactivate(conversationId: string, startMode: string, observedAt: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE agent_conversations
           SET start_mode = ?,
               last_observed_at = CASE
                 WHEN last_observed_at < ? THEN ?
                 ELSE last_observed_at
               END,
               ended_at = NULL,
               status = 'Active'
           WHERE conversation_id = ?`,
        )
        .run(startMode, observedAt, observedAt, conversationId).changes === 1
    );
  }

  end(conversationId: string, endedAt: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE agent_conversations
           SET last_observed_at = CASE
                 WHEN last_observed_at < ? THEN ?
                 ELSE last_observed_at
               END,
               ended_at = CASE
                 WHEN ended_at IS NULL OR ended_at < ? THEN ?
                 ELSE ended_at
               END,
               status = 'Ended'
           WHERE conversation_id = ?`,
        )
        .run(endedAt, endedAt, endedAt, endedAt, conversationId).changes === 1
    );
  }
}
