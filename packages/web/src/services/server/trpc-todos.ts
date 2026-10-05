import { Context, Data, Effect, Layer, Ref } from "effect";

export interface DemoTodo {
	readonly id: number;
	readonly name: string;
}

export class InvalidTodoName extends Data.TaggedError("InvalidTodoName")<{
	message: string;
}> {}

export class TrpcTodos extends Context.Tag("ecad/TrpcTodos")<
	TrpcTodos,
	{
		readonly list: Effect.Effect<ReadonlyArray<DemoTodo>>;
		readonly add: (name: string) => Effect.Effect<DemoTodo, InvalidTodoName>;
	}
>() {}

export const makeTrpcTodos = (initial: ReadonlyArray<DemoTodo> = []) =>
	Effect.gen(function* () {
		const state = yield* Ref.make(initial);
		return TrpcTodos.of({
			list: Ref.get(state),
			add: (name) =>
				name.trim().length === 0
					? Effect.fail(new InvalidTodoName({ message: "Name is required" }))
					: Ref.modify(state, (todos) => {
							const todo = {
								id: Math.max(0, ...todos.map((item) => item.id)) + 1,
								name,
							};
							return [todo, [...todos, todo]];
						}),
		});
	});

const liveTodos = Effect.runSync(
	makeTrpcTodos([
		{ id: 1, name: "Get groceries" },
		{ id: 2, name: "Buy a new phone" },
		{ id: 3, name: "Finish the project" },
	]),
);
export const TrpcTodosLive = Layer.succeed(TrpcTodos, liveTodos);
export const listTrpcTodos = Effect.flatMap(TrpcTodos, (todos) => todos.list);
export const addTrpcTodo = (name: string) =>
	Effect.flatMap(TrpcTodos, (todos) => todos.add(name));
