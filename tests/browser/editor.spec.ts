import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { expect, type Page, test } from "@playwright/test";
import { rulerSpacing } from "#/engine/ruler.ts";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 900 } });

const g = (steps: number) => steps * fromMils(100);

interface State {
	placement: { x: number; y: number; rotation: number } | null;
	pinTexts: { name: string; texture?: string; rotation: number }[];
	symbolTexts: {
		symbol: string;
		name: string;
		texture?: string;
		x: number;
		y: number;
	}[];
	wireTerminals: { x: number; y: number; width: number; height: number }[];
	wireJunctions: { x: number; y: number; width: number; height: number }[];
	wireBridges: string[];
	textures: number;
	camera: string;
	direction: number[];
	origin: number[];
	corner: number[];
	preview: {
		x: number;
		y: number;
		width: number;
		height: number;
		rotation: number;
	} | null;
	shapes: {
		name: string;
		color?: string;
		texture?: string;
		x: number;
		y: number;
		selected: boolean;
		width: number;
		height: number;
		rotation: number;
	}[];
}
const state = async (page: Page): Promise<State> =>
	JSON.parse((await page.locator("#editor-scene").textContent()) || "{}");
const nonPinState = async (page: Page): Promise<State> => {
	const view = await state(page);
	return {
		...view,
		shapes: view.shapes.filter((shape) => !shape.name.startsWith("pin ")),
	};
};
async function placePin(page: Page, x: number, y: number) {
	await (await toolbarButton(page, "Pin")).click();
	await clickAt(page, x, y);
}
async function screen(page: Page, x: number, y: number) {
	const view = await state(page);
	const box = required(await page.locator("canvas").boundingBox());
	return {
		x:
			box.x +
			((1 + view.origin[0] + ((view.corner[0] - view.origin[0]) * x) / 420) *
				box.width) /
				2,
		y:
			box.y +
			((1 - view.origin[1] - ((view.corner[1] - view.origin[1]) * y) / 297) *
				box.height) /
				2,
	};
}
async function gridStep(page: Page) {
	const view = await state(page);
	const box = required(await page.locator("canvas").boundingBox());
	return rulerSpacing(
		((view.corner[0] - view.origin[0]) * box.width) / 840,
		"mil",
	).minor;
}
async function clickAt(page: Page, x: number, y: number) {
	const point = await screen(page, x, y);
	await page.mouse.click(point.x, point.y);
}
async function moveAt(page: Page, x: number, y: number) {
	const point = await screen(page, x, y);
	await page.mouse.move(point.x, point.y);
}
async function dragTo(
	page: Page,
	from: [number, number],
	to: [number, number],
) {
	const start = await screen(page, ...from);
	const end = await screen(page, ...to);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await page.mouse.up();
}
async function createShape(page: Page, kind: string, x: number, y: number) {
	await (await toolbarButton(page, kind)).click();
	if (kind === "Circle") await dragTo(page, [x, y], [x + g(6), y]);
	else if (kind === "Wire") {
		await placePin(page, x - g(12), y);
		await (await toolbarButton(page, "Wire")).click();
		await clickAt(page, x - g(12), y);
		await clickAt(page, x + g(12), y);
		await page.keyboard.press("Enter");
	} else {
		const [width, height] =
			kind === "Rectangle" ? [g(20), g(12)] : [g(16), g(12)];
		await dragTo(
			page,
			[x - width / 2, y - height / 2],
			[x + width / 2, y + height / 2],
		);
	}
}
test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(await toolbarButton(page, "Rectangle")).toBeEnabled();
	await expect
		.poll(async () => (await state(page)).origin.slice(0, 2))
		.toEqual([0, 0]);
	// Keep the existing interaction fixtures' positive world coordinates in view.
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await dragTo(page, [0, 0], [-210, -148.5]);
	await page.getByRole("button", { name: "Select", exact: true }).click();
});

test("draws every shape, moves beyond A3 without panning, and deletes", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const before = await nonPinState(page);
	for (const [index, kind] of [
		"Rectangle",
		"Circle",
		"Triangle",
		"Wire",
	].entries()) {
		await createShape(page, kind, g(28 + index * 34), g(60));
		await expect
			.poll(async () => (await nonPinState(page)).shapes.length)
			.toBe(index + 1);
	}
	await dragTo(page, [g(28), g(60)], [g(40), g(72)]);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(g(40), 4);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(g(72), 4);
	expect((await nonPinState(page)).origin).toEqual(before.origin);
	await dragTo(page, [g(40), g(72)], [g(-12), g(130)]);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(g(-12), 4);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(g(130), 4);
	const step = await gridStep(page);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(g(-12) + step, 4);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].y)
		.toBeCloseTo(g(130) - 10 * step, 4);
	await page.keyboard.press("Delete");
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	await (await toolbarButton(page, "Rectangle")).click();
	await clickAt(page, g(-10), g(60));
	expect((await nonPinState(page)).shapes.length).toBe(3);
	expect(errors).toEqual([]);
});

test("Ctrl toggles, Shift adds and Ctrl + Shift removes from the selection", async ({
	page,
}) => {
	const centers = [g(30), g(64), g(98)];
	for (const [index, x] of centers.entries()) {
		await createShape(page, "Rectangle", x, g(60));
		await expect
			.poll(async () => (await nonPinState(page)).shapes.length)
			.toBe(index + 1);
	}
	const selection = async () =>
		(await nonPinState(page)).shapes.map((shape) => shape.selected);
	const badge = page.getByTestId("selection-action");

	await clickAt(page, centers[0], g(60));
	await page.keyboard.down("Control");
	await clickAt(page, centers[2], g(60));
	await expect.poll(selection).toEqual([true, false, true]);
	await clickAt(page, centers[2], g(60));
	await expect.poll(selection).toEqual([true, false, false]);
	await dragTo(page, [g(10), g(40)], [g(80), g(80)]);
	await expect.poll(selection).toEqual([false, true, false]);

	await page.keyboard.down("Shift");
	await clickAt(page, centers[1], g(60));
	await expect.poll(selection).toEqual([false, false, false]);
	await page.keyboard.up("Shift");
	await page.keyboard.up("Control");

	await page.keyboard.down("Shift");
	await clickAt(page, centers[0], g(60));
	await expect.poll(selection).toEqual([true, false, false]);
	await clickAt(page, centers[0], g(60));
	await expect.poll(selection).toEqual([true, false, false]);
	await dragTo(page, [g(44), g(40)], [g(120), g(80)]);
	await expect.poll(selection).toEqual([true, true, true]);
	await page.keyboard.up("Shift");

	const start = await screen(page, g(10), g(40));
	const end = await screen(page, g(80), g(80));
	await page.mouse.move(start.x, start.y);
	await page.keyboard.down("Control");
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await expect(badge).toHaveAttribute("data-selection-action", "toggle");
	await expect(badge).toHaveAttribute("data-selection-action", "toggle");
	await expect.poll(selection).toEqual([false, false, true]);
	await page.keyboard.down("Shift");
	await expect(badge).toHaveAttribute("data-selection-action", "remove");
	await expect.poll(selection).toEqual([false, false, true]);
	await page.screenshot({ path: "/tmp/ecad-remove-marquee.png" });
	await page.keyboard.up("Control");
	await expect(badge).toHaveAttribute("data-selection-action", "add");
	await expect.poll(selection).toEqual([true, true, true]);
	await page.screenshot({ path: "/tmp/ecad-add-marquee.png" });
	await page.keyboard.up("Shift");
	await expect(badge).toHaveCount(0);
	await expect.poll(selection).toEqual([true, true, false]);
	await page.keyboard.down("Control");
	await expect(badge).toHaveAttribute("data-selection-action", "toggle");
	await page.screenshot({ path: "/tmp/ecad-toggle-marquee.png" });
	await page.mouse.up();
	await page.keyboard.up("Control");
	await expect(badge).toHaveCount(0);
	await expect.poll(selection).toEqual([false, false, true]);
	expect((await nonPinState(page)).shapes.map((shape) => shape.x)).toEqual(
		centers.map((x) => expect.closeTo(x, 4)),
	);
});

test("wire clicks commit orthogonal segments and pointer release keeps the preview", async ({
	page,
}) => {
	await placePin(page, g(40), g(40));
	await (await toolbarButton(page, "Wire")).click();
	await dragTo(page, [g(40), g(40)], [g(64), g(48)]);
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(g(24), 4);
	let view = await nonPinState(page);
	expect(view.shapes).toEqual([]);
	expect(view.preview?.x).toBeCloseTo(g(52), 4);
	expect(view.preview?.y).toBeCloseTo(g(40), 4);
	expect(view.preview?.rotation).toBeCloseTo(0, 4);
	await clickAt(page, g(64), g(48));
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(1);
	await expect(await toolbarButton(page, "Wire")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await moveAt(page, g(69), g(66));
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(g(26), 4);
	view = await nonPinState(page);
	expect(view.shapes).toHaveLength(1);
	expect(view.preview?.x).toBeCloseTo(g(64), 4);
	expect(view.preview?.y).toBeCloseTo(g(53), 4);
	expect(view.preview?.rotation).toBeCloseTo(Math.PI / 2, 4);
	await clickAt(page, g(69), g(66));
	await clickAt(page, g(42), g(70));
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	view = await nonPinState(page);
	expect(view.shapes.map((shape) => shape.name)).toEqual([
		"wire 2",
		"wire 3",
		"wire 4",
	]);
	const [first, second, third] = view.shapes;
	expect(first.x).toBeCloseTo(g(52), 4);
	expect(first.y).toBeCloseTo(g(40), 4);
	expect(first.width).toBeCloseTo(g(24), 4);
	expect(first.rotation).toBeCloseTo(0, 4);
	expect(second.x).toBeCloseTo(g(64), 4);
	expect(second.y).toBeCloseTo(g(53), 4);
	expect(second.width).toBeCloseTo(g(26), 4);
	expect(second.rotation).toBeCloseTo(Math.PI / 2, 4);
	expect(third.x).toBeCloseTo(g(53), 4);
	expect(third.y).toBeCloseTo(g(66), 4);
	expect(third.width).toBeCloseTo(g(22), 4);
	expect(Math.abs(third.rotation)).toBeCloseTo(Math.PI, 4);
	await moveAt(page, g(46), g(84));
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(g(18), 4);
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("drawing-line-chain.png"),
		});
	await clickAt(page, g(42), g(66));
	await clickAt(page, g(42), g(66));
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await nonPinState(page)).preview).toBeNull();
});

test("ruler position guide follows the object center through release and cancellation", async ({
	page,
}) => {
	await createShape(page, "Rectangle", g(40), g(40));
	await expect(page.getByTestId("ruler-position-guide")).toHaveAttribute(
		"data-source",
		"cursor",
	);
	const start = await screen(page, g(32), g(40));
	const end = await screen(page, g(52), g(56));
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await expect(page.getByTestId("ruler-position-guide")).toHaveAttribute(
		"data-source",
		"cursor",
	);
	await page.mouse.move(end.x, end.y, { steps: 4 });
	const crosshair = page.getByTestId("ruler-position-guide");
	await expect(crosshair).toHaveAttribute("data-source", "object");
	const center = await screen(page, g(60), g(56));
	const box = required(await crosshair.boundingBox());
	await expect
		.poll(async () =>
			Number(await crosshair.locator("line").nth(0).getAttribute("y1")),
		)
		.toBeCloseTo(center.y - box.y, 0);
	await expect
		.poll(async () =>
			Number(await crosshair.locator("line").nth(1).getAttribute("x1")),
		)
		.toBeCloseTo(center.x - box.x, 0);
	await page.screenshot({ path: "/tmp/ecad-ruler-position-guide.png" });
	await page.mouse.up();
	await expect(crosshair).toHaveAttribute("data-source", "cursor");
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 40, center.y - 25, { steps: 3 });
	await expect(crosshair).toHaveAttribute("data-source", "object");
	await page.keyboard.press("Escape");
	await expect(crosshair).toHaveAttribute("data-source", "cursor");
	await page.mouse.up();
	await expect
		.poll(async () => (await state(page)).shapes[0].x)
		.toBeCloseTo(g(60), 4);
	await expect
		.poll(async () => (await state(page)).shapes[0].y)
		.toBeCloseTo(g(56), 4);
});

test("R and Shift+R rotate a symbol during placement", async ({ page }) => {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	await moveAt(page, g(48), g(48));
	await page.locator("canvas").focus();
	await expect
		.poll(async () => (await state(page)).placement?.rotation)
		.toBe(0);
	const before = await page.locator("#editor-document").textContent();
	const initial = required((await state(page)).placement);
	for (const [key, angle] of [
		["r", Math.PI / 2],
		["Shift+r", 0],
		["r", Math.PI / 2],
	] as const) {
		await page.keyboard.press(key);
		await expect
			.poll(async () => (await state(page)).placement?.rotation)
			.toBeCloseTo(angle, 4);
	}
	expect(await page.locator("#editor-document").textContent()).toBe(before);
	expect((await state(page)).placement?.x).toBeCloseTo(initial.x, 4);
	expect((await state(page)).placement?.y).toBeCloseTo(initial.y, 4);
	const rotated = required((await state(page)).placement);
	await moveAt(page, g(64), g(60));
	await expect
		.poll(async () => (await state(page)).placement?.x)
		.toBeCloseTo(rotated.x + g(16), 4);
	await expect
		.poll(async () => (await state(page)).placement?.y)
		.toBeCloseTo(rotated.y + g(12), 4);
	const preview = required((await state(page)).placement);
	await clickAt(page, g(64), g(60));
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await page.locator("#editor-document").textContent()) || "{}",
				).shapes.length,
		)
		.toBe(1);
	const placed = JSON.parse(
		(await page.locator("#editor-document").textContent()) || "{}",
	).shapes[0];
	expect(placed.rotation).toBeCloseTo(Math.PI / 2, 4);
	await expect
		.poll(async () => (await state(page)).shapes[0]?.rotation)
		.toBeCloseTo(Math.PI / 2, 4);
	const rendered = (await state(page)).shapes[0];
	expect(rendered.x).toBeCloseTo(preview.x, 4);
	expect(rendered.y).toBeCloseTo(preview.y, 4);
	await expect.poll(async () => (await state(page)).placement).toBeNull();
	await page.locator("canvas").focus();
	await page.keyboard.press("Control+z");
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await page.locator("#editor-document").textContent()) || "{}",
				).shapes.length,
		)
		.toBe(0);
});

/**
 * Decodes PNG screenshots in the page and runs `measure` on their RGBA pixels
 * there, so only its result crosses back.
 */
async function inPixels<Arg, Result>(
	page: Page,
	pngs: Buffer[],
	measure: (images: ImageData[], arg: Arg) => Result,
	arg: Arg,
): Promise<Result> {
	return page.evaluate(
		async ({ data, measure, arg }) => {
			const images = await Promise.all(
				data.map(async (png) => {
					const image = new Image();
					image.src = `data:image/png;base64,${png}`;
					await image.decode();
					const canvas = document.createElement("canvas");
					canvas.width = image.width;
					canvas.height = image.height;
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Expected a 2D context");
					context.drawImage(image, 0, 0);
					return context.getImageData(0, 0, image.width, image.height);
				}),
			);
			return new Function("images", "arg", `return (${measure})(images, arg)`)(
				images,
				arg,
			) as Result;
		},
		{
			data: pngs.map((png) => png.toString("base64")),
			measure: measure.toString(),
			arg,
		},
	);
}

test("panning shows the same picture as a full redraw", async ({ page }) => {
	await page.evaluate(async () => {
		const path = "/packages/core/src/performance/runtime.ts";
		const runtime = (await import(
			path
		)) as typeof import("#/performance/runtime.ts");
		runtime.initializePerformance();
	});
	await createShape(page, "Rectangle", g(40), g(40));
	await createShape(page, "Wire", g(20), g(20));
	const canvas = page.locator("canvas");
	const panned = () =>
		page.evaluate(
			() =>
				window.__ecadPerformance
					?.snapshot()
					.events.filter(
						(event) =>
							event.name === "renderer.frame" && event.data?.panned === true,
					).length ?? 0,
		);
	const settle = () =>
		page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
	await page.keyboard.press("Escape");
	await settle();
	const before = await panned();
	const box = required(await canvas.boundingBox());
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (const [x, y] of [
		[37, 0],
		[0, -23],
		[-61.5, 45.25],
		[12, 9],
	]) {
		await page.mouse.wheel(x, y);
		await settle();
	}
	expect(await panned()).toBeGreaterThan(before);
	// The drawing area inside the rulers, without the toolbar floating over it.
	const area = () =>
		page.screenshot({
			mask: [page.getByRole("toolbar")],
			clip: {
				x: box.x,
				y: box.y,
				width: box.width - 25,
				height: box.height - 25,
			},
		});
	const shifted = await area();
	// Selecting and clearing the rectangle redraws the whole scene in place.
	const rectangle = await screen(page, g(40), g(40));
	const remove = page.getByRole("button", { name: "Delete", exact: true });
	await page.mouse.click(rectangle.x, rectangle.y);
	await expect(remove).toBeEnabled();
	await page.keyboard.press("Escape");
	await expect(remove).toBeDisabled();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await settle();
	// Grid dot coverage may round differently by a level.
	expect(
		await inPixels(
			page,
			[shifted, await area()],
			([first, second]) =>
				first.data.filter(
					(value, index) => Math.abs(value - second.data[index]) > 2,
				).length,
			undefined,
		),
	).toBe(0);
});
