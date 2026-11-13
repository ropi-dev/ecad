import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import { runDrawingRequest } from "@ecad/core/mcp/editor-connection.ts";
import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	type DrawingEnvelope,
	drawingReplySchema,
} from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDesktopMcpServer } from "#/main/mcp-server.ts";

async function connect(url: string, token: string) {
	const client = new Client({ name: "ecad-desktop-test", version: "1.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { Authorization: `Bearer ${token}` } },
		}),
	);
	return client;
}

function post(
	url: string,
	headers: Record<string, string>,
	method = "POST",
): Promise<number> {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const request = httpRequest(
			{
				host: target.hostname,
				port: target.port,
				path: target.pathname,
				method,
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					...headers,
				},
			},
			(response) => {
				response.resume();
				resolve(response.statusCode ?? 0);
			},
		);
		request.on("error", reject);
		request.end(
			method === "POST"
				? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
				: undefined,
		);
	});
}

test("tool calls run in the editor that receives them and return its reply", async () => {
	const store = createDrawingStore();
	const sent: DrawingEnvelope[] = [];
	const server = createDesktopMcpServer({
		send: (request) => {
			sent.push(request);
			void runDrawingRequest(store, request).then((reply) =>
				server.reply(request.requestId, reply),
			);
			return true;
		},
	});
	const { url, token } = await server.enable();
	assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
	const client = await connect(url, token);
	try {
		const placed = await client.callTool({
			name: "placeRectangle",
			arguments: {
				x: 10,
				y: 5,
				width: 20,
				height: 10,
				rotation: 0,
				lineWidth: 0.2,
			},
		});
		assert.notEqual(placed.isError, true);
		assert.equal(store.getSnapshot().shapes.length, 1);
		const read = drawingReplySchema.parse(
			(await client.callTool({ name: "getDrawing", arguments: {} }))
				.structuredContent,
		);
		assert.equal(read.ok && read.drawing?.shapes.length, 1);
		assert.deepEqual(
			sent.map((request) => request.operation.type),
			["placeRectangle", "getDrawing"],
		);
	} finally {
		await client.close();
		await server.disable();
	}
});

test("the endpoint refuses requests without the token, from web pages, or for another host", async () => {
	const server = createDesktopMcpServer({ send: () => true });
	const { url, token } = await server.enable();
	const port = new URL(url).port;
	const authorization = `Bearer ${token}`;
	try {
		assert.equal(await post(url, {}), 401);
		assert.equal(await post(url, { Authorization: "Bearer wrong" }), 401);
		assert.equal(
			await post(url, {
				Authorization: authorization,
				Origin: "https://example.com",
			}),
			403,
		);
		assert.equal(
			await post(url, {
				Authorization: authorization,
				Host: `attacker.example:${port}`,
			}),
			403,
		);
		assert.equal(await post(url.replace(/\/mcp$/, "/other"), {}), 404);
		assert.equal(await post(url, { Authorization: authorization }, "GET"), 405);
		assert.equal(await post(url, { Authorization: authorization }), 200);

		const next = await server.enable();
		assert.notEqual(next.token, token);
		assert.equal(
			await post(next.url, { Authorization: authorization }).catch(() => 401),
			401,
		);
		assert.equal(
			await post(next.url, { Authorization: `Bearer ${next.token}` }),
			200,
		);
	} finally {
		await server.disable();
	}
});

test("disabling MCP fails waiting commands and closes the endpoint", async () => {
	let delivered!: () => void;
	const arrived = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	const server = createDesktopMcpServer({
		send: () => {
			delivered();
			return true;
		},
	});
	const { url, token } = await server.enable();
	const client = await connect(url, token);
	const call = client.callTool({ name: "getDrawing", arguments: {} });
	await arrived;
	await server.disable();
	const result = drawingReplySchema.parse((await call).structuredContent);
	assert.equal(result.ok, false);
	assert.equal(!result.ok && result.error.code, "EditorDisconnected");
	await assert.rejects(post(url, { Authorization: `Bearer ${token}` }));
	await client.close().catch(() => {});
});

test("a command the editor does not answer in time fails, and a late reply is ignored", async () => {
	let requestId = "";
	const server = createDesktopMcpServer({
		timeoutMs: 50,
		send: (request) => {
			requestId = request.requestId;
			return true;
		},
	});
	const { url, token } = await server.enable();
	const client = await connect(url, token);
	try {
		const result = drawingReplySchema.parse(
			(await client.callTool({ name: "getDrawing", arguments: {} }))
				.structuredContent,
		);
		assert.equal(!result.ok && result.error.code, "EditorTimeout");
		assert.equal(
			server.reply(requestId, {
				ok: false,
				error: { code: "Late", message: "Late" },
			}),
			false,
		);
	} finally {
		await client.close();
		await server.disable();
	}
});
