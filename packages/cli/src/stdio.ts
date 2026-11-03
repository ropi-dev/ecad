import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	createLocalDrawingMcpServer,
	type LocalDrawingOptions,
} from "./drawing.ts";

// Schema failures carry every union branch, so summarize them in one line.
const describeMcpError = (cause: Error) =>
	cause.name === "ZodError"
		? "Ignored a message that is not valid JSON-RPC."
		: cause.message.replace(/\s*\n\s*/g, " ");

export async function serveStdioMcp(
	options: LocalDrawingOptions & {
		input: Readable;
		output: Writable;
		error?: Writable;
		signal?: AbortSignal;
	},
) {
	const { input, output, error = process.stderr, signal } = options;
	signal?.throwIfAborted();
	const server = createLocalDrawingMcpServer(options);
	let failed = false;
	let finish!: () => void;
	let reject!: (cause: Error) => void;
	const stopped = new Promise<void>((resolve, fail) => {
		finish = resolve;
		reject = fail;
	});
	// A stream failure can arrive before the server is awaited.
	stopped.catch(() => {});
	const fail = (cause: Error) => {
		failed = true;
		reject(cause);
	};
	server.server.onclose = finish;
	// The SDK also reports recoverable problems here, such as a malformed
	// input line. Log them and keep serving; stdout carries only MCP messages.
	server.server.onerror = (cause) => {
		if (!failed) error.write(`ecad: MCP error: ${describeMcpError(cause)}\n`);
	};
	input.once("end", finish);
	input.once("close", finish);
	input.once("error", fail);
	output.once("error", fail);
	signal?.addEventListener("abort", finish, { once: true });
	try {
		await server.connect(new StdioServerTransport(input, output));
		if (input.readableEnded || input.destroyed || signal?.aborted) finish();
		await stopped;
	} finally {
		input.off("end", finish);
		input.off("close", finish);
		input.off("error", fail);
		output.off("error", fail);
		signal?.removeEventListener("abort", finish);
		await server.close();
	}
}
