import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import {
	Context,
	Data,
	Effect,
	Layer,
	Schema,
	Stream,
	SubscriptionRef,
} from "effect";
import { runEffect } from "@ecad/core/lib/effect.ts";
import { type Todo, TodosSchema } from "#/services/todo-schema.ts";

export type { Todo } from "#/services/todo-schema.ts";

export class TodoStorageError extends Data.TaggedError("TodoStorageError")<{
	operation: "read" | "write";
	cause: unknown;
}> {
	get message() {
		return `Unable to ${this.operation} the todo file`;
	}
}

export class TodoInputError extends Data.TaggedError("TodoInputError")<{
	message: string;
}> {}

export class TodoRepository extends Context.Tag("ecad/TodoRepository")<
	TodoRepository,
	{
		readonly list: Effect.Effect<ReadonlyArray<Todo>>;
		readonly add: (
			title: string,
		) => Effect.Effect<ReadonlyArray<Todo>, TodoStorageError | TodoInputError>;
		readonly changes: Stream.Stream<ReadonlyArray<Todo>>;
	}
>() {}

export interface TodoFileStorage {
	readonly read: (path: string) => Promise<string | undefined>;
	readonly write: (path: string, contents: string) => Promise<void>;
}

const fileStorage: TodoFileStorage = {
	async read(path) {
		try {
			return await fs.readFile(path, "utf8");
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw cause;
		}
	},
	async write(path, contents) {
		const temporaryPath = `${path}.${randomUUID()}.tmp`;
		try {
			await fs.writeFile(temporaryPath, contents);
			await fs.rename(temporaryPath, path);
		} finally {
			await fs.rm(temporaryPath, { force: true });
		}
	},
};

export const makeTodoRepository = (
	path: string,
	storage: TodoFileStorage = fileStorage,
) =>
	Effect.gen(function* () {
		const contents = yield* Effect.tryPromise({
			try: () => storage.read(path),
			catch: (cause) => new TodoStorageError({ operation: "read", cause }),
		});
		const initial =
			contents === undefined
				? [{ id: 1, title: "Buy groceries" }]
				: yield* Schema.decodeUnknown(Schema.parseJson(TodosSchema))(
						contents,
					).pipe(
						Effect.mapError(
							(cause) => new TodoStorageError({ operation: "read", cause }),
						),
					);
		const state = yield* SubscriptionRef.make<ReadonlyArray<Todo>>(initial);

		return TodoRepository.of({
			list: SubscriptionRef.get(state),
			add: (title) => {
				if (title.trim().length === 0) {
					return Effect.fail(
						new TodoInputError({ message: "Title is required" }),
					);
				}
				// SubscriptionRef serializes writes. Publish only after the file is saved.
				return SubscriptionRef.modifyEffect(state, (current) => {
					const next = [
						...current,
						{ id: Math.max(0, ...current.map((todo) => todo.id)) + 1, title },
					];
					return Effect.tryPromise({
						try: () => storage.write(path, JSON.stringify(next, null, 2)),
						catch: (cause) =>
							new TodoStorageError({ operation: "write", cause }),
					}).pipe(Effect.as([next, next] as const));
				}).pipe(Effect.uninterruptible);
			},
			changes: state.changes,
		});
	});

// Initialization is lazy; all requests share one repository and its subscriptions.
const liveRepository = Effect.runSync(
	Effect.cached(
		makeTodoRepository("./mcp-todos.json").pipe(Effect.uninterruptible),
	),
);
export const TodoRepositoryLive = Layer.effect(TodoRepository, liveRepository);

export const getTodosEffect = Effect.flatMap(
	TodoRepository,
	(repository) => repository.list,
);
export const addTodoEffect = (title: string) =>
	Effect.flatMap(TodoRepository, (repository) => repository.add(title));
export const todoChanges = Stream.unwrap(
	Effect.map(TodoRepository, (repository) => repository.changes),
);

export const getTodos = (signal?: AbortSignal) =>
	runEffect(getTodosEffect.pipe(Effect.provide(TodoRepositoryLive)), signal);
export const addTodo = (title: string, signal?: AbortSignal) =>
	runEffect(
		addTodoEffect(title).pipe(Effect.provide(TodoRepositoryLive)),
		signal,
	);
