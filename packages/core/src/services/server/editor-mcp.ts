import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Effect } from "effect";
import { z } from "zod";
import { runEffect } from "#/lib/effect.ts";
import { drawingReplySchema } from "#/mcp/drawing-protocol.ts";
import { createDrawingMcpServer } from "#/mcp/drawing-server.ts";
import {
	EditorSessionError,
	type EditorSessionHub,
	makeEditorSessionHub,
} from "#/services/server/editor-sessions.ts";

const liveHub = makeEditorSessionHub();
const replySchema = z
	.object({ requestId: z.string().uuid(), reply: drawingReplySchema })
	.strict();
const bearer = (request: Request) =>
	request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
const headers = { "Cache-Control": "no-store" };

function errorResponse(error: unknown) {
	if (error instanceof EditorSessionError)
		return Response.json(
			{ error: { code: error.code, message: error.message } },
			{
				status: error.status,
				headers: {
					...headers,
					...(error.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
				},
			},
		);
	return Response.json(
		{
			error: {
				code: "InternalError",
				message: "The editor connection failed.",
			},
		},
		{ status: 500, headers },
	);
}

function checkOrigin(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin)
		throw new EditorSessionError({
			code: "ForbiddenOrigin",
			message: "Cross-origin editor access is not allowed.",
			status: 403,
		});
}

function methodNotAllowed(allow: string) {
	return new Response(null, {
		status: 405,
		headers: { ...headers, Allow: allow },
	});
}

function openEditorStream(
	request: Request,
	hub: EditorSessionHub,
	sessionId: string,
) {
	const encoder = new TextEncoder();
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let stopped = false;
	let disconnect: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(heartbeat);
		request.signal.removeEventListener("abort", stop);
		disconnect?.();
		try {
			controller.close();
		} catch {
			/* The reader may already have cancelled. */
		}
	};
	const stream = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
		},
		cancel: stop,
	});
	// Authorize the single consumer before returning a successful streaming response.
	disconnect = hub.connect(sessionId, bearer(request), {
		send: (envelope) =>
			controller.enqueue(encoder.encode(`${JSON.stringify(envelope)}\n`)),
		close: stop,
	});
	controller.enqueue(encoder.encode("\n"));
	heartbeat = setInterval(
		() => controller.enqueue(encoder.encode("\n")),
		15_000,
	);
	if (request.signal.aborted) stop();
	else request.signal.addEventListener("abort", stop, { once: true });
	return new Response(stream, {
		headers: {
			...headers,
			"Content-Type": "application/x-ndjson",
			"X-Accel-Buffering": "no",
		},
	});
}

/** HTTP and MCP adapters share a relay; the browser remains the drawing authority. */
export function createEditorMcpHandlers(hub = liveHub) {
	return {
		async createSession(request: Request): Promise<Response> {
			try {
				checkOrigin(request);
				if (request.method !== "POST") return methodNotAllowed("POST");
				return Response.json(hub.create(), { status: 201, headers });
			} catch (error) {
				return errorResponse(error);
			}
		},
		async session(request: Request, sessionId: string): Promise<Response> {
			try {
				checkOrigin(request);
				hub.authorize(sessionId, bearer(request), "editor");
				if (request.method === "GET")
					return openEditorStream(request, hub, sessionId);
				if (request.method === "DELETE") {
					hub.disconnect(sessionId, bearer(request));
					return new Response(null, { status: 204, headers });
				}
				if (request.method !== "POST")
					return methodNotAllowed("GET, POST, DELETE");
				let body: unknown;
				try {
					body = await request.json();
				} catch {
					throw new EditorSessionError({
						code: "InvalidReply",
						message: "The editor reply must be JSON.",
						status: 400,
					});
				}
				const parsed = replySchema.safeParse(body);
				if (!parsed.success)
					throw new EditorSessionError({
						code: "InvalidReply",
						message: "The editor reply is invalid.",
						status: 400,
					});
				hub.acknowledge(
					sessionId,
					bearer(request),
					parsed.data.requestId,
					parsed.data.reply,
				);
				return new Response(null, { status: 204, headers });
			} catch (error) {
				return errorResponse(error);
			}
		},
		async mcp(request: Request, sessionId: string): Promise<Response> {
			try {
				checkOrigin(request);
				hub.authorize(sessionId, bearer(request), "mcp");
				if (request.method !== "POST") return methodNotAllowed("POST");
				return await runEffect(
					Effect.scoped(
						Effect.gen(function* () {
							const server = yield* Effect.acquireRelease(
								Effect.sync(() =>
									createDrawingMcpServer((operation) =>
										hub.request(sessionId, operation),
									),
								),
								(server) =>
									Effect.promise(() => server.close()).pipe(Effect.ignore),
							);
							const transport = yield* Effect.acquireRelease(
								Effect.sync(
									() =>
										new WebStandardStreamableHTTPServerTransport({
											sessionIdGenerator: undefined,
											enableJsonResponse: true,
										}),
								),
								(transport) =>
									Effect.promise(() => transport.close()).pipe(Effect.ignore),
							);
							yield* Effect.promise(() => server.connect(transport));
							const response = yield* Effect.promise(() =>
								transport.handleRequest(request),
							);
							response.headers.set("Cache-Control", "no-store");
							return response;
						}),
					),
					request.signal,
				);
			} catch (error) {
				return errorResponse(error);
			}
		},
	};
}

export const editorMcpHandlers = createEditorMcpHandlers();
