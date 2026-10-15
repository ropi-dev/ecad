import { toolbarButton } from "./toolbar";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, type Page, test } from "@playwright/test";
import type { RectangleInput } from "#/commands/drawing-commands.ts";
import { drawingReplySchema } from "#/mcp/drawing-protocol.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const rectangle: RectangleInput = {
	x: 12.3,
	y: -4.7,
	width: 25,
	height: 14,
	rotation: 0,
	lineWidth: 0.4,
};

const committed = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent()) || "{}");
const scene = async (page: Page) =>
	JSON.parse((await page.locator("#editor-scene").textContent()) || "{}");

async function openEditor(page: Page) {
	await page.goto("/tests/browser/editor.html");
	await expect.poll(async () => (await scene(page)).worksheet).toBe("A3, 420 × 297 mm");
	await expect(page.getByRole("button", { name: "Enable MCP", exact: true })).toBeEnabled();
}

async function enableMcp(page: Page) {
	await page.getByRole("button", { name: "Enable MCP", exact: true }).click();
	await expect(page.getByText("Connected to this drawing", { exact: true })).toBeVisible();
	const configuration = JSON.parse(await page.getByLabel("MCP configuration", { exact: true }).inputValue());
	const { url, headers } = configuration.mcpServers.ecad as {
		url: string;
		headers: { Authorization: string };
	};
	expect(await page.getByLabel("MCP URL", { exact: true }).inputValue()).toBe(url);
	const token = await page.getByLabel("MCP bearer token", { exact: true }).inputValue();
	expect(headers.Authorization).toBe(`Bearer ${token}`);
	const client = new Client({ name: "ecad-browser-test", version: "1.0.0" });
	const transport = new StreamableHTTPClientTransport(new URL(url), {
		fetch: (input, init) => {
			const requestHeaders = new Headers(init?.headers);
			requestHeaders.set("Authorization", headers.Authorization);
			return fetch(input, { ...init, headers: requestHeaders });
		},
		reconnectionOptions: {
			maxRetries: 0,
			initialReconnectionDelay: 10,
			maxReconnectionDelay: 10,
			reconnectionDelayGrowFactor: 1,
		},
	});
	try {
		await client.connect(transport, { timeout: 5000 });
		return { client, url, token };
	} catch (error) {
		await client.close();
		throw error;
	}
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
	const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
	expect(result.isError).not.toBe(true);
	const reply = drawingReplySchema.parse(result.structuredContent);
	expect(reply.ok).toBe(true);
	if (!reply.ok) throw new Error(reply.error.message);
	return reply;
}

async function failedCall(client: Client, name: string, args: Record<string, unknown> = {}) {
	const outcome = await client.callTool({ name, arguments: args }, undefined, { timeout: 5000 }).then(
		(result) => ({ result, error: undefined }),
		(error: unknown) => ({ result: undefined, error }),
	);
	if (outcome.error !== undefined) {
		expect(outcome.error).toBeInstanceOf(Error);
		expect(String(outcome.error)).not.toMatch(/timed out|timeout/i);
	}
	else expect(outcome.result?.isError).toBe(true);
}

test("MCP starts disabled and SDK tools read and edit the active drawing independently of the selected tool", async ({ page }) => {
	const sessionRequests: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && new URL(request.url()).pathname === "/api/editor-mcp")
			sessionRequests.push(request.url());
	});
	await openEditor(page);
	await (await toolbarButton(page, "Circle")).click();
	expect(sessionRequests).toEqual([]);
	await expect(page.getByLabel("MCP configuration", { exact: true })).toHaveCount(0);
	const { client } = await enableMcp(page);
	try {
		expect(sessionRequests).toHaveLength(1);
		const listed = await client.listTools();
		expect(listed.tools.map(({ name }) => name)).toEqual(expect.arrayContaining([
			"getDrawing", "placeRectangle", "placeShapes", "replaceShapes", "removeShapes", "undo", "redo", "jumpHistory",
		]));
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual([]);
		const placed = await call(client, "placeRectangle", { ...rectangle });
		expect(placed.drawing.shapes).toEqual([{ id: 1, kind: "rectangle", ...rectangle }]);
		await expect.poll(async () => (await committed(page)).shapes).toEqual(placed.drawing.shapes);
		await expect.poll(async () => (await scene(page)).shapes).toEqual([
			{ name: "rectangle 1", x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height, rotation: 0, selected: false },
		]);
		await expect((await toolbarButton(page, "Circle"))).toHaveAttribute("aria-pressed", "true");
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual(placed.drawing.shapes);
		await (await toolbarButton(page, "Undo")).click();
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual([]);
		await (await toolbarButton(page, "Redo")).click();
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual(placed.drawing.shapes);
		await call(client, "removeShapes", { ids: [1] });
		await expect.poll(async () => (await scene(page)).shapes).toEqual([]);
		const restored = await call(client, "undo");
		expect(restored.drawing.shapes).toEqual(placed.drawing.shapes);
		await expect.poll(async () => (await committed(page)).shapes).toEqual(placed.drawing.shapes);
		await expect.poll(async () => (await scene(page)).shapes.length).toBe(1);
		await call(client, "redo");
		await expect.poll(async () => (await committed(page)).shapes).toEqual([]);
		await expect.poll(async () => (await scene(page)).shapes).toEqual([]);
	} finally {
		await client.close();
	}
});

test("invalid MCP geometry does not change shapes or history and disabling revokes access", async ({ page }) => {
	await openEditor(page);
	const { client } = await enableMcp(page);
	try {
		await call(client, "placeRectangle", { ...rectangle });
		const before = await committed(page);
		await failedCall(client, "placeRectangle", { ...rectangle, width: -1 });
		const { height: _height, ...missingHeight } = rectangle;
		await failedCall(client, "placeRectangle", missingHeight);
		await failedCall(client, "removeShapes", { ids: [999] });
		expect(await committed(page)).toEqual(before);
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual(before.shapes);
		await page.getByRole("button", { name: "Disable MCP", exact: true }).click();
		await expect(page.getByRole("button", { name: "Enable MCP", exact: true })).toBeEnabled();
		await failedCall(client, "placeRectangle", { ...rectangle, x: 90 });
		expect(await committed(page)).toEqual(before);
	} finally {
		await client.close();
	}
});

test("MCP settings stay within desktop and mobile viewports and collapse without disconnecting", async ({ page }) => {
	const sessionRequests: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && new URL(request.url()).pathname === "/api/editor-mcp")
			sessionRequests.push(request.url());
	});
	await openEditor(page);
	const { client, url } = await enableMcp(page);
	try {
		const toggle = page.getByRole("button", { name: "MCP connected", exact: true });
		const panel = page.getByRole("region", { name: "MCP connection", exact: true });
		for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 320, height: 640 }]) {
			await page.setViewportSize(viewport);
			await expect(panel).toBeVisible();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			const panelBounds = (await panel.boundingBox())!;
			const toggleBounds = (await toggle.boundingBox())!;
			expect(panelBounds.x).toBeGreaterThanOrEqual(0);
			expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(viewport.width);
			expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(viewport.height);
			expect(toggleBounds.x + toggleBounds.width).toBeLessThanOrEqual(viewport.width);
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await expect(panel).toHaveCount(0);
			const placed = await call(client, "placeRectangle", { ...rectangle, x: viewport.width });
			await expect.poll(async () => (await committed(page)).shapes).toEqual(placed.drawing.shapes);
			await toggle.click();
			await expect(page.getByLabel("MCP URL", { exact: true })).toHaveValue(url);
			await expect(page.getByRole("button", { name: "Disable MCP", exact: true })).toBeVisible();
		}
		expect(sessionRequests).toHaveLength(1);
		await page.getByRole("button", { name: "Disable MCP", exact: true }).click();
		await expect(page.getByRole("button", { name: "Enable MCP", exact: true })).toBeVisible();
		await failedCall(client, "getDrawing");
	} finally {
		await client.close();
	}
});

test("an MCP command cancels an unfinished pointer gesture before it can overwrite the drawing", async ({ page }) => {
	await openEditor(page);
	const { client } = await enableMcp(page);
	try {
		await (await toolbarButton(page, "Rectangle")).click();
		const box = (await page.locator("canvas").boundingBox())!;
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 100, y + 60, { steps: 4 });
		await expect.poll(async () => (await scene(page)).shapes.length).toBe(1);
		expect((await committed(page)).shapes).toEqual([]);
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual([]);
		const placed = await call(client, "placeRectangle", { ...rectangle, x: 80, y: 40 });
		await expect.poll(async () => (await scene(page)).shapes[0].x).toBe(80);
		await page.mouse.up();
		expect((await committed(page)).shapes).toEqual(placed.drawing.shapes);
		expect((await committed(page)).historySize).toBe(2);
		await expect.poll(async () => (await scene(page)).shapes.length).toBe(1);
	} finally {
		await page.mouse.up();
		await client.close();
	}
});

test("separate editor tabs have isolated MCP drawings and a closed tab stops serving commands", async ({ page, context }) => {
	await openEditor(page);
	const first = await enableMcp(page);
	const other = await context.newPage();
	let second: Awaited<ReturnType<typeof enableMcp>> | undefined;
	try {
		await openEditor(other);
		second = await enableMcp(other);
		expect(second.url).not.toBe(first.url);
		expect(second.token).not.toBe(first.token);
		await call(first.client, "placeRectangle", { ...rectangle });
		expect((await call(second.client, "getDrawing")).drawing.shapes).toEqual([]);
		expect((await committed(other)).shapes).toEqual([]);
		const secondShape = { ...rectangle, x: -60, y: 50 };
		await call(second.client, "placeRectangle", secondShape);
		await expect.poll(async () => (await scene(other)).shapes[0]?.x).toBe(-60);
		expect((await call(first.client, "getDrawing")).drawing.shapes).toEqual([{ id: 1, kind: "rectangle", ...rectangle }]);
		await call(first.client, "removeShapes", { ids: [1] });
		expect((await committed(other)).shapes).toEqual([{ id: 1, kind: "rectangle", ...secondShape }]);
		await other.close();
		await failedCall(second.client, "getDrawing");
		expect((await call(first.client, "getDrawing")).drawing.shapes).toEqual([]);
	} finally {
		await first.client.close();
		await second?.client.close();
		if (!other.isClosed()) await other.close();
	}
});
