// @ts-nocheck
/**
 * MCP Streamable HTTP Server
 *
 * Uses the official MCP SDK's WebStandardStreamableHTTPServerTransport
 * for proper MCP protocol compatibility with Cline and other MCP clients.
 *
 * Protocol: Streamable HTTP (modern MCP transport)
 *   - Each request gets a fresh McpServer + transport (stateless per-request)
 *   - Following the official SDK example pattern
 *
 * Tools: get_pending_task, report_task_done
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import Repository from "../../lib/repository";
import { TaskEntity } from "../../../shared/modules/mcp/mcp.entity";

const taskRepository = Repository.instance<TaskEntity>("Task");

// ──────────────────────────────────────────────
// Factory: create a fresh McpServer per request
// ──────────────────────────────────────────────

function createServer(): McpServer {
    const server = new McpServer({
        name: "onekey-mcp-server",
        version: "1.0.0",
    });

    server.registerTool("get_pending_task", {
        description: "Get the next pending task (oldest first). Returns null if no tasks are pending.",
        inputSchema: z.object({}),
    }, async () => {
        const list = await taskRepository.find({ status: "pending" });
        if (list.length === 0) {
            return { content: [{ type: "text", text: "null" }] };
        }
        const task = list[0];
        await taskRepository.update({ id: task.id }, { status: "running" });
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    id: task.id,
                    task: task.task,
                    folder: task.folder || "",
                    user: task.user || "",
                    status: task.status,
                    create_time: task.create_time,
                }),
            }],
        };
    });

    server.registerTool("report_task_done", {
        description: "Report a task as completed with an optional summary.",
        inputSchema: z.object({
            id: z.string().describe("The task ID to mark as done"),
            summary: z.string().optional().describe("A summary of what was accomplished"),
        }),
    }, async ({ id, summary }) => {
        const task = await taskRepository.findOne({ id });
        if (!task) {
            return {
                isError: true,
                content: [{ type: "text", text: `Task with id '${id}' not found` }],
            };
        }
        await taskRepository.update({ id }, {
            status: "done",
            summary: summary || "",
        });
        return {
            content: [{
                type: "text",
                text: JSON.stringify({ success: true, message: "Task marked as done", id, summary: summary || "" }),
            }],
        };
    });

    return server;
}

// ──────────────────────────────────────────────
// Public API — fresh server + transport per request
// ──────────────────────────────────────────────

/**
 * Handle MCP requests using Streamable HTTP transport.
 * Creates a fresh McpServer + transport per request (following official SDK example pattern).
 * This avoids "already initialized" errors caused by reusing a Protocol instance.
 */
export async function handleMcpRequest(req: Request): Promise<Response> {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createServer();

    try {
        await server.connect(transport);
        const response = await transport.handleRequest(req);
        return response;
    } catch (error) {
        console.error("MCP request error:", error);
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: error.message || "Internal error" },
            id: null,
        }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}