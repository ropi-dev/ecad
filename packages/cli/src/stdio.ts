import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	createLocalDrawingMcpServer,
	type LocalDrawingOptions,
} from "./drawing.ts";

export async function serveStdioMcp(
	options: LocalDrawingOptions & {
		input: Readable;
		output: Writable;
		signal?: AbortSignal;
	},
) {
	const { input, output, signal } = options;
	signal?.throwIfAborted();
	const server = createLocalDrawingMcpServer(options);
	let finish!: () => void;
	let fail!: (error: Error) => void;
	const stopped = new Promise<void>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	server.server.onclose = finish;
	server.server.onerror = fail;
	input.once("end", finish);
	input.once("close", finish);
	output.once("error", fail);
	signal?.addEventListener("abort", finish, { once: true });
	try {
		await server.connect(new StdioServerTransport(input, output));
		if (input.readableEnded || input.destroyed || signal?.aborted) finish();
		await stopped;
	} finally {
		input.off("end", finish);
		input.off("close", finish);
		output.off("error", fail);
		signal?.removeEventListener("abort", finish);
		await server.close();
	}
}
