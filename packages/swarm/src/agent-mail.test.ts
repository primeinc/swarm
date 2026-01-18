import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

const mockIsToolAvailable = mock(async () => true);
const mockWarnMissingTool = mock(() => {});

mock.module("./tool-availability.js", () => ({
  isToolAvailable: mockIsToolAvailable,
  warnMissingTool: mockWarnMissingTool,
}));

import {
  agentmail_init,
  agentmail_reserve,
  agentmail_release,
  resetAgentMailCache,
  clearState,
} from "./agent-mail";

/**
 * Create a mock fetch handler for Agent Mail requests.
 */
function createMockFetch(
  requests: Array<{ tool: string; args: Record<string, unknown> }>,
  toolResponses: Record<string, unknown> = {},
) {
  return mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const toolName = body?.params?.name;
    const args = (body?.params?.arguments ?? {}) as Record<string, unknown>;

    requests.push({ tool: toolName, args });

    if (toolName && toolName in toolResponses) {
      return new Response(JSON.stringify({ result: toolResponses[toolName] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (toolName === "ensure_project") {
      return new Response(
        JSON.stringify({ result: { id: "project-1", human_key: args.human_key } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (toolName === "register_agent") {
      return new Response(
        JSON.stringify({ result: { name: args.name ?? "agent-1" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ result: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("agentmail_init", () => {
  const originalFetch = globalThis.fetch;
  const mockContext = { sessionID: "agentmail-init-test" } as const;

  beforeEach(() => {
    resetAgentMailCache();
    mockIsToolAvailable.mockClear();
    mockWarnMissingTool.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearState(mockContext.sessionID);
  });

  test("registers agent with default OpenCode model", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    globalThis.fetch = createMockFetch(requests);

    await agentmail_init.execute(
      {
        project_path: "/tmp/opencode-test",
        agent_name: "TestAgent",
        task_description: "Test init",
      },
      mockContext,
    );

    const registration = requests.find((request) => request.tool === "register_agent");
    expect(registration?.args.model).toBe("openai/gpt-5.2-codex");
  });
});

describe("agentmail_reserve", () => {
  const originalFetch = globalThis.fetch;
  const mockContext = { sessionID: "agentmail-reserve-test" } as const;

  beforeEach(() => {
    resetAgentMailCache();
    mockIsToolAvailable.mockClear();
    mockWarnMissingTool.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearState(mockContext.sessionID);
  });

  test("requires ttl_seconds", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    globalThis.fetch = createMockFetch(requests);

    await agentmail_init.execute(
      {
        project_path: "/tmp/opencode-test",
        agent_name: "TestAgent",
        task_description: "Test reserve",
      },
      mockContext,
    );

    await expect(
      agentmail_reserve.execute({ paths: ["src/agent.ts"] }, mockContext),
    ).rejects.toThrow("ttl_seconds");

    const reservation = requests.find(
      (request) => request.tool === "file_reservation_paths",
    );
    expect(reservation).toBeUndefined();
  });

  test("releases stored reservations on completion", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    globalThis.fetch = createMockFetch(requests, {
      file_reservation_paths: {
        granted: [
          {
            id: 42,
            path_pattern: "src/agent.ts",
            exclusive: true,
            reason: "",
            expires_ts: "2026-01-10T00:00:00Z",
          },
        ],
        conflicts: [],
      },
      release_file_reservations: {
        released: 1,
        released_at: "2026-01-10T00:00:01Z",
      },
    });

    await agentmail_init.execute(
      {
        project_path: "/tmp/opencode-test",
        agent_name: "TestAgent",
        task_description: "Test release",
      },
      mockContext,
    );

    await agentmail_reserve.execute(
      { paths: ["src/agent.ts"], ttl_seconds: 60 },
      mockContext,
    );

    await agentmail_release.execute({}, mockContext);

    const releaseRequest = requests.find(
      (request) => request.tool === "release_file_reservations",
    );

    expect(releaseRequest?.args.file_reservation_ids).toEqual([42]);
  });
});
