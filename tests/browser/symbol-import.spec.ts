import { readFileSync } from "node:fs";
import {
	type EditorSymbol,
	shapeBounds,
	symbolChildWorld,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { test as base, expect, type Page } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { openProjectActions } from "./project-files";
import { drawingPoint } from "./symbol-items";
import { toolbarButton } from "./toolbar";

const example = readFileSync(
	new URL(
		"../../packages/web/public/examples/symbols/test-point.ecadsym",
		import.meta.url,
	),
);
const upload = {
	name: "test-point.ecadsym",
	mimeType: "application/json",
	buffer: example,
};
const bufferUpload = {
	name: "buffer.ecadsym",
	mimeType: "application/json",
	buffer: readFileSync(
		new URL(
			"../../packages/web/public/examples/symbols/buffer.ecadsym",
			import.meta.url,
		),
	),
};

const test = base.extend<{ libraries: Page }>({
	libraries: async ({ context }, use) => {
		const libraries = await context.newPage();
		await libraries.goto("/tests/browser/projects.html");
		await openProjectActions(libraries);
		await libraries
			.getByRole("menuitem", { name: "Symbol libraries...", exact: true })
			.click();
		await libraries.getByLabel("Library scope").selectOption("user");
		await expect(libraries.getByLabel("Upload symbol files")).toBeEnabled();
		await use(libraries);
		await libraries.close();
	},
});

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ page, libraries }) => {
	await expect(libraries.getByLabel("Upload symbol files")).toBeEnabled();
	await page.goto("/tests/browser/editor.html");
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
});

test("uploads, previews, places, undoes, and restores custom symbols after reload", async ({
	page,
	libraries,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const download = libraries.waitForEvent("download");
	await libraries.getByRole("link", { name: "Download example" }).click();
	expect((await download).suggestedFilename()).toBe("test-point.ecadsym");
	await libraries
		.getByLabel("Upload symbol files")
		.setInputFiles([upload, bufferUpload]);
	await expect(libraries.getByRole("status")).toContainText("Symbols added.");
	const custom = page.getByRole("region", {
		name: "Custom symbols",
		exact: true,
	});
	await expect(custom.getByRole("button", { name: /^Insert / })).toHaveCount(2);
	await expect(
		custom.getByRole("button", { name: "Insert Test point", exact: true }),
	).toBeVisible();
	const search = page.getByRole("searchbox", { name: "Search symbols" });
	await search.fill("  TEST POINT  ");
	await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(1);
	await expect(
		custom.getByRole("button", { name: "Insert Test point", exact: true }),
	).toBeVisible();
	await search.fill("");
	const testPoint = page.getByRole("button", {
		name: "Insert Test point",
		exact: true,
	});
	await testPoint.scrollIntoViewIfNeeded();
	await expect(testPoint.locator("svg circle")).toHaveCount(2);
	const buffer = page.getByRole("button", {
		name: "Insert Buffer",
		exact: true,
	});
	await buffer.scrollIntoViewIfNeeded();
	await expect(buffer.locator("svg polygon")).toHaveCount(1);
	await testPoint.click();
	const canvas = page.locator("canvas");
	const box = required(await canvas.boundingBox());
	await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
	const placed = JSON.parse(
		required(await page.locator("#editor-document").textContent()),
	).shapes[0] as EditorSymbol;
	const ring = shapeBounds(
		symbolChildWorld(
			placed,
			required(placed.children.find((child) => child.kind === "circle")),
		),
	);
	const edge = await drawingPoint(page, {
		x: ring.maxX,
		y: (ring.minY + ring.maxY) / 2,
	});
	await page.mouse.dblclick(edge.x, edge.y);
	await expect(
		page.getByRole("textbox", { name: "Reference", exact: true }),
	).toHaveValue("TP1");
	await expect(
		page.getByRole("textbox", { name: "Value", exact: true }),
	).toHaveValue("Test");
	await expect
		.poll(
			async () =>
				JSON.parse(required(await page.locator("#editor-scene").textContent()))
					.shapes.length,
		)
		.toBe(1);
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(
			async () =>
				JSON.parse(required(await page.locator("#editor-scene").textContent()))
					.shapes.length,
		)
		.toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect
		.poll(
			async () =>
				JSON.parse(required(await page.locator("#editor-scene").textContent()))
					.shapes.length,
		)
		.toBe(1);
	await page.reload();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(testPoint).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Insert Buffer" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Insert Resistor", exact: true }),
	).toBeVisible();
	expect(errors).toEqual([]);
});
