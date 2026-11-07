import { expect, type Page, test } from "@playwright/test";

interface Harness {
	show(state: {
		selected?: number[];
		moved?: Record<number, [number, number]>;
		removed?: number[];
		preview?: [number, number];
		renamed?: Record<number, string>;
	}): Promise<void>;
	pan(x: number, y: number): Promise<void>;
	redraw(): Promise<void>;
}

declare global {
	interface Window {
		harness?: Harness;
	}
}

const harness = (page: Page) => ({
	show: (state: Parameters<Harness["show"]>[0]) =>
		page.evaluate((state) => window.harness?.show(state), state),
	pan: (x: number, y: number) =>
		page.evaluate(([x, y]) => window.harness?.pan(x, y), [x, y] as const),
	redraw: () => page.evaluate(() => window.harness?.redraw()),
});

function differences(
	page: Page,
	first: Buffer,
	second: Buffer,
	threshold: number,
) {
	return page.evaluate(
		async ({ pngs, threshold }) => {
			const [a, b] = await Promise.all(
				pngs.map(async (png) => {
					const image = new Image();
					image.src = `data:image/png;base64,${png}`;
					await image.decode();
					const canvas = document.createElement("canvas");
					canvas.width = image.width;
					canvas.height = image.height;
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Expected a 2D context");
					context.drawImage(image, 0, 0);
					return context.getImageData(0, 0, image.width, image.height).data;
				}),
			);
			let count = 0;
			for (let index = 0; index < a.length; index++)
				if (Math.abs(a[index] - b[index]) > threshold) count++;
			return count;
		},
		{ pngs: [first, second].map((png) => png.toString("base64")), threshold },
	);
}

const repairs = (page: Page) =>
	page.evaluate(
		() =>
			window.__ecadPerformance
				?.snapshot()
				.events.filter(
					(event) =>
						event.name === "renderer.frame" && event.data?.panned === true,
				).length ?? 0,
	);

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/batched-drawing.html");
	await page.evaluate(async () => {
		const path = "/packages/core/src/performance/runtime.ts";
		const runtime = (await import(
			path
		)) as typeof import("#/performance/runtime.ts");
		runtime.initializePerformance();
	});
	await page.waitForFunction(() => window.harness);
	await harness(page).show({});
});

test("a batched drawing looks like one mesh per shape", async ({ page }) => {
	await harness(page).show({ selected: [1, 6, 20], preview: [30, -12] });
	const batched = await page.locator("#batched").screenshot();
	const meshes = await page.locator("#meshes").screenshot();
	expect(await differences(page, batched, meshes, 48)).toBeLessThan(150);
});

test("repairing changed areas shows the same picture as a full redraw", async ({
	page,
}) => {
	const view = harness(page);
	const before = await repairs(page);
	const states: Parameters<Harness["show"]>[0][] = [
		{ selected: [1, 2] },
		{ selected: [1, 2], moved: { 1: [2.54, 0] } },
		{
			selected: [6],
			moved: {
				1: [5.08, 2.54],
				6: [0, -2.54],
			},
			removed: [3],
		},
		{ removed: [3], preview: [20, 18] },
		{ removed: [3, 21] },
	];
	for (const state of states) {
		await view.show(state);
		await view.pan(7, -3);
		await view.show({ ...state, selected: [...(state.selected ?? []), 5] });
		const repaired = await page.locator("#batched").screenshot();
		await view.redraw();
		const redrawn = await page.locator("#batched").screenshot();
		expect(await differences(page, repaired, redrawn, 2)).toBe(0);
	}
	expect(await repairs(page)).toBeGreaterThan(before + 5);
});

test("renaming a label many times keeps repairing in place", async ({
	page,
}) => {
	const view = harness(page);
	for (let index = 0; index < 40; index++) {
		const before = await repairs(page);
		await view.show({ renamed: { 1: `R${100 + index}` } });
		expect(await repairs(page)).toBe(before + 1);
	}
	const batched = await page.locator("#batched").screenshot();
	const meshes = await page.locator("#meshes").screenshot();
	expect(await differences(page, batched, meshes, 48)).toBeLessThan(150);
	await view.redraw();
	const redrawn = await page.locator("#batched").screenshot();
	expect(await differences(page, batched, redrawn, 2)).toBe(0);
});
