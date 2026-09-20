import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { addTodo } from "#/mcp-todos";
import { handleMcpRequest } from "#/utils/mcp-handler";

function createTodoServer() {
	const server = new McpServer({ name: "start-server", version: "1.0.0" });
	server.registerTool(
		"addTodo",
		{
			title: "Tool to add a todo to a list of todos",
			description: "Add a todo to a list of todos",
			inputSchema: {
				title: z.string().min(1).describe("The title of the todo"),
			},
		},
		async ({ title }, { signal }) => ({
			content: [
				{ type: "text", text: JSON.stringify(await addTodo(title, signal)) },
			],
		}),
	);
	return server;
}

export const Route = createFileRoute("/mcp")({
	server: {
		handlers: {
			POST: ({ request }) => handleMcpRequest(request, createTodoServer),
		},
	},
});
