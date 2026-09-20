import { initTRPC, TRPCError } from "@trpc/server";
import { Effect } from "effect";
import superjson from "superjson";
import { runEffect } from "#/lib/effect";

const t = initTRPC.create({
	transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const runTRPCEffect = <A, E>(
	program: Effect.Effect<A, E>,
	signal?: AbortSignal,
) =>
	runEffect(
		program.pipe(
			Effect.mapError((cause) =>
				cause instanceof TRPCError
					? cause
					: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
			),
		),
		signal,
	);
