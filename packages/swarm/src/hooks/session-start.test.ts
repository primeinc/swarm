import { describe, it, expect, mock, beforeEach } from "bun:test";
import { injectSessionContext } from "./session-start";
import type { HiveAdapter } from "swarm-mail";

// Mock HiveAdapter
const mockAdapter: HiveAdapter = {
  queryCells: mock(async () => []),
  close: mock(async () => {}),
} as unknown as HiveAdapter;

// Mock the getHiveAdapter function from ../hive.js
const mockGetHiveAdapter = mock(async () => mockAdapter);

// Mock the hive module
mock.module("../hive.js", () => ({
  getHiveAdapter: mockGetHiveAdapter,
}));

describe("injectSessionContext", () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockGetHiveAdapter.mockClear();
    (mockAdapter.queryCells as ReturnType<typeof mock>).mockClear();
    (mockAdapter.close as ReturnType<typeof mock>).mockClear();
  });

  it("queries hive for in-progress cells", async () => {
    const mockInProgressCells = [
      { id: "cell-1", title: "Fix auth bug", type: "bug" as const, status: "in_progress" as const, priority: 1 },
      { id: "cell-2", title: "Add tests", type: "task" as const, status: "in_progress" as const, priority: 2 },
    ];

    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce(mockInProgressCells);
    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce([]);

    const result = await injectSessionContext("session-123", "/test/project");

    expect(result).not.toBeNull();
    expect(result?.inProgressCells).toEqual([
      { id: "cell-1", title: "Fix auth bug" },
      { id: "cell-2", title: "Add tests" },
    ]);
    expect(mockAdapter.queryCells).toHaveBeenCalledWith("/test/project", { status: "in_progress" });
  });

  it("queries hive for active swarms (open epics)", async () => {
    const mockEpics = [
      { id: "epic-1", title: "Auth refactor", type: "epic" as const, status: "open" as const, priority: 2 },
      { id: "epic-2", title: "API redesign", type: "epic" as const, status: "open" as const, priority: 1 },
    ];

    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce([]);
    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce(mockEpics);

    const result = await injectSessionContext("session-456", "/test/project");

    expect(result).not.toBeNull();
    expect(result?.activeSwarms).toEqual([
      { epicId: "epic-1", title: "Auth refactor" },
      { epicId: "epic-2", title: "API redesign" },
    ]);
    expect(mockAdapter.queryCells).toHaveBeenCalledWith("/test/project", { type: "epic", status: "open" });
  });

  it("returns complete context with both cells and epics", async () => {
    const mockInProgressCells = [
      { id: "cell-1", title: "Fix bug", type: "bug" as const, status: "in_progress" as const, priority: 1 },
    ];
    const mockEpics = [
      { id: "epic-1", title: "Feature X", type: "epic" as const, status: "open" as const, priority: 2 },
    ];

    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce(mockInProgressCells);
    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce(mockEpics);

    const result = await injectSessionContext("session-789", "/test/project");

    expect(result).toEqual({
      inProgressCells: [{ id: "cell-1", title: "Fix bug" }],
      activeSwarms: [{ epicId: "epic-1", title: "Feature X" }],
    });
  });

  it("handles empty results gracefully", async () => {
    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValue([]);

    const result = await injectSessionContext("session-empty", "/test/project");

    expect(result).toEqual({
      inProgressCells: [],
      activeSwarms: [],
    });
  });

  it("handles adapter errors gracefully and returns null", async () => {
    mockGetHiveAdapter.mockRejectedValueOnce(new Error("Database connection failed"));

    const result = await injectSessionContext("session-error", "/test/project");

    expect(result).toBeNull();
  });

  it("handles query errors gracefully and returns null", async () => {
    (mockAdapter.queryCells as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("Query failed")
    );

    const result = await injectSessionContext("session-query-error", "/test/project");

    expect(result).toBeNull();
  });

  it("logs session start with counts via debug logger", async () => {
    // Set DEBUG env before any calls (debug function checks env at call time)
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = "swarm:*";

    const mockInProgressCells = [
      { id: "cell-1", title: "Task 1", type: "task" as const, status: "in_progress" as const, priority: 1 },
      { id: "cell-2", title: "Task 2", type: "task" as const, status: "in_progress" as const, priority: 1 },
    ];
    const mockEpics = [
      { id: "epic-1", title: "Epic 1", type: "epic" as const, status: "open" as const, priority: 2 },
    ];

    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce(mockInProgressCells);
    (mockAdapter.queryCells as ReturnType<typeof mock>).mockResolvedValueOnce(mockEpics);

    // Capture console.log calls
    const originalLog = console.log;
    const logCalls: unknown[][] = [];
    console.log = mock((...args: unknown[]) => {
      logCalls.push(args);
    });

    await injectSessionContext("session-logging", "/test/project");

    // Restore
    console.log = originalLog;
    process.env.DEBUG = originalDebug;

    // Verify logging occurred - check for [swarm:hooks] prefix
    const hasSessionStartLog = logCalls.some((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("[swarm:hooks]"))
    );
    expect(hasSessionStartLog).toBe(true);

    // Verify specific log messages
    const hasSessionStart = logCalls.some((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("session_start"))
    );
    const hasInProgressCells = logCalls.some((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("in_progress_cells"))
    );
    const hasActiveSwarms = logCalls.some((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("active_swarms"))
    );
    expect(hasSessionStart).toBe(true);
    expect(hasInProgressCells).toBe(true);
    expect(hasActiveSwarms).toBe(true);
  });
});
