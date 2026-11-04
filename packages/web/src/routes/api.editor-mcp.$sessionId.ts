import { editorMcpHandlers } from "@ecad/core/services/server/editor-mcp.ts";
import { createFileRoute } from "@tanstack/react-router";

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
