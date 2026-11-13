import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type {
	DrawingEnvelope,
	DrawingOperation,
	DrawingReply,
} from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { createDrawingMcpServer } from "@ecad/drawing-core/mcp/drawing-server.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Effect } from "effect";
import type { DesktopMcpEndpoint } from "#/bridge.ts";

/** Stays below the editor's 2 MiB command limit. */
export const mcpRequestBodyLimit = 1024 * 1024;
const maxPending = 128;

export class DesktopMcpError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

const disconnected = () =>
	new DesktopMcpError(
		"EditorDisconnected",
		"The editor disconnected. Enable MCP in ECAD again to reconnect.",
	);

interface Pending {
	expiresAt: number;
	complete(reply: DrawingReply): void;
	fail(error: DesktopMcpError): void;
}

export interface DesktopMcpServerOptions {
	/** @return false when no editor window can receive the request. */
	send: (request: DrawingEnvelope) => boolean;
	timeoutMs?: number;
	now?: () => number;
}

function tokenMatches(header: string | undefined, token: string) {
	const supplied = header?.match(/^Bearer (\S+)$/i)?.[1];
	if (!supplied) return false;
	const a = Buffer.from(supplied);
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

function requestHeaders(request: IncomingMessage) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (Array.isArray(value))
			for (const item of value) headers.append(name, item);
		else if (value !== undefined) headers.set(name, value);
	}
	return headers;
}

/**
 * One localhost Streamable HTTP endpoint while MCP is enabled. Tool calls go to the
 * renderer, which runs them against the drawing open in the editor.
 */
export function createDesktopMcpServer({
	send,
	timeoutMs = 15_000,
	now = Date.now,
}: DesktopMcpServerOptions) {
	let server: Server | null = null;
	let endpoint: (DesktopMcpEndpoint & { port: number }) | null = null;
	const pending = new Map<string, Pending>();
	let queue = Promise.resolve();
	const serialized = <T>(run: () => Promise<T>) => {
		const next = queue.then(run);
		queue = next.then(
			() => {},
			() => {},
		);
		return next;
	};

	const execute = (operation: DrawingOperation) =>
		Effect.async<DrawingReply, DesktopMcpError>((resume) => {
			if (!endpoint) {
				resume(Effect.fail(disconnected()));
				return;
			}
			if (pending.size >= maxPending) {
				resume(
					Effect.fail(
						new DesktopMcpError(
							"EditorBusy",
							"Too many commands are waiting for the editor.",
						),
					),
				);
				return;
			}
			const requestId = randomUUID();
			const expiresAt = now() + timeoutMs;
			pending.set(requestId, {
				expiresAt,
				complete: (reply) => resume(Effect.succeed(reply)),
				fail: (error) => resume(Effect.fail(error)),
			});
			if (!send({ requestId, expiresAt, operation })) {
				pending.delete(requestId);
				resume(Effect.fail(disconnected()));
			}
			return Effect.sync(() => {
				pending.delete(requestId);
			});
		}).pipe(
			Effect.timeoutFail({
				duration: timeoutMs,
				onTimeout: () =>
					new DesktopMcpError(
						"EditorTimeout",
						"The editor did not finish the command in time. It may have completed; inspect the drawing before retrying.",
					),
			}),
		);

	function refuse(
		response: ServerResponse,
		status: number,
		code: string,
		message: string,
		headers: Record<string, string> = {},
	) {
		response.writeHead(status, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...headers,
		});
		response.end(JSON.stringify({ error: { code, message } }));
	}

	async function handle(request: IncomingMessage, response: ServerResponse) {
		const current = endpoint;
		if (!current)
			return refuse(response, 503, "McpDisabled", "MCP is disabled in ECAD.");
		const host = request.headers.host;
		if (
			host !== `127.0.0.1:${current.port}` &&
			host !== `localhost:${current.port}`
		)
			return refuse(
				response,
				403,
				"ForbiddenHost",
				"Connect to the MCP URL that ECAD shows.",
			);
		// MCP clients send no Origin; a web page always does.
		if (request.headers.origin !== undefined)
			return refuse(
				response,
				403,
				"ForbiddenOrigin",
				"Web pages cannot use the ECAD MCP endpoint.",
			);
		if (new URL(request.url ?? "/", "http://localhost").pathname !== "/mcp")
			return refuse(response, 404, "NotFound", "The MCP endpoint is /mcp.");
		if (!tokenMatches(request.headers.authorization, current.token))
			return refuse(
				response,
				401,
				"Unauthorized",
				"Use the bearer token that ECAD shows.",
				{ "WWW-Authenticate": "Bearer" },
			);
		if (request.method !== "POST")
			return refuse(
				response,
				405,
				"MethodNotAllowed",
				"The MCP endpoint accepts POST requests.",
				{ Allow: "POST" },
			);
		const abort = new AbortController();
		response.on("close", () => abort.abort());
		const mcp = createDrawingMcpServer(execute);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
			maxRequestBodySize: mcpRequestBodyLimit,
		});
		try {
			await mcp.connect(transport);
			const reply = await transport.handleRequest(
				new Request(`http://${host}${request.url}`, {
					method: request.method,
					headers: requestHeaders(request),
					body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
					duplex: "half",
					signal: abort.signal,
				} as RequestInit),
			);
			const headers = Object.fromEntries(reply.headers);
			headers["cache-control"] = "no-store";
			if (!endpoint) headers.connection = "close";
			response.writeHead(reply.status, headers);
			if (reply.body)
				await pipeline(
					Readable.fromWeb(reply.body as NodeReadableStream<Uint8Array>),
					response,
				);
			else response.end();
		} finally {
			await transport.close().catch(() => {});
			await mcp.close().catch(() => {});
		}
	}

	async function stop() {
		endpoint = null;
		for (const entry of pending.values()) entry.fail(disconnected());
		pending.clear();
		const running = server;
		server = null;
		if (!running) return;
		// Waiting calls just failed; let their replies reach the client first.
		const force = setTimeout(() => running.closeAllConnections(), 1000);
		await new Promise<void>((resolve) => {
			running.close(() => resolve());
			running.closeIdleConnections();
		});
		clearTimeout(force);
	}

	return {
		/** Starts a new endpoint with a new token, ending any earlier one. */
		enable: () =>
			serialized(async (): Promise<DesktopMcpEndpoint> => {
				await stop();
				const next = createServer((request, response) => {
					handle(request, response).catch(() => {
						if (!response.headersSent)
							refuse(response, 500, "InternalError", "The MCP request failed.");
						else response.destroy();
					});
				});
				await new Promise<void>((resolve, reject) => {
					next.once("error", reject);
					next.listen(0, "127.0.0.1", () => {
						next.off("error", reject);
						resolve();
					});
				});
				server = next;
				const { port } = next.address() as AddressInfo;
				endpoint = {
					port,
					url: `http://127.0.0.1:${port}/mcp`,
					token: randomBytes(32).toString("base64url"),
				};
				return { url: endpoint.url, token: endpoint.token };
			}),
		disable: () => serialized(stop),
		/** @return false when the command already timed out or MCP was disabled. */
		reply(requestId: string, reply: DrawingReply) {
			const entry = pending.get(requestId);
			if (!entry || entry.expiresAt <= now()) return false;
			pending.delete(requestId);
			entry.complete(reply);
			return true;
		},
	};
}

export type DesktopMcpServer = ReturnType<typeof createDesktopMcpServer>;
