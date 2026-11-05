import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-component-move", async ({ page }, testInfo) => {
	const { createSymbol, symbolDefinitions } = await import(
		"#/drawing/symbols.ts"
	);
	const { drawShape, pinTerminals } = await import(
		"@ecad/drawing-core/drawing/shapes.ts"
	);
	const symbol = createSymbol(
		201,
		required(
			symbolDefinitions.find((definition) => definition.id === "resistor"),
		),
		{ x: 0, y: 0 },
	);
	const [left, right] = pinTerminals(symbol);
	const shapes = [
		...Array.from({ length: 200 }, (_, index) =>
			drawShape(
				index + 1,
				"wire",
				{ x: 80 + (index % 10) * 6, y: 60 + Math.floor(index / 10) * 3 },
				{ x: 84 + (index % 10) * 6, y: 60 + Math.floor(index / 10) * 3 },
			),
		),
		symbol,
		drawShape(202, "wire", right, { x: 40, y: 0 }),
		drawShape(203, "pin", left, left),
	];
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async (shapes) => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Component movement", {
			create: true,
		});
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Component movement"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Component movement");
	}, shapes);
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	const source = {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "component.move-connected", async () => {
			await page.mouse.move(source.x, source.y);
			await page.mouse.down();
			await page.mouse.move(source.x + 40, source.y - 60, { steps: 4 });
			await page.mouse.up();
			await page.waitForFunction(
				() => {
					const value = document
						.querySelector<HTMLInputElement>('input[aria-label="Center X"]')
						?.getAttribute("data-committed-value");
					return value !== null && value !== undefined && Number(value) > 0;
				},
				undefined,
				{ polling: "raf" },
			);
		});
		if (repeat < 2) await (await toolbarButton(page, "Undo")).click();
	}
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				try {
					const directory = await (
						await navigator.storage.getDirectory()
					).getDirectoryHandle("Component movement");
					const manifest = await (
						await directory.getFileHandle(".ecadprj")
					).getFile();
					const path = ((await manifest.text()).match(
						/^drawing\s*=\s*"([^"]+)"/m,
					) ??
						(() => {
							throw new Error("Expected a value");
						})())[1].split("/");
					let current = directory;
					const name =
						path.pop() ??
						(() => {
							throw new Error("Expected a value");
						})();
					for (const part of path)
						current = await current.getDirectoryHandle(part);
					return JSON.parse(
						await (await (await current.getFileHandle(name)).getFile()).text(),
					).shapes.length;
				} catch (error) {
					if (error instanceof DOMException && error.name === "NotFoundError")
						return null;
					throw error;
				}
			}),
		)
		.toBe(207);
	const value = await report(page);
	await finish(page, testInfo, "editor-component-move", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
		normalizationP95Ms: required(metric(value, "editor.wire-normalize")),
	});
});
