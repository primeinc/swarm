/**
 * TypeScript types for Swarm Mail SSE events
 * 
 * These types mirror the Zod schemas from swarm-mail/src/streams/events.ts
 * but are simplified for frontend consumption.
 */

// ============================================================================
// Base Event
// ============================================================================

export interface BaseEvent {
  id?: number;
  type: string;
  project_key: string;
  timestamp: number;
  sequence?: number;
}

// ============================================================================
// Agent Events
// ============================================================================

export interface AgentRegisteredEvent extends BaseEvent {
  type: "agent_registered";
  agent_name: string;
  program?: string;
  model?: string;
  task_description?: string;
}

export interface AgentActiveEvent extends BaseEvent {
  type: "agent_active";
  agent_name: string;
}

// ============================================================================
// Message Events
// ============================================================================

export interface MessageSentEvent extends BaseEvent {
  type: "message_sent";
  message_id?: number;
  from_agent: string;
  to_agents: string[];
  subject: string;
  body: string;
  thread_id?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ack_required?: boolean;
}

export interface MessageReadEvent extends BaseEvent {
  type: "message_read";
  message_id: number;
  agent_name: string;
}

export interface MessageAckedEvent extends BaseEvent {
  type: "message_acked";
  message_id: number;
  agent_name: string;
}

// ============================================================================
// File Reservation Events
// ============================================================================

export interface FileReservedEvent extends BaseEvent {
  type: "file_reserved";
  reservation_id?: number;
  agent_name: string;
  paths: string[];
  reason?: string;
  exclusive?: boolean;
  ttl_seconds?: number;
  expires_at: number;
  lock_holder_ids?: string[];
}

export interface FileReleasedEvent extends BaseEvent {
  type: "file_released";
  agent_name: string;
  paths?: string[];
  reservation_ids?: number[];
  lock_holder_ids?: string[];
}

// ============================================================================
// Task Events
// ============================================================================

export interface TaskStartedEvent extends BaseEvent {
  type: "task_started";
  agent_name: string;
  cell_id: string;
  epic_id?: string;
}

export interface TaskProgressEvent extends BaseEvent {
  type: "task_progress";
  agent_name: string;
  cell_id: string;
  progress_percent?: number;
  message?: string;
  files_touched?: string[];
}

export interface TaskCompletedEvent extends BaseEvent {
  type: "task_completed";
  agent_name: string;
  cell_id: string;
  summary: string;
  files_touched?: string[];
  success?: boolean;
}

export interface TaskBlockedEvent extends BaseEvent {
  type: "task_blocked";
  agent_name: string;
  cell_id: string;
  reason: string;
}

// ============================================================================
// Eval Capture Events
// ============================================================================

export interface DecompositionGeneratedEvent extends BaseEvent {
  type: "decomposition_generated";
  epic_id: string;
  task: string;
  context?: string;
  strategy: "file-based" | "feature-based" | "risk-based";
  epic_title: string;
  subtasks: Array<{
    title: string;
    files: string[];
    priority?: number;
  }>;
  recovery_context?: {
    shared_context?: string;
    skills_to_load?: string[];
    coordinator_notes?: string;
  };
}

export interface SubtaskOutcomeEvent extends BaseEvent {
  type: "subtask_outcome";
  epic_id: string;
  cell_id: string;
  planned_files: string[];
  actual_files: string[];
  duration_ms: number;
  error_count?: number;
  retry_count?: number;
  success: boolean;
  scope_violation?: boolean;
  violation_files?: string[];
}

export interface HumanFeedbackEvent extends BaseEvent {
  type: "human_feedback";
  epic_id: string;
  accepted: boolean;
  modified?: boolean;
  notes?: string;
}

// ============================================================================
// Cell Events
// ============================================================================

export interface CellCreatedEvent extends BaseEvent {
  type: "cell_created";
  cell_id: string;
  title: string;
  description?: string | null;
  issue_type?: string;
  priority?: number;
  parent_id?: string | null;
  created_by?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CellUpdatedEvent extends BaseEvent {
  type: "cell_updated";
  cell_id: string;
  title?: string;
  description?: string | null;
  priority?: number;
  status?: string;
}

export interface CellStatusChangedEvent extends BaseEvent {
  type: "cell_status_changed";
  cell_id: string;
  from_status: string;
  to_status: string;
}

export interface CellClosedEvent extends BaseEvent {
  type: "cell_closed";
  cell_id: string;
  reason?: string;
}

// ============================================================================
// Epic Events
// ============================================================================

export interface EpicCreatedEvent extends BaseEvent {
  type: "epic_created";
  epic_id: string;
  title: string;
  description?: string;
  subtask_count: number;
  subtask_ids: string[];
  created_by?: string;
}

export interface HiveSyncedEvent extends BaseEvent {
  type: "hive_synced";
  cells_synced: number;
  push_success: boolean;
  sync_duration_ms?: number;
}

// ============================================================================
// Memory Events
// ============================================================================

export interface MemoryStoredEvent extends BaseEvent {
  type: "memory_stored";
  memory_id: string;
  content_preview: string;
  tags: string[];
  auto_tagged?: boolean;
  collection?: string;
  embedding_model?: string;
}

export interface MemoryFoundEvent extends BaseEvent {
  type: "memory_found";
  query: string;
  result_count: number;
  top_score?: number;
  search_duration_ms?: number;
  used_fts?: boolean;
}

export interface MemoryUpdatedEvent extends BaseEvent {
  type: "memory_updated";
  memory_id: string;
  operation: "ADD" | "UPDATE" | "DELETE" | "NOOP";
  reason?: string;
  supersedes_id?: string;
}

export interface MemoryValidatedEvent extends BaseEvent {
  type: "memory_validated";
  memory_id: string;
  decay_reset: boolean;
}

export interface MemoryDeletedEvent extends BaseEvent {
  type: "memory_deleted";
  memory_id: string;
  reason?: string;
}

// ============================================================================
// CASS Events
// ============================================================================

export interface CassSearchedEvent extends BaseEvent {
  type: "cass_searched";
  query: string;
  agent_filter?: string;
  days_filter?: number;
  result_count: number;
  search_duration_ms?: number;
}

export interface CassViewedEvent extends BaseEvent {
  type: "cass_viewed";
  session_path: string;
  line_number?: number;
  agent_type?: string;
}

export interface CassIndexedEvent extends BaseEvent {
  type: "cass_indexed";
  sessions_indexed: number;
  messages_indexed: number;
  duration_ms?: number;
  full_rebuild?: boolean;
}

// ============================================================================
// Skills Events
// ============================================================================

export interface SkillLoadedEvent extends BaseEvent {
  type: "skill_loaded";
  skill_name: string;
  skill_source: "global" | "project" | "bundled";
  context_provided?: boolean;
  content_length?: number;
}

export interface SkillCreatedEvent extends BaseEvent {
  type: "skill_created";
  skill_name: string;
  skill_scope: "global" | "project";
  description?: string;
}

// ============================================================================
// Decision Trace Events
// ============================================================================

export interface DecisionRecordedEvent extends BaseEvent {
  type: "decision_recorded";
  decision_id: string;
  decision_type: string;
  epic_id?: string;
  cell_id?: string;
  rationale_length?: number;
  precedent_count?: number;
}

// ============================================================================
// Compaction Events
// ============================================================================

export interface CompactionTriggeredEvent extends BaseEvent {
  type: "compaction_triggered";
  session_id: string;
  trigger: "auto" | "manual" | "context_limit";
  context_size_before?: number;
}

export interface SwarmDetectedEvent extends BaseEvent {
  type: "swarm_detected";
  session_id: string;
  confidence: "high" | "medium" | "low" | "none";
  detection_source: "projection" | "hive_query" | "fallback";
  epic_id?: string;
  subtask_count?: number;
  reasons: string[];
}

export interface ContextInjectedEvent extends BaseEvent {
  type: "context_injected";
  session_id: string;
  context_type: "llm_generated" | "static_swarm_context" | "static_with_dynamic_state" | "detection_fallback";
  content_length: number;
  injection_method: "output.prompt" | "output.context.push";
}

export interface ContextCompactedEvent extends BaseEvent {
  type: "context_compacted";
  epic_id?: string;
  cell_id?: string;
  agent_name: string;
  tokens_before: number;
  tokens_after: number;
  compression_ratio: number;
  summary_length: number;
}

export interface CheckpointCreatedEvent extends BaseEvent {
  type: "checkpoint_created";
  epic_id: string;
  cell_id: string;
  agent_name: string;
  checkpoint_id: string;
  trigger: "manual" | "auto" | "progress" | "error";
  progress_percent: number;
  files_snapshot: string[];
}

// ============================================================================
// File Conflict Events
// ============================================================================

export interface FileConflictEvent extends BaseEvent {
  type: "file_conflict";
  requesting_agent: string;
  holding_agent: string;
  paths: string[];
  epic_id?: string;
  cell_id?: string;
  resolution?: "wait" | "force" | "abort";
}

// ============================================================================
// Thread Events
// ============================================================================

export interface ThreadCreatedEvent extends BaseEvent {
  type: "thread_created";
  thread_id: string;
  epic_id?: string;
  initial_subject: string;
  creator_agent: string;
}

export interface ThreadActivityEvent extends BaseEvent {
  type: "thread_activity";
  thread_id: string;
  message_count: number;
  participant_count: number;
  last_message_agent: string;
  has_unread: boolean;
}

// ============================================================================
// Swarm Checkpoint Events
// ============================================================================

export interface SwarmCheckpointedEvent extends BaseEvent {
  type: "swarm_checkpointed";
  epic_id: string;
  cell_id: string;
  strategy: "file-based" | "feature-based" | "risk-based";
  files: string[];
  dependencies: string[];
  directives: {
    shared_context?: string;
    skills_to_load?: string[];
    coordinator_notes?: string;
  };
  recovery: {
    last_checkpoint: number;
    files_modified: string[];
    progress_percent: number;
    last_message?: string;
    error_context?: string;
  };
}

export interface SwarmRecoveredEvent extends BaseEvent {
  type: "swarm_recovered";
  epic_id: string;
  cell_id: string;
  recovered_from_checkpoint: number;
}

// ============================================================================
// Swarm Lifecycle Events
// ============================================================================

export interface SwarmStartedEvent extends BaseEvent {
  type: "swarm_started";
  epic_id: string;
  epic_title: string;
  strategy: "file-based" | "feature-based" | "risk-based";
  subtask_count: number;
  total_files: number;
  coordinator_agent: string;
}

export interface WorkerSpawnedEvent extends BaseEvent {
  type: "worker_spawned";
  epic_id: string;
  cell_id: string;
  worker_agent: string;
  subtask_title: string;
  files_assigned: string[];
  spawn_order: number;
  is_parallel: boolean;
}

export interface WorkerCompletedEvent extends BaseEvent {
  type: "worker_completed";
  epic_id: string;
  cell_id: string;
  worker_agent: string;
  success: boolean;
  duration_ms: number;
  files_touched: string[];
  error_message?: string;
}

export interface ReviewStartedEvent extends BaseEvent {
  type: "review_started";
  epic_id: string;
  cell_id: string;
  attempt: number;
}

export interface ReviewCompletedEvent extends BaseEvent {
  type: "review_completed";
  epic_id: string;
  cell_id: string;
  status: "approved" | "needs_changes" | "blocked";
  attempt: number;
  duration_ms?: number;
}

export interface SwarmCompletedEvent extends BaseEvent {
  type: "swarm_completed";
  epic_id: string;
  epic_title: string;
  success: boolean;
  total_duration_ms: number;
  subtasks_completed: number;
  subtasks_failed: number;
  total_files_touched: string[];
}

// ============================================================================
// Union Type
// ============================================================================

export type AgentEvent =
  // Agent events
  | AgentRegisteredEvent
  | AgentActiveEvent
  // Message events
  | MessageSentEvent
  | MessageReadEvent
  | MessageAckedEvent
  | ThreadCreatedEvent
  | ThreadActivityEvent
  // File events
  | FileReservedEvent
  | FileReleasedEvent
  | FileConflictEvent
  // Task events
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskCompletedEvent
  | TaskBlockedEvent
  // Eval/Learning events
  | DecompositionGeneratedEvent
  | SubtaskOutcomeEvent
  | HumanFeedbackEvent
  // Cell/Hive events
  | CellCreatedEvent
  | CellUpdatedEvent
  | CellStatusChangedEvent
  | CellClosedEvent
  | EpicCreatedEvent
  | HiveSyncedEvent
  // Memory events
  | MemoryStoredEvent
  | MemoryFoundEvent
  | MemoryUpdatedEvent
  | MemoryValidatedEvent
  | MemoryDeletedEvent
  // CASS events
  | CassSearchedEvent
  | CassViewedEvent
  | CassIndexedEvent
  // Skills events
  | SkillLoadedEvent
  | SkillCreatedEvent
  // Decision trace events
  | DecisionRecordedEvent
  // Compaction events
  | CompactionTriggeredEvent
  | SwarmDetectedEvent
  | ContextInjectedEvent
  | ContextCompactedEvent
  | CheckpointCreatedEvent
  // Swarm checkpoint events
  | SwarmCheckpointedEvent
  | SwarmRecoveredEvent
  // Swarm lifecycle events
  | SwarmStartedEvent
  | WorkerSpawnedEvent
  | WorkerCompletedEvent
  | ReviewStartedEvent
  | ReviewCompletedEvent
  | SwarmCompletedEvent;

// ============================================================================
// Connection State
// ============================================================================

export type ConnectionState = 
  | "connecting"
  | "connected"
  | "error"
  | "reconnecting"
  | "closed";

export interface UseEventSourceState {
  state: ConnectionState;
  error?: Error;
  lastEventId?: string;
  retryCount: number;
}
