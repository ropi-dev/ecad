import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { editorMcpHandlers } from "@ecad/core/services/server/editor-mcp.ts";

export const Route = createFileRoute("/api/editor-mcp")({
	server: {
		handlers: {
			// The runtime's peer address; X-Forwarded-For is only used for trusted proxy hops.
			POST: ({ request }) =>
				editorMcpHandlers.createSession(request, getRequestIP()),
		},
	},
});
