import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { Effect } from "effect";
import { z } from "zod";
import {
	addTrpcTodo,
	listTrpcTodos,
	TrpcTodosLive,
} from "#/services/server/trpc-todos.ts";
import { createTRPCRouter, publicProcedure, runTRPCEffect } from "./init";

const todosRouter = {
	list: publicProcedure.query(({ signal }) =>
		runTRPCEffect(listTrpcTodos.pipe(Effect.provide(TrpcTodosLive)), signal),
	),
	add: publicProcedure
		.input(z.object({ name: z.string() }))
		.mutation(({ input, signal }) =>
			runTRPCEffect(
				addTrpcTodo(input.name).pipe(
					Effect.provide(TrpcTodosLive),
					Effect.mapError(
						(error) =>
							new TRPCError({
								code: "BAD_REQUEST",
								message: error.message,
								cause: error,
							}),
					),
				),
				signal,
			),
		),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({ todos: todosRouter });
export type TRPCRouter = typeof trpcRouter;
