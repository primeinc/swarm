/**
 * Tests for coordinator-only swarm mail tools.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  swarmmail_init,
  swarmmail_release_all,
  swarmmail_release_agent,
  clearSessionState,
} from "./swarm-mail";
import {
  setCoordinatorContext,
  clearAllCoordinatorContexts,
} from "./planning-guardrails";

interface MockToolContext {
  sessionID: string;
}

function createTestContext(): MockToolContext {
  return { sessionID: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
}

async function executeTool<T>(
  tool: { execute: (args: unknown, ctx: MockToolContext) => Promise<string> },
  args: unknown,
  ctx: MockToolContext,
): Promise<T> {
  const result = await tool.execute(args, ctx);
  return JSON.parse(result) as T;
}

function testProjectPath(): string {
  return join(tmpdir(), `swarm-mail-tools-${randomUUID()}`);
}

let projectPath: string;

beforeEach(async () => {
  projectPath = testProjectPath();
  await mkdir(projectPath, { recursive: true });
});

afterEach(async () => {
  clearAllCoordinatorContexts();
  try {
    await rm(projectPath, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe("swarmmail_release_all guardrails", () => {
  it("rejects release_all when not in coordinator context", async () => {
    const ctx = createTestContext();

    await executeTool(swarmmail_init, { project_path: projectPath }, ctx);

    const result = await executeTool<{ error?: string; guard?: string }>(
      swarmmail_release_all,
      {},
      ctx,
    );

    expect(result.error).toMatch(/coordinator/i);
    expect(result.guard).toBe("coordinator_only");

    clearSessionState(ctx.sessionID);
  });

  it("allows release_all when coordinator context is set", async () => {
    const ctx = createTestContext();

    await executeTool(swarmmail_init, { project_path: projectPath }, ctx);
    setCoordinatorContext({ isCoordinator: true, sessionId: ctx.sessionID });

    const result = await executeTool<{ release_all?: boolean; released?: number }>(
      swarmmail_release_all,
      {},
      ctx,
    );

    expect(result.release_all).toBe(true);
    expect(result.released).toBeGreaterThanOrEqual(0);

    clearSessionState(ctx.sessionID);
  });
});

describe("swarmmail_release_agent guardrails", () => {
  it("rejects release_agent when not in coordinator context", async () => {
    const ctx = createTestContext();

    await executeTool(swarmmail_init, { project_path: projectPath }, ctx);

    const result = await executeTool<{ error?: string; guard?: string }>(
      swarmmail_release_agent,
      { agent_name: "WorkerBee" },
      ctx,
    );

    expect(result.error).toMatch(/coordinator/i);
    expect(result.guard).toBe("coordinator_only");

    clearSessionState(ctx.sessionID);
  });

  it("allows release_agent when coordinator context is set", async () => {
    const ctx = createTestContext();

    await executeTool(swarmmail_init, { project_path: projectPath }, ctx);
    setCoordinatorContext({ isCoordinator: true, sessionId: ctx.sessionID });

    const result = await executeTool<{ released?: number; target_agent?: string }>(
      swarmmail_release_agent,
      { agent_name: "WorkerBee" },
      ctx,
    );

    expect(result.target_agent).toBe("WorkerBee");
    expect(result.released).toBeGreaterThanOrEqual(0);

    clearSessionState(ctx.sessionID);
  });
});
