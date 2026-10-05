import { Effect, Schema, Stream } from "effect";
import { HttpClientLive, HttpError, requestJson } from "@ecad/core/lib/http.ts";
import { TodosSchema } from "./todo-schema";

const url = "/demo/api/mcp-todos";

export const submitTodo = (title: string) =>
	requestJson(url, TodosSchema, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title }),
	}).pipe(Effect.provide(HttpClientLive));

export function todoUpdates(
	connect: (url: string) => EventSource = (url) => new EventSource(url),
) {
	return Stream.asyncPush<MessageEvent<string>, HttpError>(
		(emit) =>
			Effect.acquireRelease(
				Effect.try({
					try: () => connect(url),
					catch: (cause) =>
						new HttpError({
							url,
							message: "Unable to subscribe to todos.",
							cause,
						}),
				}),
				(source) => Effect.sync(() => source.close()),
			).pipe(
				Effect.tap((source) =>
					Effect.sync(() => {
						source.onmessage = (event) => {
							emit.single(event);
						};
						source.onerror = () => {
							// EventSource reconnects transient failures itself.
							if (source.readyState === 2) {
								emit.fail(
									new HttpError({ url, message: "Todo updates disconnected." }),
								);
							}
						};
					}),
				),
			),
		{ bufferSize: 1, strategy: "sliding" },
	).pipe(
		Stream.mapEffect((event) =>
			Schema.decodeUnknown(Schema.parseJson(TodosSchema))(event.data).pipe(
				Effect.mapError(
					(cause) =>
						new HttpError({
							url,
							message: "The server sent invalid todo updates.",
							cause,
						}),
				),
			),
		),
	);
}
