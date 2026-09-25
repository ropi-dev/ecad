import { createFileRoute } from "@tanstack/react-router";
import { editorMcpHandlers } from "#/services/server/editor-mcp.ts";

export const Route = createFileRoute("/api/editor-mcp/$sessionId")({
	server: {
		handlers: {
			GET: ({ request, params }) =>
				editorMcpHandlers.session(request, params.sessionId),
			POST: ({ request, params }) =>
				editorMcpHandlers.session(request, params.sessionId),
			DELETE: ({ request, params }) =>
				editorMcpHandlers.session(request, params.sessionId),
		},
	},
});
