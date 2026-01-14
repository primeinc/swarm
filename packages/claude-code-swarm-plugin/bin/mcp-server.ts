#!/usr/bin/env bun
/**
 * Thin MCP server for Claude Code that shells out to swarm CLI.
 *
 * This avoids bundling issues with native deps (@libsql/client) by
 * delegating all tool execution to the installed swarm CLI.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync } from "child_process";
import { z } from "zod";

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Tools exposed to Claude Code.
 * Organized by user-facing vs agent-internal.
 */
const ALLOWED_TOOLS = new Set([
  // ========== USER-FACING ==========

  // Hive - task/cell management
  "hive_cells",
  "hive_create",
  "hive_create_epic",
  "hive_close",
  "hive_query",
  "hive_ready",
  "hive_update",

  // Hivemind - unified memory
  "hivemind_find",
  "hivemind_store",
  "hivemind_get",
  "hivemind_stats",

  // Swarmmail - agent coordination
  "swarmmail_inbox",
  "swarmmail_send",
  "swarmmail_reserve",
  "swarmmail_release",
  "swarmmail_init",

  // Core swarm
  "swarm_decompose",
  "swarm_status",

  // ========== AGENT-INTERNAL ==========
  // Used by coordinator/worker agents

  // Coordinator tools
  "swarm_plan_prompt",
  "swarm_validate_decomposition",
  "swarm_spawn_subtask",
  "swarm_review",
  "swarm_review_feedback",

  // Worker tools
  "swarm_progress",
  "swarm_complete",
]);

/**
 * Filter to only allowed user-facing tools.
 */
function filterTools(tools: ToolInfo[]): ToolInfo[] {
  return tools.filter(tool => ALLOWED_TOOLS.has(tool.name));
}

/**
 * Convert JSON Schema to Zod schema for MCP SDK.
 * Handles the common types we get from the swarm CLI.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const props = schema.properties as Record<string, { type?: string; enum?: string[]; items?: Record<string, unknown> }> | undefined;
  const required = (schema.required as string[]) || [];

  if (!props || Object.keys(props).length === 0) {
    // Empty schema - accept any properties
    return z.record(z.string(), z.unknown());
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(props)) {
    let fieldSchema: z.ZodTypeAny;

    switch (prop.type) {
      case "string":
        fieldSchema = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
        break;
      case "number":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      case "array":
        if (prop.items?.type === "object") {
          fieldSchema = z.array(jsonSchemaToZod(prop.items as Record<string, unknown>));
        } else {
          fieldSchema = z.array(z.unknown());
        }
        break;
      case "object":
        fieldSchema = jsonSchemaToZod(prop as Record<string, unknown>);
        break;
      default:
        fieldSchema = z.unknown();
    }

    // Make optional if not in required array
    shape[key] = required.includes(key) ? fieldSchema : fieldSchema.optional();
  }

  return z.object(shape).passthrough(); // passthrough allows extra properties
}

/**
 * Get tool definitions from swarm CLI.
 * Falls back to empty list if CLI not available.
 */
function getToolDefinitions(): ToolInfo[] {
  try {
    // Get tool list with schema info from swarm CLI
    const output = execSync("swarm tool --list --json 2>/dev/null", {
      encoding: "utf-8",
      timeout: 10000,
    });
    return JSON.parse(output);
  } catch {
    // Fallback: get just tool names
    try {
      const output = execSync("swarm tool --list 2>/dev/null", {
        encoding: "utf-8",
        timeout: 10000,
      });
      // Parse the grouped output to extract tool names
      const tools: ToolInfo[] = [];
      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.endsWith(":") && !trimmed.includes("SWARM") && !trimmed.includes("Available")) {
          tools.push({
            name: trimmed,
            description: `Swarm tool: ${trimmed}`,
            inputSchema: { type: "object", properties: {}, additionalProperties: true },
          });
        }
      }
      return tools;
    } catch {
      console.error("[swarm-mcp] Failed to get tool list from swarm CLI");
      return [];
    }
  }
}

/**
 * Execute a tool via swarm CLI.
 */
function executeTool(name: string, args: Record<string, unknown>): string {
  try {
    const argsJson = JSON.stringify(args);
    const output = execSync(`swarm tool ${name} --json '${argsJson.replace(/'/g, "'\\''")}'`, {
      encoding: "utf-8",
      timeout: 120000, // 2 minute timeout for long operations
      env: {
        ...process.env,
        CLAUDE_SESSION_ID: process.env.CLAUDE_SESSION_ID,
        CLAUDE_MESSAGE_ID: process.env.CLAUDE_MESSAGE_ID,
        CLAUDE_AGENT_NAME: process.env.CLAUDE_AGENT_NAME,
      },
    });
    return output;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    if (err.stdout) return err.stdout;
    return JSON.stringify({
      success: false,
      error: {
        code: "EXECUTION_ERROR",
        message: err.message || String(error),
        stderr: err.stderr,
      },
    });
  }
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "swarm-tools",
    version: process.env.SWARM_VERSION || "0.57.5",
  });

  // Get tools from CLI, filter deprecated ones, and register
  const allTools = getToolDefinitions();
  const tools = filterTools(allTools);
  console.error(`[swarm-mcp] Registering ${tools.length} tools (filtered from ${allTools.length})`);

  for (const tool of tools) {
    // Convert JSON Schema from CLI to Zod for MCP SDK
    const zodSchema = jsonSchemaToZod(tool.inputSchema) as unknown as any;

    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: zodSchema },
      async (args: Record<string, unknown>) => {
        const result = executeTool(tool.name, args ?? {});
        return {
          content: [{ type: "text" as const, text: result }],
        };
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[swarm-mcp] Server started");
}

main().catch((error) => {
  console.error("[swarm-mcp] Server failed", error);
  process.exit(1);
});
