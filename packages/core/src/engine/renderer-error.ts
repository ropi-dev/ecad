import { Data } from "effect";

export class RendererError extends Data.TaggedError("RendererError")<{
	message: string;
	cause: unknown;
}> {}

export function rendererError(cause: unknown): RendererError {
	return new RendererError({
		message: cause instanceof Error ? cause.message : String(cause),
		cause,
	});
}
