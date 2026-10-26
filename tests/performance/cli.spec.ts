import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cliExecutable, createCliDrawing, startCli } from "../helpers/cli-mcp.ts";

test("cli-drawing", async ({}, testInfo) => {
	const metrics: Record<string, number> = {};
	const measure = async <T>(name: string, run: () => Promise<T>) => {
		const start = performance.now();
		const result = await run();
		metrics[name] = performance.now() - start;
		return result;
	};
	const help = await measure("startupMs", () => startCli(["--help"], {}, "", { built: true }).result);
	expect(help.code, help.stderr).toBe(0);
	expect(help.stdout).toContain("Usage: ecad");
	const drawing = await createCliDrawing();
	const client = new Client({ name: "cli-performance", version: "1.0.0" });
	const shapes = Array.from({ length: 2000 }, (_, index) => ({
		kind: "rectangle", x: index % 100, y: Math.floor(index / 100),
		width: 5, height: 8, rotation: 0, lineWidth: 0.2,
	}));
	try {
		const placed = await measure("placeMs", () =>
			startCli(["placeShapes", "-"], drawing.env, JSON.stringify({ shapes }), { built: true }).result,
		);
		expect(placed.code, placed.stderr).toBe(0);
		expect(JSON.parse(placed.stdout).structuredContent.drawing.shapes).toHaveLength(2000);
		const read = await measure("readMs", () => startCli(["getDrawing"], drawing.env, "", { built: true }).result);
		expect(read.code, read.stderr).toBe(0);
		expect(JSON.parse(read.stdout).structuredContent.drawing.shapes).toHaveLength(2000);
		const undone = await measure("undoMs", () => startCli(["undo"], drawing.env, "", { built: true }).result);
		expect(undone.code, undone.stderr).toBe(0);
		expect((await drawing.read()).shapes).toHaveLength(0);
		await measure("stdioStartupMs", async () => {
			await client.connect(new StdioClientTransport({
				command: process.execPath,
				args: [cliExecutable, "mcp"],
				env: drawing.env,
			}));
			expect((await client.listTools()).tools).toHaveLength(9);
		});
		const result = await measure("stdioPlaceMs", () =>
			client.callTool({ name: "placeShapes", arguments: { shapes } }),
		);
		expect(result.isError).not.toBe(true);
		expect((await drawing.read()).shapes).toHaveLength(2000);
		await testInfo.attach("performance", {
			body: JSON.stringify({
				scenario: "cli-drawing",
				metrics,
				report: {
					mode: process.env.ECAD_PERF_MODE ?? "production",
					environment: {
						userAgent: `Node/${process.versions.node}`,
						platform: process.platform,
						arch: process.arch,
						cpuThrottle: 1,
					},
					workload: { shapes: shapes.length, storage: "local-files-with-history", transport: "stdio" },
				},
			}),
			contentType: "application/json",
		});
	} finally {
		await client.close();
		await drawing.close();
	}
});
