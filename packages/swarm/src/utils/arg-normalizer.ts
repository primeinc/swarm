import type { z } from "zod";

// Generic helpers
function toPlainObject(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object")
				return parsed as Record<string, unknown>;
		} catch {
			// not JSON, leave as-is
			return { title: value };
		}
	}
	if (value && typeof value === "object")
		return value as Record<string, unknown>;
	return {};
}

function coerceBoolean(v: unknown): boolean | undefined {
	if (typeof v === "boolean") return v;
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		if (["true", "t", "1", "yes", "y"].includes(s)) return true;
		if (["false", "f", "0", "no", "n"].includes(s)) return false;
	}
	if (typeof v === "number") return v !== 0;
	return undefined;
}

function coerceNumber(v: unknown): number | undefined {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string") {
		const n = Number(v);
		if (!Number.isNaN(n)) return n;
	}
	return undefined;
}

function normalizeStatus(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	const s = v.trim().toLowerCase().replace(/\s+/g, "_").replace(/-+/g, "_");
	const allowed = new Set(["open", "in_progress", "blocked", "closed"]);
	if (allowed.has(s)) return s;
	return undefined;
}

function normalizeType(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	const s = v.trim().toLowerCase();
	const allowed = new Set(["bug", "feature", "task", "epic", "chore"]);
	if (allowed.has(s)) return s;
	return undefined;
}

function pick<T extends string>(
	obj: Record<string, unknown>,
	keys: readonly T[],
): Partial<Record<T, unknown>> {
	const out: Partial<Record<T, unknown>> = {};
	for (const k of keys) if (k in obj) out[k] = obj[k];
	return out;
}

// Key aliasing common across tools
function aliasCommonKeys(
	obj: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...obj };
	const move = (from: string, to: string) => {
		if (out[from] !== undefined && out[to] === undefined) {
			out[to] = out[from];
			delete out[from];
		}
	};
	// Common ID aliases
	move("cell_id", "id");
	move("cellId", "id");
	move("parentId", "parent_id");
	move("issue_type", "type");
	move("issueType", "type");
	move("kind", "type");
	// Epic aliases
	move("epicTitle", "epic_title");
	move("epicDescription", "epic_description");
	move("subTasks", "subtasks");
	move("tasks", "subtasks");
	move("items", "subtasks");
	move("idSuffix", "id_suffix");
	return out;
}

export function normalizeCreateArgs(raw: unknown): unknown {
	const obj = aliasCommonKeys(toPlainObject(raw));
	// If only title is provided as string
	if (typeof raw === "string" && !obj.title) obj.title = String(raw);

	if (obj.priority !== undefined) obj.priority = coerceNumber(obj.priority);
	if (obj.type !== undefined) obj.type = normalizeType(obj.type) ?? obj.type;
	if (obj.parent_id !== undefined) obj.parent_id = String(obj.parent_id);
	return pick(obj, [
		"title",
		"type",
		"priority",
		"description",
		"parent_id",
	] as const);
}

export function normalizeUpdateArgs(raw: unknown): unknown {
	const obj = aliasCommonKeys(toPlainObject(raw));
	if (obj.status !== undefined)
		obj.status = normalizeStatus(obj.status) ?? obj.status;
	if (obj.priority !== undefined) obj.priority = coerceNumber(obj.priority);
	if (obj.description !== undefined && obj.description != null)
		obj.description = String(obj.description);
	if (obj.id !== undefined) obj.id = String(obj.id);
	return pick(obj, ["id", "status", "description", "priority"] as const);
}

export function normalizeCloseArgs(raw: unknown): unknown {
	const obj = aliasCommonKeys(toPlainObject(raw));
	if (obj.id !== undefined) obj.id = String(obj.id);
	if (obj.reason !== undefined) obj.reason = String(obj.reason);
	return pick(obj, ["id", "reason"] as const);
}

export function normalizeQueryArgs(raw: unknown): unknown {
	const obj = aliasCommonKeys(toPlainObject(raw));
	if (obj.status !== undefined)
		obj.status = normalizeStatus(obj.status) ?? obj.status;
	if (obj.type !== undefined) obj.type = normalizeType(obj.type) ?? obj.type;
	if (obj.ready !== undefined) obj.ready = coerceBoolean(obj.ready);
	if (obj.parent_id !== undefined) obj.parent_id = String(obj.parent_id);
	if (obj.limit !== undefined) obj.limit = coerceNumber(obj.limit);
	return pick(obj, ["status", "type", "ready", "parent_id", "limit"] as const);
}

export function normalizeCellsArgs(raw: unknown): unknown {
	const obj = aliasCommonKeys(toPlainObject(raw));
	if (obj.id !== undefined) obj.id = String(obj.id);
	if (obj.status !== undefined)
		obj.status = normalizeStatus(obj.status) ?? obj.status;
	if (obj.type !== undefined) obj.type = normalizeType(obj.type) ?? obj.type;
	if (obj.parent_id !== undefined) obj.parent_id = String(obj.parent_id);
	if (obj.ready !== undefined) obj.ready = coerceBoolean(obj.ready);
	if (obj.limit !== undefined) obj.limit = coerceNumber(obj.limit);
	return pick(obj, [
		"id",
		"status",
		"type",
		"parent_id",
		"ready",
		"limit",
	] as const);
}

export function normalizeEpicCreateArgs(raw: unknown): unknown {
	const obj0 = aliasCommonKeys(toPlainObject(raw));
	const obj: Record<string, unknown> = { ...obj0 };

	if (obj.subtasks !== undefined && !Array.isArray(obj.subtasks)) {
		// Accept single string or object
		if (typeof obj.subtasks === "string")
			obj.subtasks = obj.subtasks
				.split(/[,\n]/)
				.map((s) => ({ title: s.trim() }))
				.filter((x) => x.title);
		else if (obj.subtasks && typeof obj.subtasks === "object")
			obj.subtasks = [obj.subtasks];
	}
	if (Array.isArray(obj.subtasks)) {
		obj.subtasks = obj.subtasks.map((st: any) => {
			if (typeof st === "string") return { title: st };
			const s: any = aliasCommonKeys(toPlainObject(st));
			if (s.priority !== undefined) s.priority = coerceNumber(s.priority);
			if (s.files && !Array.isArray(s.files)) s.files = [String(s.files)];
			if (Array.isArray(s.files)) s.files = s.files.map((p: any) => String(p));
			return pick(s, ["title", "priority", "files", "id_suffix"] as const);
		});
	}

	if (obj.epic_title === undefined && typeof raw === "string")
		obj.epic_title = String(raw);
	if (obj.epic_description !== undefined)
		obj.epic_description = String(obj.epic_description);

	return pick(obj, [
		"epic_title",
		"epic_description",
		"epic_id",
		"subtasks",
		"strategy",
		"task",
		"project_key",
		"recovery_context",
	] as const);
}

export function formatZodError(
	toolName: string,
	err: z.ZodError,
	example?: string,
): string {
	const issues = err.issues
		.map((i) => `- ${i.path.join(".") || "<root>"}: ${i.message}`)
		.join("\n");
	const guidance = `How to fix:\n1) Check field names (snake_case expected).\n2) Coercions allowed: booleans as 'true/false', numbers as strings, status 'in-progress' -> 'in_progress'.\n3) Remove unknown fields or typos.`;
	const sample = example ? `\n\nExample:\n${example}` : "";
	return `${toolName}: Invalid arguments.\n${issues}\n\n${guidance}${sample}`;
}
