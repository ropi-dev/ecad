import { Context, Data, Effect, Layer, Schema, type Scope } from "effect";

export class HttpError extends Data.TaggedError("HttpError")<{
	readonly url: string;
	readonly message: string;
	readonly status?: number;
	readonly cause?: unknown;
}> {}

export class HttpClient extends Context.Tag("ecad/HttpClient")<
	HttpClient,
	{
		readonly request: (
			url: string,
			options?: Omit<RequestInit, "signal">,
		) => Effect.Effect<Response, HttpError, Scope.Scope>;
	}
>() {}

/** Inject fetch in tests; cancellation always belongs to the executing Effect. */
export function makeHttpClient(
	fetcher: typeof fetch,
): typeof HttpClient.Service {
	return {
		request: (url, options) =>
			Effect.gen(function* () {
				const controller = yield* Effect.acquireRelease(
					Effect.sync(() => new AbortController()),
					(controller) => Effect.sync(() => controller.abort()),
				);
				return yield* Effect.tryPromise({
					try: (signal) =>
						fetcher(url, {
							...options,
							signal: AbortSignal.any([signal, controller.signal]),
						}),
					catch: (cause) =>
						new HttpError({
							url,
							message: "Unable to reach the server.",
							cause,
						}),
				});
			}),
	};
}

export const HttpClientLive = Layer.succeed(
	HttpClient,
	makeHttpClient((...args) => fetch(...args)),
);

export function requestJson<A, I>(
	url: string,
	schema: Schema.Schema<A, I>,
	options?: Omit<RequestInit, "signal">,
) {
	return Effect.gen(function* () {
		const client = yield* HttpClient;
		const response = yield* client.request(url, options);
		if (!response.ok) {
			return yield* new HttpError({
				url,
				status: response.status,
				message: `Request failed (${response.status}).`,
			});
		}
		const body = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: (cause) =>
				new HttpError({
					url,
					message: "The server returned invalid JSON.",
					cause,
				}),
		});
		return yield* Schema.decodeUnknown(schema)(body).pipe(
			Effect.mapError(
				(cause) =>
					new HttpError({
						url,
						message: "The server returned invalid data.",
						cause,
					}),
			),
		);
	}).pipe(Effect.scoped);
}
