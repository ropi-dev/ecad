import { createFileRoute } from "@tanstack/react-router";
import { editorMcpHandlers } from "#/services/server/editor-mcp.ts";

export const Route = createFileRoute("/api/editor-mcp")({
	server: {
		handlers: {
			POST: ({ request }) => editorMcpHandlers.createSession(request),
		},
	},
});
