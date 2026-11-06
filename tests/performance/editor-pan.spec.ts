import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, percentile, ready } from "./app-helpers.ts";

setupAppTests();

test("editor-pan", { tag: ["@editor"] }, async ({ page }, testInfo) => {
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
	// A full sheet of resistors chained pin to pin, so every pan frame has
	// labels, symbols and wires in view.
	const columns = 30;
	const rows = 30;
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
		const directory = await root.getDirectoryHandle("Pan", { create: true });
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Pan"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Pan");
	}, shapes);
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled({ timeout: 60_000 });
	const canvas = page.locator("canvas");
	const box = required(await canvas.boundingBox());
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	// A trackpad pan: one wheel event per frame, as the browser delivers them.
	const pan = () =>
		page.evaluate(
			() =>
				new Promise<number[]>((resolve) => {
					const target = document.querySelector("canvas");
					if (!target) throw new Error("Expected the canvas");
					const times: number[] = [];
					const tick = (time: number) => {
						times.push(time);
						const step = times.length;
						if (step > 90) {
							resolve(
								times.slice(1).map((value, index) => value - times[index]),
							);
							return;
						}
						target.dispatchEvent(
							new WheelEvent("wheel", {
								deltaX: Math.round(Math.sin(step / 10) * 25),
								deltaY: Math.round(Math.cos(step / 13) * 25),
								clientX: innerWidth / 2,
								clientY: innerHeight / 2,
								bubbles: true,
								cancelable: true,
							}),
						);
						requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				}),
		);
	const frames: number[] = [];
	const gestures: number[] = [];
	for (const zoom of [0, 3]) {
		for (let step = 0; step < zoom; step++)
			await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		await page.waitForTimeout(500);
		gestures.push(
			await interaction(page, "editor.pan", async () => {
				frames.push(...(await pan()));
			}),
		);
	}
	await finish(page, testInfo, "editor-pan", {
		interactionP95Ms: percentile(gestures),
		panFrameP50Ms: percentile(frames, 0.5),
		panFrameP95Ms: percentile(frames),
	});
});
