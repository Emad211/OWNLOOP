import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredString } from "../row-mapping.js";

export type AgentConversation = Readonly<{
  conversationId: string;
  workspaceId: string;
  source: string;
  sourceSessionId: string;
  startMode: string | null;
  startedAt: string;
  lastObservedAt: string;
  endedAt: string | null;
  status: string;
}>;

export type NewAgentConversation = AgentConversation;

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
      .prepare(
        `SELECT
           conversation_id,
           workspace_id,
           source,
           source_session_id,
           start_mode,
           started_at,
           last_observed_at,
           ended_at,
           status
         FROM agent_conversations
         WHERE conversation_id = ?`,
      )
      .get(conversationId);

    if (row === undefined) {
      return null;
    }

    return {
      conversationId: requiredString(row, "conversation_id"),
      workspaceId: requiredString(row, "workspace_id"),
      source: requiredString(row, "source"),
      sourceSessionId: requiredString(row, "source_session_id"),
      startMode: nullableString(row, "start_mode"),
      startedAt: requiredString(row, "started_at"),
      lastObservedAt: requiredString(row, "last_observed_at"),
      endedAt: nullableString(row, "ended_at"),
      status: requiredString(row, "status"),
    };
  }
}
