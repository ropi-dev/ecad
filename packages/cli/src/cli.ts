import { addAbortSignal, type Readable, type Writable } from "node:stream";
import { parseArgs } from "node:util";

const help = `Usage: ecad [options] <command> [json|-]

Commands:
  tools                    List all drawing tools and their JSON schemas
  <tool> [json|-]           Call any tool by its MCP name
  call <tool> [json|-]      Call a tool whose name conflicts with a CLI command
  mcp                      Start a standalone MCP stdio server

Options:
  --drawing <path>         Drawing file, or ECAD_DRAWING, default drawing.ecaddraw
  --timeout <ms>           File lock timeout in milliseconds, default 30000
  -h, --help               Show this help
  -v, --version            Show the CLI version

Commands read and edit a local drawing. A missing file starts an empty drawing.
Successful edits save the drawing and its undo history across invocations.
Tool arguments are a JSON object, defaulting to {}. Use - to read JSON from stdin.
Tool results are JSON on stdout. Failures set exit code 1; diagnostics use stderr.
The mcp command reserves stdout for MCP messages.
`;

export interface CliOptions {
	env?: NodeJS.ProcessEnv;
	input?: Readable;
	output?: Writable;
	error?: Writable;
	signal?: AbortSignal;
}

export async function runCli(args: string[], options: CliOptions = {}) {
	const {
		env = process.env,
		input = process.stdin,
		output = process.stdout,
		error = process.stderr,
		signal,
	} = options;
	try {
		const { values, positionals } = parseArgs({
			args,
			allowPositionals: true,
			options: {
				drawing: { type: "string" },
				timeout: { type: "string", default: "30000" },
				help: { type: "boolean", short: "h" },
				version: { type: "boolean", short: "v" },
			},
		});
		if (values.version) {
			output.write("0.0.0\n");
			return 0;
		}
		if (values.help || positionals.length === 0) {
			output.write(help);
			return 0;
		}
		const [command, ...rest] = positionals;
		const tool = command === "call" ? rest.shift() : command;
		if (!tool) throw new Error("Expected a tool name after call.");
		const special = command === "tools" || command === "mcp";
		if (rest.length > (special ? 0 : 1)) {
			throw new Error(
				"Unexpected arguments. Pass one JSON object or - for stdin.",
			);
		}
		let toolArguments: Record<string, unknown> = {};
		if (!special && rest.length > 0) {
			let json = rest[0];
			if (json === "-") {
				if (signal) addAbortSignal(signal, input);
				const chunks: Buffer[] = [];
				for await (const chunk of input) chunks.push(Buffer.from(chunk));
				json = Buffer.concat(chunks).toString("utf8");
			}
			const parsed: unknown = JSON.parse(json);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("Tool arguments must be a JSON object.");
			}
			toolArguments = parsed as Record<string, unknown>;
		}
		const timeout = Number(values.timeout);
		if (!Number.isSafeInteger(timeout) || timeout <= 0)
			throw new Error(
				"The timeout must be a positive integer in milliseconds.",
			);
		const drawing = {
			path: values.drawing ?? (env.ECAD_DRAWING || undefined),
			lockTimeout: timeout,
		};
		if (command === "mcp") {
			const { serveStdioMcp } = await import("./stdio.ts");
			await serveStdioMcp({ ...drawing, input, output, signal });
			return 0;
		}
		const { createLocalClient } = await import("./local-client.ts");
		const session = await createLocalClient(drawing);
		const { client } = session;
		try {
			const tools = await client.listTools({}, { signal });
			if (command === "tools") {
				output.write(`${JSON.stringify(tools)}\n`);
				return 0;
			}
			if (!tools.tools.some((entry) => entry.name === tool)) {
				throw new Error(
					`Unknown MCP tool: ${tool}. Run ecad tools to list tools.`,
				);
			}
			const result = await client.callTool(
				{ name: tool, arguments: toolArguments },
				undefined,
				{ timeout: timeout + 30_000, signal },
			);
			output.write(`${JSON.stringify(result)}\n`);
			return result.isError ? 1 : 0;
		} finally {
			await session.close();
		}
	} catch (cause) {
		error.write(
			`ecad: ${cause instanceof Error ? cause.message : String(cause)}\n`,
		);
		return 1;
	}
}
