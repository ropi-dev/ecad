import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	createLocalDrawingMcpServer,
	type LocalDrawingOptions,
} from "./drawing.ts";

// Whitespace, control characters and format characters such as bidirectional
// overrides, which a terminal would interpret.
const unsafeText = /[\s\p{Cc}\p{Cf}]+/gu;

// Schema failures carry every union branch, so summarize them in one line.
// Other messages can quote a whole input message, so shorten them and make
// them safe to print.
function describeMcpError(cause: Error) {
	if (cause.name === "ZodError")
		return "Ignored a message that is not valid JSON-RPC.";
	const message = cause.message.replace(unsafeText, " ");
	return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

// Waits until replies already handed to the output are written, so a failed
// write still fails the command. An abort stops the wait.
async function flushOutput(output: Writable, signal?: AbortSignal) {
	if (output.destroyed || output.writableLength === 0 || signal?.aborted)
		return;
	const controller = new AbortController();
	await new Promise<void>((resolve) => {
		signal?.addEventListener("abort", () => resolve(), {
			once: true,
			signal: controller.signal,
		});
		output.write("", () => resolve());
	});
	controller.abort();
}

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
	let stopping = false;
	let failure: Error | undefined;
	let resolve!: () => void;
	const stopped = new Promise<void>((done) => {
		resolve = done;
	});
	const finish = () => {
		stopping = true;
		resolve();
	};
	// A stream can fail after another event already started the shutdown, so
	// the failure is kept and reported once the server has closed.
	const fail = (cause: Error) => {
		failure ??= cause;
		finish();
	};
	// The transport closes itself only after input it cannot recover from,
	// such as an oversized message.
	server.server.onclose = () => {
		if (!stopping)
			fail(new Error("The MCP transport closed after an input error."));
	};
	// The SDK also reports recoverable problems here, such as a malformed
	// input line. Log them and keep serving; stdout carries only MCP messages.
	server.server.onerror = (cause) => {
		if (!stopping && error.writable)
			error.write(`ecad: MCP error: ${describeMcpError(cause)}\n`);
	};
	// Stderr only carries diagnostics, so losing it must not stop the server.
	const ignore = () => {};
	error.on("error", ignore);
	input.once("end", finish);
	input.once("close", finish);
	input.on("error", fail);
	output.on("error", fail);
	signal?.addEventListener("abort", finish, { once: true });
	try {
		await server.connect(new StdioServerTransport(input, output));
		if (input.readableEnded || input.destroyed || signal?.aborted) finish();
		await stopped;
	} finally {
		input.off("end", finish);
		input.off("close", finish);
		signal?.removeEventListener("abort", finish);
		await server.close();
		await flushOutput(output, signal);
		input.off("error", fail);
		output.off("error", fail);
		error.off("error", ignore);
	}
	if (failure) throw failure;
}
