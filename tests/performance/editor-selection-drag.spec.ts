import { expect, test } from "@playwright/test";
import { drawingPoint } from "../browser/symbol-items";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test("editor-selection-drag", async ({ page }, testInfo) => {
	// Three throttled drags across 2,600 shapes outlast the default two minutes.
	test.setTimeout(300_000);
	const { createSymbol, symbolDefinitions } = await import(
		"#/drawing/symbols.ts"
	);
	const { drawShape, pinTerminals } = await import("#/drawing/shapes.ts");
	const parts = ["resistor", "capacitor", "led"].map((id) =>
		required(symbolDefinitions.find((definition) => definition.id === id)),
	);
	// Each lead runs to a bus outside its row, so a window selects only symbols.
	const columns = 32;
	const rows = 26;
	const pitch = 20.32;
	const bus = pitch / 2;
	const left = (-(columns - 1) * pitch) / 2;
	const bottom = (-(rows - 1) * pitch) / 2;
	const row = Math.floor(rows / 2);
	const rowY = bottom + row * pitch;
	const shapes: unknown[] = [];
	let id = 1;
	for (let index = 0; index < rows; index++) {
		const y = bottom + index * pitch;
		for (let column = 0; column < columns; column++) {
			const symbol = createSymbol(
				id++,
				parts[(index + column) % parts.length],
				{ x: left + column * pitch, y },
			);
			shapes.push(symbol);
			for (const [lead, pin] of pinTerminals(symbol).entries())
				shapes.push(
					drawShape(id++, "wire", pin, {
						x: pin.x,
						y: pin.y + (lead ? -bus : bus),
					}),
				);
		}
	}
	for (let index = -1; index < rows; index++) {
		const y = bottom + index * pitch + bus;
		shapes.push(
			drawShape(id++, "wire", { x: left - pitch, y }, { x: -left + pitch, y }),
		);
		shapes.push({
			id: id++,
			kind: "text",
			x: left - pitch,
			y: y + 1.27,
			width: 6,
			height: 1.905,
			rotation: 0,
			lineWidth: 0.254,
			fontSize: 1.27,
			text: `BUS${index + 1}`,
			electrical: "net",
		});
	}
	// Unconnected verticals bridge the buses away from the dragged row.
	for (let column = 0; column < columns; column++) {
		const x = left + column * pitch + pitch / 2;
		shapes.push(
			drawShape(id++, "wire", { x, y: bottom - pitch }, { x, y: rowY - pitch }),
			drawShape(
				id++,
				"wire",
				{ x, y: rowY + pitch },
				{ x, y: -bottom + pitch },
			),
		);
	}
	expect(shapes.length).toBeGreaterThan(2500);
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async (shapes) => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Selection drag", {
			create: true,
		});
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Selection drag"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Selection drag");
	}, shapes);
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled({ timeout: 60_000 });
	// At the fitted zoom, the pick tolerance reaches the leads beside a window corner.
	const zoom = page.getByRole("button", { name: "Fit drawing", exact: true });
	const fitted = await zoom.textContent();
	for (let step = 0; step < 2; step++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(zoom).not.toHaveText(required(fitted));
	const canvasBounds = required(await page.locator("canvas").boundingBox());
	const first = Math.floor(columns / 2) - 6;
	// Grab a resistor body, which fills the symbol center.
	const grabbed =
		first +
		required(
			[0, 1, 2].find((offset) => (row + first + offset) % parts.length === 0),
		) +
		3;
	const anchor = await drawingPoint(page, {
		x: left + grabbed * pitch,
		y: rowY,
	});
	const nextFrame = () =>
		page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() =>
						setTimeout(() => requestAnimationFrame(() => resolve()), 0),
					),
				),
		);
	const gestures: number[] = [];
	const steps: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		// A left-to-right window selects twelve symbols but none of their leads.
		const start = await drawingPoint(page, {
			x: left + first * pitch - 7.62,
			y: rowY + 5.5,
		});
		const end = await drawingPoint(page, {
			x: left + (first + 11) * pitch + 7.62,
			y: rowY - 5.5,
		});
		for (const point of [start, end, anchor])
			expect(
				point.x > canvasBounds.x &&
					point.x < canvasBounds.x + canvasBounds.width &&
					point.y > canvasBounds.y &&
					point.y < canvasBounds.y + canvasBounds.height,
			).toBe(true);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(end.x, end.y, { steps: 2 });
		await page.mouse.up();
		await expect(
			page.getByText("Selected shapes", { exact: true }),
		).toBeVisible();
		gestures.push(
			await interaction(page, "selection-drag.gesture", async () => {
				await page.mouse.move(anchor.x, anchor.y);
				await page.mouse.down();
				for (let step = 1; step <= 10; step++)
					steps.push(
						await interaction(page, "selection-drag.step", async () => {
							await page.mouse.move(anchor.x + step * 6, anchor.y - step * 4);
							await nextFrame();
						}),
					);
				// Release commits synchronously; wait for the frame that draws it.
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
	await finish(page, testInfo, "editor-selection-drag", {
		interactionP95Ms: percentile(gestures),
		dragStepP95Ms: percentile(steps),
		dragStepMedianMs: percentile(steps, 0.5),
		// Typical per-update costs; the slowest samples are the initial open.
		...(value.metrics["editor.scene-display"]
			? { sceneDisplayMedianMs: value.metrics["editor.scene-display"].p50 }
			: {}),
		...(value.metrics["editor.scene-update"]
			? { sceneUpdateMedianMs: value.metrics["editor.scene-update"].p50 }
			: {}),
	});
});
