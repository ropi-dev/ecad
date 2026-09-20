import { Schema } from "effect";

export const TodoSchema = Schema.Struct({
	id: Schema.Number,
	title: Schema.String,
});
export const TodosSchema = Schema.Array(TodoSchema);
export type Todo = typeof TodoSchema.Type;
