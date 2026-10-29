import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import type { EditorSymbol } from "#/drawing/shapes.ts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { stableScreenshot } from "./stable-screenshot";
import { drawingPoint, selectDrawingShape } from "./symbol-items";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

test("placed symbol pin visibility survives child editing, undo, redo, and project reopen", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
	await expect(page.getByLabel("Project save status")).toHaveText("Saved");
	const definition = {
		format: "ecad-symbol",
		version: 1,
		units: "mm",
		id: "child-pin",
		name: "Child pin",
		description: "",
		prefix: "U",
		value: "",
		shapes: [
			{ kind: "rectangle", x: 0, y: 0, width: 20, height: 14 },
			{
				kind: "pin",
				x: -14,
				y: 0,
				length: 4,
				name: "SWCLK",
				number: "24",
				locked: false,
			},
		],
	};
	await (await openProjectFiles(page))
		.getByLabel("Add symbol files")
		.setInputFiles({
			name: "child-pin.ecadsym",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(definition)),
		});
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Child pin", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 600, y: 460 } });
	for (let step = 0; step < 4; step++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	const state = async () =>
		JSON.parse((await page.locator("#project-document").textContent())!) as {
			shapes: EditorSymbol[];
			dirty: boolean;
		};
	const labels = () =>
		page.evaluate(() =>
			(
				JSON.parse(
					document.documentElement.dataset.pinLabels ?? "[]",
				) as string[]
			).map((name) => name.replace(/^pin (name|number) .*/, "$1")),
		);
	const original = (await state()).shapes[0];
	const selectPinChild = async () => {
		await selectDrawingShape(page, original.id);
		const symbol = (await state()).shapes[0];
		const point = await drawingPoint(page, { x: symbol.x - 12, y: symbol.y });
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		await page.mouse.move(point.x + 4, point.y);
		await page.mouse.move(point.x, point.y);
		await page.mouse.up();
		await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
	};
	await selectPinChild();
	const name = page.getByRole("checkbox", { name: "Show name", exact: true });
	const number = page.getByRole("checkbox", {
		name: "Show number",
		exact: true,
	});
	await expect(name).toBeChecked();
	await expect(number).toBeChecked();
	await expect.poll(labels).toEqual(["name", "number"]);
	await name.uncheck();
	await expect.poll(labels).toEqual(["number"]);
	await (await toolbarButton(page, "Undo")).click();
	await expect(name).toBeChecked();
	await expect.poll(labels).toEqual(["name", "number"]);
	await (await toolbarButton(page, "Redo")).click();
	await expect(name).not.toBeChecked();
	await expect(number).toBeChecked();
	await expect.poll(labels).toEqual(["number"]);
	await number.uncheck();
	await expect.poll(labels).toEqual([]);
	await (await toolbarButton(page, "Undo")).click();
	await expect(number).toBeChecked();
	await expect.poll(labels).toEqual(["number"]);
	await (await toolbarButton(page, "Redo")).click();
	await expect(number).not.toBeChecked();
	await expect(name).not.toBeChecked();
	await expect.poll(labels).toEqual([]);
	await name.check();
	await expect.poll(labels).toEqual(["name"]);
	const edited = (await state()).shapes[0];
	expect(edited.children).toEqual(original.children);
	expect({ x: edited.x, y: edited.y, rotation: edited.rotation }).toEqual({
		x: original.x,
		y: original.y,
		rotation: original.rotation,
	});
	expect(edited.childOverrides?.["shape:2"]).toMatchObject({
		showName: true,
		showNumber: false,
	});
	await expect.poll(async () => (await state()).dirty).toBe(false);
	const saved = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Child pin visibility");
		const formatPath = "/packages/core/src/projects/format.ts";
		const { parseProjectManifest } = await import(formatPath);
		const manifest = parseProjectManifest(
			await (
				await (await directory.getFileHandle(".ecadprj")).getFile()
			).text(),
		);
		const parts = manifest.drawing.split("/");
		const file = parts.pop()!;
		let parent = directory;
		for (const part of parts) parent = await parent.getDirectoryHandle(part);
		return JSON.parse(
			await (await (await parent.getFileHandle(file)).getFile()).text(),
		);
	});
	expect(saved.shapes[0].childOverrides["shape:2"]).toMatchObject({
		showName: true,
		showNumber: false,
	});
	expect(saved.shapes[0]).not.toHaveProperty("children");
	await page.reload();
	await expect
		.poll(async () => (await state()).shapes[0]?.childOverrides?.["shape:2"])
		.toMatchObject({ showName: true, showNumber: false });
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await expect(page.locator("canvas")).toBeVisible();
	await selectPinChild();
	await expect(name).toBeChecked();
	await expect(number).not.toBeChecked();
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("SWCLK");
	await expect(
		page.getByRole("textbox", { name: "Number", exact: true }),
	).toHaveValue("24");
	await expect.poll(labels).toEqual(["name"]);
	if (captureArtifacts)
		await stableScreenshot(() =>
			page.screenshot({
				path: test.info().outputPath("placed-pin-name-only-reopened.png"),
			}),
		);
});
