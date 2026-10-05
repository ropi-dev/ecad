import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

/** Execute only at a framework boundary, preserving domain errors and cancellation. */
export async function runEffect<A, E>(
	program: Effect.Effect<A, E>,
	signal?: AbortSignal,
): Promise<A> {
	signal?.throwIfAborted();
	const exit = await Effect.runPromiseExit(program, { signal });
	if (Exit.isSuccess(exit)) return exit.value;
	if (Cause.isInterruptedOnly(exit.cause) && signal?.aborted) {
		throw signal.reason;
	}
	throw Cause.squash(exit.cause);
}
