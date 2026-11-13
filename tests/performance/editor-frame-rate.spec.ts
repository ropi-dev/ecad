import { expect, type Page, test } from "@playwright/test";
import { drawingPoint } from "../browser/symbol-items";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, ready } from "./app-helpers.ts";

setupAppTests();

type Point = { x: number; y: number };

const startFrames = (page: Page) =>
	page.evaluate(() => {
		const state = { times: [] as number[], running: true };
		const tick = (time: number) => {
			if (!state.running) return;
			state.times.push(time);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		(window as unknown as { __frameRate: typeof state }).__frameRate = state;
	});

const stopFrames = (page: Page) =>
	page.evaluate(() => {
		const state = (
			window as unknown as {
				__frameRate: { times: number[]; running: boolean };
			}
		).__frameRate;
		state.running = false;
		return state.times.slice(1).map((time, index) => time - state.times[index]);
	});

const settle = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() =>
						requestIdleCallback(() => resolve(), { timeout: 2000 }),
					),
				),
			),
	);

const mean = (values: number[]) =>
	values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

const p95 = (values: number[]) =>
	[...values].sort((a, b) => a - b)[
		Math.max(0, Math.ceil(values.length * 0.95) - 1)
	] ?? 0;

const wheel = (page: Page, frames: number, zoom: boolean) =>
	page.evaluate(
		({ frames, zoom }) =>
			new Promise<void>((resolve) => {
				const target = document.querySelector("canvas");
				if (!target) throw new Error("Expected the canvas");
				let step = 0;
				const tick = () => {
					step++;
					if (step > frames) {
						resolve();
						return;
					}
					target.dispatchEvent(
						new WheelEvent("wheel", {
							deltaX: zoom ? 0 : Math.round(Math.sin(step / 10) * 25),
							deltaY: zoom
								? (Math.floor(step / 30) % 2 === 0 ? -1 : 1) * 8
								: Math.round(Math.cos(step / 13) * 25),
							ctrlKey: zoom,
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
		{ frames, zoom },
	);

test("editor-frame-rate", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	test.setTimeout(300_000);
	const { createSymbol, symbolDefinitions } = await import(
		"#/drawing/symbols.ts"
	);
	const { drawShape, pinTerminals } = await import(
		"@ecad/drawing-core/drawing/shapes.ts"
	);
	const resistor = required(
		symbolDefinitions.find((definition) => definition.id === "resistor"),
	);
	const columns = 30;
	const rows = 30;
	const dx = 12.7;
	const dy = 7.62;
	const left = (-(columns - 1) * dx) / 2;
	const bottom = (-(rows - 1) * dy) / 2;
	const shapes: unknown[] = [];
	const parts = new Map<string, ReturnType<typeof createSymbol>>();
	let id = 1;
	const emptyRow = 11;
	for (let row = 0; row < rows; row++) {
		if (row === emptyRow) continue;
		let previous: ReturnType<typeof createSymbol> | undefined;
		for (let column = 0; column < columns; column++) {
			const part = createSymbol(id++, resistor, {
				x: left + column * dx,
				y: bottom + row * dy,
			});
			shapes.push(part);
			parts.set(`${column}:${row}`, part);
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
		const directory = await root.getDirectoryHandle("Frame rate", {
			create: true,
		});
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Frame rate"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Frame rate");
	}, shapes);
	await page.goto("/editor?perf=1");
	await ready(page, 60_000);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled({ timeout: 60_000 });
	const canvas = page.locator("canvas");
	const box = required(await canvas.boundingBox());
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(center.x, center.y);
	const stable = async () => {
		await expect
			.poll(async () => {
				const before = await drawingPoint(page, { x: 0, y: 0 });
				await settle(page);
				const after = await drawingPoint(page, { x: 0, y: 0 });
				return before.x === after.x && before.y === after.y;
			})
			.toBe(true);
	};
	const fitView = async () => {
		await page
			.getByRole("button", { name: "Fit drawing", exact: true })
			.click();
		await stable();
		await page.mouse.move(center.x, center.y);
	};
	const zoomedView = async () => {
		await fitView();
		for (let step = 0; step < 3; step++)
			await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		await stable();
		await page.mouse.move(center.x, center.y);
	};
	const screen = async (point: Point) => drawingPoint(page, point);
	const part = (column: number, row: number) => ({
		x: left + column * dx,
		y: bottom + row * dy,
	});
	const gap = (column: number, row: number) => ({
		x: left + column * dx,
		y: bottom + (row + 0.5) * dy,
	});
	const intervals: Record<string, number[]> = {};
	const measure = async (name: string, action: () => Promise<void>) => {
		await settle(page);
		await startFrames(page);
		await action();
		await settle(page);
		intervals[name] = await stopFrames(page);
	};
	const sweep = async (from: Point, to: Point, steps: number) => {
		for (let step = 1; step <= steps; step++)
			await page.mouse.move(
				from.x + ((to.x - from.x) * step) / steps,
				from.y + ((to.y - from.y) * step) / steps,
			);
	};
	await fitView();
	await measure("idle", () => page.waitForTimeout(1500));
	await measure("pan-fit", () => wheel(page, 90, false));
	await fitView();
	await measure("zoom-fit", () => wheel(page, 120, true));
	await zoomedView();
	await measure("pan", () => wheel(page, 90, false));
	await zoomedView();
	await measure("zoom", () => wheel(page, 120, true));
	await zoomedView();
	const a = await screen(part(12, 12));
	const b = await screen(part(17, 15));
	await measure("hover", () => sweep(a, b, 90));
	await measure("select", async () => {
		for (let index = 0; index < 12; index++) {
			const point = await screen(part(12 + (index % 6), 12 + (index % 4)));
			await page.mouse.click(point.x, point.y);
			await page.waitForTimeout(50);
		}
		await page.keyboard.press("Escape");
		await page.waitForTimeout(50);
	});
	const deleteButton = page.getByRole("button", {
		name: "Delete",
		exact: true,
	});
	await expect(deleteButton).toBeDisabled();
	const undoButton = page.getByRole("button", { name: "Undo", exact: true });
	const redoButton = page.getByRole("button", { name: "Redo", exact: true });
	await expect(undoButton).toBeDisabled();
	const marqueeStart = await screen(part(12, emptyRow));
	const marqueeEnd = await screen(gap(16, 14));
	await measure("marquee", async () => {
		await page.mouse.move(marqueeStart.x, marqueeStart.y);
		await page.mouse.down();
		await sweep(marqueeStart, marqueeEnd, 60);
		await page.mouse.up();
	});
	await expect(deleteButton).toBeEnabled();
	const grabbed = await screen(part(13, 13));
	await measure("move-group", async () => {
		await page.mouse.move(grabbed.x, grabbed.y);
		await page.mouse.down();
		await sweep(grabbed, { x: grabbed.x + 40, y: grabbed.y + 25 }, 60);
		await page.mouse.up();
	});
	await expect(undoButton).toBeEnabled();
	let undos = 0;
	while (await undoButton.isEnabled()) {
		await undoButton.click();
		await expect(redoButton).toBeEnabled();
		undos++;
	}
	expect(undos).toBe(1);
	await page.keyboard.press("Escape");
	const single = await screen(part(15, 16));
	await measure("move", async () => {
		await page.mouse.move(single.x, single.y);
		await page.mouse.down();
		await sweep(single, { x: single.x + 60, y: single.y + 40 }, 60);
		await page.mouse.up();
	});
	await expect(undoButton).toBeEnabled();
	await undoButton.click();
	await expect(undoButton).toBeDisabled();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	await page.mouse.move(a.x, a.y);
	await measure("place", () => sweep(a, b, 90));
	await page.keyboard.press("Escape");
	await (await toolbarButton(page, "Wire")).click();
	const [pin] = pinTerminals(required(parts.get("12:12")));
	const wireStart = await screen(pin);
	await page.mouse.click(wireStart.x, wireStart.y);
	const wireEnd = await screen(part(17, emptyRow));
	await measure("wire", () => sweep(wireStart, wireEnd, 90));
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	const idleMean = mean(required(intervals.idle));
	const metrics: Record<string, number> = { idleFrameMs: idleMean };
	for (const [name, values] of Object.entries(intervals)) {
		if (name === "idle") continue;
		metrics[`${name}DropPct`] = Math.max(
			0,
			(1 - idleMean / mean(values)) * 100,
		);
		metrics[`${name}FrameP95Ms`] = p95(values);
	}
	console.log(JSON.stringify(metrics));
	await finish(page, testInfo, "editor-frame-rate", metrics);
});
