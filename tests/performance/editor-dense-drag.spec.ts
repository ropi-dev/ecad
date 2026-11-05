import { expect, test } from "@playwright/test";
import { drawingPoint } from "../browser/symbol-items";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	percentile,
	pointAt,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test("editor-dense-drag", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	test.setTimeout(240_000);
	const { createSymbol, symbolDefinitions } = await import(
		"#/drawing/symbols.ts"
	);
	const { drawShape, pinTerminals } = await import(
		"@ecad/drawing-core/drawing/shapes.ts"
	);
	const resistor = required(
		symbolDefinitions.find((definition) => definition.id === "resistor"),
	);
	// Rows of resistors chained pin to pin. Dragging one through its
	// neighbours reroutes both of its wires around the parts in the way.
	const columns = 20;
	const rows = 20;
	const dx = 12.7;
	const dy = 7.62;
	const left = (-(columns - 1) * dx) / 2;
	const bottom = (-(rows - 1) * dy) / 2;
	const shapes: unknown[] = [];
	let id = 1;
	for (let row = 0; row < rows; row++) {
		let previous: ReturnType<typeof createSymbol> | undefined;
		for (let column = 0; column < columns; column++) {
			const part = createSymbol(id++, resistor, {
				x: left + column * dx,
				y: bottom + row * dy,
			});
			shapes.push(part);
			if (previous) {
				const [start] = pinTerminals(previous).slice(1);
				const [end] = pinTerminals(part);
				shapes.push(drawShape(id++, "wire", start, end));
			}
			previous = part;
		}
	}
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async (shapes) => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Dense drag", {
			create: true,
		});
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Dense drag"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Dense drag");
	}, shapes);
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled({ timeout: 60_000 });
	for (let step = 0; step < 3; step++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	// The resistor in the middle of the block, grabbed by its body.
	const grabbed = {
		x: left + Math.floor(columns / 2) * dx,
		y: bottom + Math.floor(rows / 2) * dy,
	};
	const nextFrame = () =>
		page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() =>
						setTimeout(() => requestAnimationFrame(() => resolve()), 0),
					),
				),
		);
	// Zooming animates, so read screen points only once the rulers stop moving.
	await expect
		.poll(async () => {
			const before = await drawingPoint(page, grabbed);
			await nextFrame();
			const after = await drawingPoint(page, grabbed);
			return before.x === after.x && before.y === after.y;
		})
		.toBe(true);
	const anchor = await drawingPoint(page, grabbed);
	const across = await drawingPoint(page, {
		x: grabbed.x + 2.5 * dx,
		y: grabbed.y + 1.5 * dy,
	});
	const gestures: number[] = [];
	const steps: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		await pointAt(page, anchor);
		gestures.push(
			await interaction(page, "dense-drag.gesture", async () => {
				await page.mouse.move(anchor.x, anchor.y);
				await page.mouse.down();
				for (let step = 1; step <= 10; step++)
					steps.push(
						await interaction(page, "dense-drag.step", async () => {
							await page.mouse.move(
								anchor.x + ((across.x - anchor.x) * step) / 10,
								anchor.y + ((across.y - anchor.y) * step) / 10,
							);
							await nextFrame();
						}),
					);
				await page.mouse.up();
				await nextFrame();
			}),
		);
		const undo = await toolbarButton(page, "Undo");
		await expect(undo).toBeEnabled();
		await undo.click();
		await expect(await toolbarButton(page, "Undo")).toBeDisabled();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-dense-drag", {
		interactionP95Ms: percentile(gestures),
		dragStepP95Ms: percentile(steps),
		rubberBandP95Ms: required(metric(value, "editor.rubber-band")),
	});
});
