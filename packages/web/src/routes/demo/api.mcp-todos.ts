import { createFileRoute } from "@tanstack/react-router";
import { handlePostTodo, handleTodoEvents } from "#/services/server/todo-http.ts";

export const Route = createFileRoute("/demo/api/mcp-todos")({
	server: {
		handlers: {
			GET: ({ request }) => handleTodoEvents(request),
			POST: ({ request }) => handlePostTodo(request),
		},
	},
});
