import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { createEditorMcpHandlers } from "#/services/server/editor-mcp.ts";
import { makeEditorSessionHub } from "#/services/server/editor-sessions.ts";

/** Exercise the app's request handlers through HTTP in the browser fixture server. */
export function editorMcpApi(): Plugin {
	return {
		name: "editor-mcp-test-api",
		configureServer(server) {
			const hub = makeEditorSessionHub();
			const handlers = createEditorMcpHandlers(hub);
			server.httpServer?.once("close", () => hub.dispose());
			server.middlewares.use((request, response, next) => {
				const url = new URL(
					request.url ?? "/",
					`http://${request.headers.host}`,
				);
				const editor = url.pathname.match(/^\/api\/editor-mcp\/([^/]+)$/);
				const mcp = url.pathname.match(/^\/mcp\/editor\/([^/]+)$/);
				const handle =
					url.pathname === "/api/editor-mcp"
						? (input: Request) =>
								handlers.createSession(input, request.socket.remoteAddress)
						: editor
							? (input: Request) => handlers.session(input, editor[1])
							: mcp
								? (input: Request) => handlers.mcp(input, mcp[1])
								: undefined;
				if (!handle) return next();
				void forwardRequest(request, response, url, handle).catch((error) => {
					if (response.destroyed) return;
					if (response.headersSent) response.destroy(error);
					else {
						response.statusCode = 500;
						response.end(
							error instanceof Error ? error.message : String(error),
						);
					}
				});
			});
		},
	};
}

async function forwardRequest(
	incoming: IncomingMessage,
	outgoing: ServerResponse,
	url: URL,
	handle: (request: Request) => Response | Promise<Response>,
) {
	const abort = new AbortController();
	const disconnect = () => abort.abort();
	incoming.once("aborted", disconnect);
	outgoing.once("close", disconnect);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const cancel = () => void reader?.cancel().catch(() => {});
	abort.signal.addEventListener("abort", cancel, { once: true });
	try {
		const headers = new Headers();
		for (let index = 0; index < incoming.rawHeaders.length; index += 2)
			headers.append(
				incoming.rawHeaders[index],
				incoming.rawHeaders[index + 1],
			);
		const chunks: Buffer[] = [];
		for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
		const request = new Request(url, {
			method: incoming.method,
			headers,
			signal: abort.signal,
			...(chunks.length > 0
				? { body: new Uint8Array(Buffer.concat(chunks)) }
				: {}),
		});
		const response = await handle(request);
		outgoing.writeHead(response.status, Object.fromEntries(response.headers));
		outgoing.flushHeaders();
		reader = response.body?.getReader();
		while (reader && !abort.signal.aborted) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!outgoing.write(value))
				await once(outgoing, "drain", { signal: abort.signal });
		}
		outgoing.end();
	} finally {
		await reader?.cancel().catch(() => {});
		reader?.releaseLock();
		incoming.off("aborted", disconnect);
		outgoing.off("close", disconnect);
		abort.signal.removeEventListener("abort", cancel);
	}
}
