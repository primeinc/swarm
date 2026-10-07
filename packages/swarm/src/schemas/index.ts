/**
 * Schema Definitions - Central export point for all Zod schemas
 *
 * This module re-exports all schema definitions used throughout the plugin.
 * Schemas are organized by domain:
 *
 * ## Cell Schemas (Issue Tracking) - PRIMARY
 * - `CellSchema` - Core cell/issue definition
 * - `CellStatusSchema` - Status enum (open, in_progress, blocked, closed)
 * - `CellTypeSchema` - Type enum (bug, feature, task, epic, chore)
 * - `SubtaskSpecSchema` - Subtask specification for epic creation
 * - `CellTreeSchema` - Epic + subtasks structure
 *
 * ## Task Schemas (Swarm Decomposition)
 * - `TaskDecompositionSchema` - Full task breakdown
 * - `DecomposedSubtaskSchema` - Individual subtask definition
 *
 * ## Evaluation Schemas (Agent Self-Assessment)
 * - `EvaluationSchema` - Complete evaluation with criteria
 * - `CriterionEvaluationSchema` - Single criterion result
 *
 * ## Progress Schemas (Swarm Coordination)
 * - `SwarmStatusSchema` - Overall swarm progress
 * - `AgentProgressSchema` - Individual agent status
 * - `SpawnedAgentSchema` - Spawned agent metadata
 *
 * ## Worker Handoff Schemas (Swarm Contracts)
 * - `WorkerHandoffSchema` - Complete structured handoff contract
 * - `WorkerHandoffContractSchema` - Task contract (files, criteria)
 * - `WorkerHandoffContextSchema` - Narrative context (epic summary, role)
 * - `WorkerHandoffEscalationSchema` - Escalation protocols
 *
 * @module schemas
 */

// Cell schemas (primary names)
export {
	type Cell,
	type CellCloseArgs,
	CellCloseArgsSchema,
	type CellCreateArgs,
	CellCreateArgsSchema,
	type CellDependency,
	CellDependencySchema,
	type CellQueryArgs,
	CellQueryArgsSchema,
	CellSchema,
	type CellStatus,
	CellStatusSchema,
	type CellTree,
	CellTreeSchema,
	type CellType,
	CellTypeSchema,
	type CellUpdateArgs,
	CellUpdateArgsSchema,
	type EpicCreateArgs,
	EpicCreateArgsSchema,
	type EpicCreateResult,
	EpicCreateResultSchema,
	type SubtaskSpec,
	SubtaskSpecSchema,
} from "./cell";
// Cell event schemas (PRIMARY)
export {
	BaseCellEventSchema,
	type CellAssignedEvent,
	CellAssignedEventSchema,
	type CellClosedEvent,
	CellClosedEventSchema,
	type CellCommentAddedEvent,
	CellCommentAddedEventSchema,
	type CellCommentDeletedEvent,
	CellCommentDeletedEventSchema,
	type CellCommentUpdatedEvent,
	CellCommentUpdatedEventSchema,
	type CellCompactedEvent,
	CellCompactedEventSchema,
	type CellCreatedEvent,
	CellCreatedEventSchema,
	type CellDeletedEvent,
	CellDeletedEventSchema,
	type CellDependencyAddedEvent,
	CellDependencyAddedEventSchema,
	type CellDependencyRemovedEvent,
	CellDependencyRemovedEventSchema,
	type CellEpicChildAddedEvent,
	CellEpicChildAddedEventSchema,
	type CellEpicChildRemovedEvent,
	CellEpicChildRemovedEventSchema,
	type CellEpicClosureEligibleEvent,
	CellEpicClosureEligibleEventSchema,
	type CellEvent,
	CellEventSchema,
	type CellLabelAddedEvent,
	CellLabelAddedEventSchema,
	type CellLabelRemovedEvent,
	CellLabelRemovedEventSchema,
	type CellReopenedEvent,
	CellReopenedEventSchema,
	type CellStatusChangedEvent,
	CellStatusChangedEventSchema,
	type CellUpdatedEvent,
	CellUpdatedEventSchema,
	type CellWorkStartedEvent,
	CellWorkStartedEventSchema,
	createCellEvent,
	getCellIdFromEvent,
	isAgentEvent,
	isCellEventType,
	isEpicEvent,
	isStateTransitionEvent,
} from "./cell-events";
// Evaluation schemas
export {
	type CriterionEvaluation,
	CriterionEvaluationSchema,
	DEFAULT_CRITERIA,
	type DefaultCriterion,
	type Evaluation,
	type EvaluationRequest,
	EvaluationRequestSchema,
	EvaluationSchema,
	type SwarmEvaluationResult,
	SwarmEvaluationResultSchema,
	type ValidationResult,
	ValidationResultSchema,
	type WeightedCriterionEvaluation,
	WeightedCriterionEvaluationSchema,
	type WeightedEvaluation,
	WeightedEvaluationSchema,
} from "./evaluation";
// Mandate schemas
export {
	type CastVoteArgs,
	CastVoteArgsSchema,
	type CreateMandateArgs,
	CreateMandateArgsSchema,
	DEFAULT_MANDATE_DECAY_CONFIG,
	type MandateContentType,
	MandateContentTypeSchema,
	type MandateDecayConfig,
	type MandateEntry,
	MandateEntrySchema,
	type MandateScore,
	MandateScoreSchema,
	type MandateStatus,
	MandateStatusSchema,
	mandateSchemas,
	type QueryMandatesArgs,
	QueryMandatesArgsSchema,
	type ScoreCalculationResult,
	ScoreCalculationResultSchema,
	type Vote,
	VoteSchema,
	type VoteType,
	VoteTypeSchema,
} from "./mandate";
// Swarm context schemas
export {
	type CreateSwarmContextArgs,
	CreateSwarmContextArgsSchema,
	type QuerySwarmContextsArgs,
	QuerySwarmContextsArgsSchema,
	type SwarmCellContext,
	SwarmCellContextSchema,
	type SwarmDirectives,
	SwarmDirectivesSchema,
	type SwarmRecovery,
	SwarmRecoverySchema,
	type SwarmStrategy,
	SwarmStrategySchema,
	type UpdateSwarmContextArgs,
	UpdateSwarmContextArgsSchema,
} from "./swarm-context";
// Task schemas
export {
	type AgentProgress,
	AgentProgressSchema,
	type DecomposeArgs,
	DecomposeArgsSchema,
	type DecomposedSubtask,
	DecomposedSubtaskSchema,
	type DependencyType,
	DependencyTypeSchema,
	type EffortLevel,
	EffortLevelSchema,
	type SpawnedAgent,
	SpawnedAgentSchema,
	type SubtaskDependency,
	SubtaskDependencySchema,
	type SwarmSpawnResult,
	SwarmSpawnResultSchema,
	type SwarmStatus,
	SwarmStatusSchema,
	type TaskDecomposition,
	TaskDecompositionSchema,
} from "./task";
// Worker handoff schemas
export {
	type WorkerHandoff,
	type WorkerHandoffContext,
	WorkerHandoffContextSchema,
	type WorkerHandoffContract,
	WorkerHandoffContractSchema,
	type WorkerHandoffEscalation,
	WorkerHandoffEscalationSchema,
	WorkerHandoffSchema,
} from "./worker-handoff";
