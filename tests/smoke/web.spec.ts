import { drawingReplySchema } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, type Page, test } from "@playwright/test";
import { openProjectFiles, projectRail } from "../browser/project-files.ts";
import { toolbarButton } from "../browser/toolbar.ts";

// Runs against `vite build` output served by `vite preview`, the same server
// the production deployment uses for its server routes.

const saves = (page: Page) =>
	page.evaluate(
		() =>
			window.__ecadPerformance?.snapshot().metrics["project.save"]?.count ?? 0,
	);

async function editorReady(page: Page) {
	await page.waitForFunction(
		() =>
			document
				.querySelector("h1")
				?.textContent?.startsWith("Schematic editor ·") &&
			document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')
				?.disabled === false &&
			!document.querySelector('[aria-busy="true"]'),
		undefined,
		{ polling: "raf", timeout: 30_000 },
	);
}

async function connectMcp(page: Page) {
	await projectRail(page)
		.getByRole("button", { name: "Enable MCP", exact: true })
		.click();
	await expect(
		page.getByText("Connected to this drawing", { exact: true }),
	).toBeVisible();
	const { url, headers } = JSON.parse(
		await page.getByLabel("MCP configuration", { exact: true }).inputValue(),
	).mcpServers.ecad as { url: string; headers: { Authorization: string } };
	const client = new Client({ name: "ecad-smoke-test", version: "1.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers },
		}),
	);
	return client;
}

async function call(
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
) {
	const result = await client.callTool({ name, arguments: args });
	expect(result.isError).not.toBe(true);
	const reply = drawingReplySchema.parse(result.structuredContent);
	if (!reply.ok) throw new Error(reply.error.message);
	return reply;
}

async function shapesOf(client: Client) {
	const { drawing } = await call(client, "getDrawing");
	if (!drawing) throw new Error("getDrawing returned no drawing.");
	return drawing.shapes;
}

test("the built web app opens a drawing, keeps it across a reload and serves editor MCP", async ({
	page,
}) => {
	await page.goto("/?perf=1");
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();

	await (await openProjectFiles(page))
		.getByRole("link", { name: /^Open .+\.ecaddraw$/ })
		.first()
		.click();
	await editorReady(page);

	const before = await saves(page);
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400, { steps: 4 });
	await page.mouse.up();
	await expect.poll(() => saves(page)).toBeGreaterThan(before);

	await page.reload();
	await editorReady(page);
	await page.mouse.move(560, 260);
	await page.mouse.down();
	await page.mouse.move(760, 440, { steps: 4 });
	await page.mouse.up();
	await expect(
		page
			.getByRole("toolbar", { name: /^(Schematic|Symbol) tools$/ })
			.getByRole("button", { name: "Delete", exact: true }),
	).toBeEnabled();

	const client = await connectMcp(page);
	try {
		expect((await shapesOf(client)).map((shape) => shape.kind)).toEqual([
			"rectangle",
		]);
		await call(client, "placeRectangle", {
			x: 40,
			y: 20,
			width: 20,
			height: 10,
			rotation: 0,
			lineWidth: 0.2,
		});
		expect(await shapesOf(client)).toHaveLength(2);
	} finally {
		await client.close();
	}
});
