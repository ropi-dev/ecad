import { createFileRoute } from "@tanstack/react-router";
import { editorMcpHandlers } from "@ecad/core/services/server/editor-mcp.ts";

export const Route = createFileRoute("/mcp/editor/$sessionId")({
	server: {
		handlers: {
			GET: ({ request, params }) =>
				editorMcpHandlers.mcp(request, params.sessionId),
			POST: ({ request, params }) =>
				editorMcpHandlers.mcp(request, params.sessionId),
			DELETE: ({ request, params }) =>
				editorMcpHandlers.mcp(request, params.sessionId),
		},
	},
});
