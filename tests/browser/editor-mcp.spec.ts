import { toolbarButton } from "./toolbar";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, type Page, test } from "@playwright/test";
import type { RectangleInput } from "#/commands/drawing-commands.ts";
import { lightSchematicTheme } from "#/drawing/schematic-theme.ts";
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
	await expect
		.poll(async () => (await scene(page)).worksheet)
		.toBe("A3, 420 × 297 mm");
	await expect(
		page.getByRole("button", { name: "Enable MCP", exact: true }),
	).toBeEnabled();
}

async function enableMcp(page: Page) {
	await page.getByRole("button", { name: "Enable MCP", exact: true }).click();
	await expect(
		page.getByText("Connected to this drawing", { exact: true }),
	).toBeVisible();
	const configuration = JSON.parse(
		await page.getByLabel("MCP configuration", { exact: true }).inputValue(),
	);
	const { url, headers } = configuration.mcpServers.ecad as {
		url: string;
		headers: { Authorization: string };
	};
	expect(await page.getByLabel("MCP URL", { exact: true }).inputValue()).toBe(
		url,
	);
	const token = await page
		.getByLabel("MCP bearer token", { exact: true })
		.inputValue();
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

async function call(
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
) {
	const result = await client.callTool({ name, arguments: args }, undefined, {
		timeout: 5000,
	});
	expect(result.isError).not.toBe(true);
	const reply = drawingReplySchema.parse(result.structuredContent);
	expect(reply.ok).toBe(true);
	if (!reply.ok) throw new Error(reply.error.message);
	return reply;
}

test("MCP starts disabled and SDK tools read and edit the active drawing independently of the selected tool", async ({
	page,
}) => {
	const sessionRequests: string[] = [];
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/api/editor-mcp"
		)
			sessionRequests.push(request.url());
	});
	await openEditor(page);
	await (await toolbarButton(page, "Circle")).click();
	expect(sessionRequests).toEqual([]);
	await expect(
		page.getByLabel("MCP configuration", { exact: true }),
	).toHaveCount(0);
	const { client } = await enableMcp(page);
	try {
		expect(sessionRequests).toHaveLength(1);
		const listed = await client.listTools();
		expect(listed.tools.map(({ name }) => name)).toEqual(
			expect.arrayContaining([
				"getDrawing",
				"placeRectangle",
				"placeShapes",
				"replaceShapes",
				"removeShapes",
				"rotateShapes",
				"undo",
				"redo",
				"jumpHistory",
			]),
		);
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual([]);
		const placed = await call(client, "placeRectangle", { ...rectangle });
		expect(placed.drawing.shapes).toEqual([
			{ id: 1, kind: "rectangle", ...rectangle },
		]);
		await expect
			.poll(async () => (await committed(page)).shapes)
			.toEqual(placed.drawing.shapes);
		await expect
			.poll(async () => (await scene(page)).shapes)
			.toEqual([
				{
					name: "rectangle 1",
					color: lightSchematicTheme.appearance.stroke.slice(1),
					x: rectangle.x,
					y: rectangle.y,
					width: rectangle.width,
					height: rectangle.height,
					rotation: 0,
					selected: false,
				},
			]);
		await expect(await toolbarButton(page, "Circle")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual(
			placed.drawing.shapes,
		);
		await (await toolbarButton(page, "Undo")).click();
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual([]);
		await (await toolbarButton(page, "Redo")).click();
		expect((await call(client, "getDrawing")).drawing.shapes).toEqual(
			placed.drawing.shapes,
		);
		const rotated = await call(client, "rotateShapes", { ids: [1] });
		expect(rotated.drawing.shapes[0]).toEqual({
			...placed.drawing.shapes[0],
			rotation: Math.PI / 2,
		});
		await expect
			.poll(async () => (await committed(page)).shapes)
			.toEqual(rotated.drawing.shapes);
		await expect
			.poll(async () => (await scene(page)).shapes[0]?.rotation)
			.toBeCloseTo(Math.PI / 2);
		await expect(await toolbarButton(page, "Circle")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await call(client, "undo");
		await call(client, "removeShapes", { ids: [1] });
		await expect.poll(async () => (await scene(page)).shapes).toEqual([]);
		const restored = await call(client, "undo");
		expect(restored.drawing.shapes).toEqual(placed.drawing.shapes);
		await expect
			.poll(async () => (await committed(page)).shapes)
			.toEqual(placed.drawing.shapes);
		await expect.poll(async () => (await scene(page)).shapes.length).toBe(1);
		await call(client, "redo");
		await expect.poll(async () => (await committed(page)).shapes).toEqual([]);
		await expect.poll(async () => (await scene(page)).shapes).toEqual([]);
	} finally {
		await client.close();
	}
});
