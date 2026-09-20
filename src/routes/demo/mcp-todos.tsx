import { createFileRoute } from "@tanstack/react-router";
import { Effect, Stream } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { runEffect } from "#/lib/effect";
import type { Todo } from "#/services/todo-schema";
import { submitTodo as saveTodo, todoUpdates } from "#/services/todos-client";

export const Route = createFileRoute("/demo/mcp-todos")({
	component: ORPCTodos,
});

function ORPCTodos() {
	const [todos, setTodos] = useState<readonly Todo[]>([]);
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const pending = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		const updates = todoUpdates().pipe(
			Stream.runForEach((items) => Effect.sync(() => setTodos(items))),
		);
		void runEffect(updates, controller.signal).catch((cause: unknown) => {
			if (!controller.signal.aborted) {
				setError(
					cause instanceof Error ? cause.message : "Unable to load todos.",
				);
			}
		});
		return () => {
			controller.abort();
			pending.current?.abort();
		};
	}, []);

	const [todo, setTodo] = useState("");

	const submitTodo = useCallback(async () => {
		if (pending.current || !todo.trim()) return;
		const controller = new AbortController();
		pending.current = controller;
		setSaving(true);
		setError("");
		try {
			await runEffect(saveTodo(todo), controller.signal);
			if (!controller.signal.aborted) {
				setTodo("");
			}
		} catch (cause) {
			if (!controller.signal.aborted) {
				setError(
					cause instanceof Error ? cause.message : "Unable to save this todo.",
				);
			}
		} finally {
			if (!controller.signal.aborted) setSaving(false);
			if (pending.current === controller) pending.current = null;
		}
	}, [todo]);

	return (
		<main className="demo-page demo-center">
			<section className="demo-panel w-full max-w-2xl">
				<p className="island-kicker mb-2">MCP</p>
				<h1 className="demo-title mb-6">Todos</h1>
				{error && (
					<p role="alert" className="mb-4">
						{error}
					</p>
				)}
				<ul className="mb-4 space-y-2">
					{todos?.map((t) => (
						<li key={t.id} className="demo-list-item">
							<span className="text-base font-medium">{t.title}</span>
						</li>
					))}
				</ul>
				<div className="flex flex-col gap-2">
					<input
						type="text"
						value={todo}
						onChange={(e) => setTodo(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								submitTodo();
							}
						}}
						placeholder="Enter a new todo..."
						className="demo-input"
					/>
					<button
						type="button"
						disabled={saving || todo.trim().length === 0}
						onClick={submitTodo}
						className="demo-button"
					>
						Add todo
					</button>
				</div>
			</section>
		</main>
	);
}
