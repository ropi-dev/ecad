import BetterSqlite3 from "better-sqlite3";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Context, Data, Effect, Layer } from "effect";
import * as schema from "./schema.ts";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
	operation: "connect" | "query" | "insert";
	cause: unknown;
}> {
	get message() {
		return `Database ${this.operation} failed`;
	}
}

const createDatabase = (client: BetterSqlite3.Database) =>
	drizzle(client, { schema });

export class Database extends Context.Tag("ecad/Database")<
	Database,
	ReturnType<typeof createDatabase>
>() {}

export const makeDatabaseLayer = (
	filename?: string,
	open: (path: string) => BetterSqlite3.Database = (path) =>
		new BetterSqlite3(path),
) =>
	Layer.scoped(
		Database,
		Effect.gen(function* () {
			const client = yield* Effect.acquireRelease(
				Effect.try({
					try: () => {
						const path = filename ?? process.env.DATABASE_URL;
						if (!path)
							throw new Error("DATABASE_URL is required for the database demo");
						return open(path);
					},
					catch: (cause) => new DatabaseError({ operation: "connect", cause }),
				}),
				(client) => Effect.sync(() => client.close()),
			);
			return createDatabase(client);
		}),
	);

// Opening and closing SQLite happens inside each request's Effect scope.
export const DatabaseLive = makeDatabaseLayer();

export const listDatabaseTodos = Effect.flatMap(Database, (db) =>
	Effect.try({
		try: () =>
			db.query.todos
				.findMany({ orderBy: [desc(schema.todos.createdAt)] })
				.sync(),
		catch: (cause) => new DatabaseError({ operation: "query", cause }),
	}),
);

export const insertDatabaseTodo = (title: string) =>
	Effect.flatMap(Database, (db) =>
		Effect.try({
			try: () => db.insert(schema.todos).values({ title }).run(),
			catch: (cause) => new DatabaseError({ operation: "insert", cause }),
		}),
	);
