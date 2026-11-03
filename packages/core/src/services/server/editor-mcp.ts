import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Effect } from "effect";
import { z } from "zod";
import { runEffect } from "#/lib/effect.ts";
import { drawingReplySchema } from "#/mcp/drawing-protocol.ts";
import { createDrawingMcpServer } from "#/mcp/drawing-server.ts";
import {
	editorClientAddress,
	editorClientKey,
	requestPeerAddress,
	trustedProxyHopsFromEnv,
} from "#/services/server/client-address.ts";
import {
	EditorSessionError,
	type EditorSessionHub,
	makeEditorSessionHub,
} from "#/services/server/editor-sessions.ts";

/** Editor replies carry the whole committed drawing and its history entries. */
export const editorReplyBodyLimit = 8 * 1024 * 1024;
/** Stays below the editor's 2 MiB command limit, so a large call cannot break the stream. */
export const mcpRequestBodyLimit = 1024 * 1024;
/** Session creation, stream, and disconnect requests carry no body; extra bytes are discarded. */
const emptyBodyLimit = 1024;

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

const forbiddenOrigin = () =>
	new EditorSessionError({
		code: "ForbiddenOrigin",
		message: "Cross-origin editor access is not allowed.",
		status: 403,
	});

/**
 * Editor endpoints are only called by the app's own page, so they need positive evidence of
 * a same-origin browser request. Browsers send `Origin` on POST and DELETE, and
 * `Sec-Fetch-Site` on every request from a secure context, including the GET stream.
 */
function requireSameOrigin(request: Request) {
	const origin = request.headers.get("origin");
	const site = request.headers.get("sec-fetch-site");
	const sameOrigin =
		origin === null
			? site === "same-origin"
			: origin === new URL(request.url).origin &&
				(site === null || site === "same-origin");
	if (!sameOrigin) throw forbiddenOrigin();
}

/** MCP clients usually send no `Origin`; the MCP token authenticates them. */
function rejectCrossOrigin(request: Request) {
	const origin = request.headers.get("origin");
	if (origin !== null && origin !== new URL(request.url).origin)
		throw forbiddenOrigin();
}

const payloadTooLarge = (limit: number) =>
	new EditorSessionError({
		code: "PayloadTooLarge",
		message: `The request body must not exceed ${limit} bytes.`,
		status: 413,
	});

function checkDeclaredLength(request: Request, limit: number) {
	if (Number(request.headers.get("content-length")) > limit)
		throw payloadTooLarge(limit);
}

/** Reads at most `limit` bytes, whether or not the client declared a length. */
async function readBody(request: Request, limit: number) {
	checkDeclaredLength(request, limit);
	if (!request.body) {
		// Node adapters expose no body for GET even when chunked bytes follow; they can't be counted.
		if (request.headers.has("transfer-encoding")) throw payloadTooLarge(limit);
		return "";
	}
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > limit) {
				reader.cancel().catch(() => {});
				throw payloadTooLarge(limit);
			}
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
	return text + decoder.decode();
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

export interface EditorMcpHandlerOptions {
	/** Reverse proxies trusted to append to `X-Forwarded-For`; defaults to `ECAD_TRUSTED_PROXY_HOPS`. */
	trustedProxyHops?: number;
	editorReplyLimit?: number;
	mcpRequestLimit?: number;
}

/** HTTP and MCP adapters share a relay; the browser remains the drawing authority. */
export function createEditorMcpHandlers(
	hub = liveHub,
	{
		trustedProxyHops,
		editorReplyLimit = editorReplyBodyLimit,
		mcpRequestLimit = mcpRequestBodyLimit,
	}: EditorMcpHandlerOptions = {},
) {
	return {
		/** `peerAddress` is the connecting address; it defaults to the runtime's `request.ip`. */
		async createSession(
			request: Request,
			peerAddress = requestPeerAddress(request),
		): Promise<Response> {
			try {
				requireSameOrigin(request);
				if (request.method !== "POST") return methodNotAllowed("POST");
				await readBody(request, emptyBodyLimit);
				const address = editorClientAddress(
					request,
					peerAddress,
					trustedProxyHops ?? trustedProxyHopsFromEnv(),
				);
				return Response.json(hub.create(editorClientKey(address)), {
					status: 201,
					headers,
				});
			} catch (error) {
				return errorResponse(error);
			}
		},
		async session(request: Request, sessionId: string): Promise<Response> {
			try {
				requireSameOrigin(request);
				hub.authorize(sessionId, bearer(request), "editor");
				if (request.method === "GET" || request.method === "DELETE")
					await readBody(request, emptyBodyLimit);
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
					body = JSON.parse(await readBody(request, editorReplyLimit));
				} catch (error) {
					if (error instanceof EditorSessionError) throw error;
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
				rejectCrossOrigin(request);
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
											maxRequestBodySize: mcpRequestLimit,
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
