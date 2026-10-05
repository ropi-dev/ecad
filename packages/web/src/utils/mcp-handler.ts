import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type JSONRPCMessage,
	JSONRPCMessageSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Data, Effect } from "effect";
import { runEffect } from "@ecad/core/lib/effect.ts";

export class McpRequestError extends Data.TaggedError("McpRequestError")<{
	message: string;
	code: number;
	status: number;
	cause?: unknown;
	id?: string | number;
}> {}

interface McpRequestOptions {
	timeoutMs?: number;
	createTransports?: typeof InMemoryTransport.createLinkedPair;
}

const transportError = (cause: unknown, id?: string | number) =>
	new McpRequestError({
		message: "MCP request failed",
		code: -32603,
		status: 500,
		cause,
		id,
	});

const closeResources = (closers: ReadonlyArray<() => Promise<void>>) =>
	Effect.forEach(
		closers,
		(close) =>
			Effect.tryPromise({ try: close, catch: transportError }).pipe(
				Effect.catchAll((error) =>
					Effect.logWarning("MCP cleanup failed", error),
				),
			),
		{ discard: true },
	);

export const handleMcpRequestEffect = (
	request: Request,
	createServer: () => McpServer,
	options: McpRequestOptions = {},
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const body = yield* Effect.tryPromise({
				try: () => request.json(),
				catch: (cause) =>
					new McpRequestError({
						message: "Invalid JSON",
						code: -32700,
						status: 400,
						cause,
					}),
			});
			const parsed = JSONRPCMessageSchema.safeParse(body);
			if (!parsed.success || !("method" in parsed.data)) {
				return yield* Effect.fail(
					new McpRequestError({
						message: "Invalid request",
						code: -32600,
						status: 400,
					}),
				);
			}
			const message = parsed.data;
			const requestId = "id" in message ? message.id : undefined;
			const onFailure = (cause: unknown) => transportError(cause, requestId);
			const server = yield* Effect.acquireRelease(
				Effect.try({ try: createServer, catch: onFailure }),
				(server) => closeResources([() => server.close()]),
			);
			const [client, serverTransport] = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						(options.createTransports ?? InMemoryTransport.createLinkedPair)(),
					catch: onFailure,
				}),
				([client, serverTransport]) =>
					closeResources([() => serverTransport.close(), () => client.close()]),
			);
			yield* Effect.tryPromise({
				try: async () => {
					await server.connect(serverTransport);
					await client.start();
				},
				catch: onFailure,
			});

			if (!("id" in message)) {
				yield* Effect.tryPromise({
					try: () => client.send(message),
					catch: onFailure,
				});
				return new Response(null, { status: 202 });
			}

			const response = yield* Effect.async<JSONRPCMessage, McpRequestError>(
				(resume) => {
					client.onmessage = (response) => {
						if (
							"id" in response &&
							response.id === message.id &&
							!("method" in response)
						) {
							resume(Effect.succeed(response));
						}
					};
					client.onerror = (cause) => resume(Effect.fail(onFailure(cause)));
					client.onclose = () =>
						resume(
							Effect.fail(
								onFailure(new Error("Transport closed before a response")),
							),
						);
					void client
						.send(message)
						.catch((cause) => resume(Effect.fail(onFailure(cause))));
					return Effect.sync(() => {
						client.onmessage = undefined;
						client.onerror = undefined;
						client.onclose = undefined;
					});
				},
			).pipe(
				Effect.timeoutFail({
					duration: options.timeoutMs ?? 30_000,
					onTimeout: () =>
						new McpRequestError({
							message: "MCP request timed out",
							code: -32603,
							status: 504,
							id: requestId,
						}),
				}),
			);
			return Response.json(response);
		}),
	).pipe(
		Effect.catchTag("McpRequestError", (error) =>
			Effect.succeed(
				Response.json(
					{
						jsonrpc: "2.0",
						error: { code: error.code, message: error.message },
						id: error.id ?? null,
					},
					{ status: error.status },
				),
			),
		),
	);

export const handleMcpRequest = (
	request: Request,
	createServer: () => McpServer,
	options?: McpRequestOptions,
): Promise<Response> =>
	runEffect(
		handleMcpRequestEffect(request, createServer, options),
		request.signal,
	);
