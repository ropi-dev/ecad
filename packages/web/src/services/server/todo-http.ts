import { Effect, Schedule, Schema, Stream } from "effect";
import { runEffect } from "@ecad/core/lib/effect.ts";
import {
	addTodoEffect,
	type Todo,
	TodoInputError,
	TodoRepository,
	TodoRepositoryLive,
} from "#/mcp-todos.ts";

const TitleSchema = Schema.Struct({ title: Schema.String });

const untilAborted = (signal?: AbortSignal) =>
	Effect.async<void>((resume) => {
		if (!signal) return;
		const onAbort = () => resume(Effect.void);
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		return Effect.sync(() => signal.removeEventListener("abort", onAbort));
	});

export function createTodoEventStream(
	changes: Stream.Stream<ReadonlyArray<Todo>>,
	signal?: AbortSignal,
	heartbeatMs = 1000,
) {
	const encoder = new TextEncoder();
	const updates = changes.pipe(
		Stream.map((todos) => `data: ${JSON.stringify(todos)}\n\n`),
	);
	const heartbeat = Stream.repeatEffectWithSchedule(
		Effect.succeed("event: ping\n\n"),
		Schedule.spaced(heartbeatMs),
	);
	// Cancelling the readable stream interrupts both streams and releases the subscription.
	return updates.pipe(
		Stream.merge(heartbeat),
		Stream.interruptWhen(untilAborted(signal)),
		Stream.map((event) => encoder.encode(event)),
	);
}

export const openTodoEvents = (signal?: AbortSignal) =>
	Effect.map(
		TodoRepository,
		(repository) =>
			new Response(
				Stream.toReadableStream(
					createTodoEventStream(repository.changes, signal),
				),
				{
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
					},
				},
			),
	);

export const postTodo = (request: Request) =>
	Effect.gen(function* () {
		const body = yield* Effect.tryPromise({
			try: () => request.json(),
			catch: () => new TodoInputError({ message: "Invalid JSON" }),
		});
		const { title } = yield* Schema.decodeUnknown(TitleSchema)(body).pipe(
			Effect.mapError(
				() => new TodoInputError({ message: "A todo title is required" }),
			),
		);
		return Response.json(yield* addTodoEffect(title));
	});

const errorResponse = (error: TodoInputError | { readonly message: string }) =>
	Effect.succeed(
		Response.json(
			{ error: error.message },
			{ status: error instanceof TodoInputError ? 400 : 500 },
		),
	);

export const handleTodoEvents = (request: Request) =>
	runEffect(
		openTodoEvents(request.signal).pipe(
			Effect.provide(TodoRepositoryLive),
			Effect.catchAll(errorResponse),
		),
		request.signal,
	);

export const handlePostTodo = (request: Request) =>
	runEffect(
		postTodo(request).pipe(
			Effect.provide(TodoRepositoryLive),
			Effect.catchAll(errorResponse),
		),
		request.signal,
	);
