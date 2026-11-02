import { captureArtifacts } from "./artifacts";
import { toolbarButton } from "./toolbar";
import { expect, type Page, test } from "@playwright/test";
import { SCHEMATIC_STEP } from "#/drawing/units.ts";
import { lightSchematicTheme } from "#/drawing/schematic-theme.ts";

const [selected, highlighted, wire] = (
	["selected", "highlighted", "wire"] as const
).map((appearance) => lightSchematicTheme.appearance[appearance].slice(1));

test.use({ viewport: { width: 1440, height: 900 } });

interface State {
	pinTexts: { name: string; texture?: string; rotation: number }[];
	symbolTexts: {
		symbol: string;
		name: string;
		texture?: string;
		x: number;
		y: number;
	}[];
	outlines: { width: number; height: number }[];
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
	const box = (await page.locator("canvas").boundingBox())!;
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
	if (kind === "Circle") await dragTo(page, [x, y], [x + 15, y]);
	else if (kind === "Wire") {
		await placePin(page, x - 27.5, y);
		// Keep the attributes panel from covering the wire's far endpoint.
		await page
			.getByRole("button", { name: "Clear selection", exact: true })
			.click();
		await (await toolbarButton(page, "Wire")).click();
		await clickAt(page, x - 27.5, y);
		await clickAt(page, x + 27.5, y);
		await page.keyboard.press("Enter");
	} else {
		const [width, height] = kind === "Rectangle" ? [50, 30] : [40, 35];
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
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await expect(snap).toHaveAttribute("aria-pressed", "true");
	// Free-placement fixtures opt out of the default; snapping tests enable it explicitly.
	await snap.click();
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
		await createShape(page, kind, 70 + index * 85, 150);
		await expect
			.poll(async () => (await nonPinState(page)).shapes.length)
			.toBe(index + 1);
	}
	await dragTo(page, [70, 150], [100, 180]);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(100, 1);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(180, 1);
	expect((await nonPinState(page)).origin).toEqual(before.origin);
	await dragTo(page, [100, 180], [-30, 330]);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(-30, 4);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(330, 4);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(-30 + SCHEMATIC_STEP, 4);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].y)
		.toBeCloseTo(330 - 10 * SCHEMATIC_STEP, 4);
	await page.keyboard.press("Delete");
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	await (await toolbarButton(page, "Rectangle")).click();
	await clickAt(page, -25, 150);
	expect((await nonPinState(page)).shapes.length).toBe(3);
	expect(errors).toEqual([]);
});

test("wire clicks commit orthogonal segments and pointer release keeps the preview", async ({
	page,
}) => {
	await placePin(page, 100, 100);
	await (await toolbarButton(page, "Wire")).click();
	await dragTo(page, [100, 100], [160, 120]);
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(60, 4);
	let view = await nonPinState(page);
	expect(view.shapes).toEqual([]);
	expect(view.preview?.x).toBeCloseTo(130, 4);
	expect(view.preview?.y).toBeCloseTo(100, 4);
	expect(view.preview?.rotation).toBeCloseTo(0, 4);
	await clickAt(page, 160, 120);
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(1);
	await expect(await toolbarButton(page, "Wire")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await moveAt(page, 172, 165);
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(65, 4);
	view = await nonPinState(page);
	expect(view.shapes).toHaveLength(1);
	expect(view.preview?.x).toBeCloseTo(160, 4);
	expect(view.preview?.y).toBeCloseTo(132.5, 4);
	expect(view.preview?.rotation).toBeCloseTo(Math.PI / 2, 4);
	await clickAt(page, 172, 165);
	await clickAt(page, 105, 174);
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
	expect(first.x).toBeCloseTo(130, 4);
	expect(first.y).toBeCloseTo(100, 4);
	expect(first.width).toBeCloseTo(60, 4);
	expect(first.rotation).toBeCloseTo(0, 4);
	expect(second.x).toBeCloseTo(160, 4);
	expect(second.y).toBeCloseTo(132.5, 4);
	expect(second.width).toBeCloseTo(65, 4);
	expect(second.rotation).toBeCloseTo(Math.PI / 2, 4);
	expect(third.x).toBeCloseTo(132.5, 4);
	expect(third.y).toBeCloseTo(165, 4);
	expect(third.width).toBeCloseTo(55, 4);
	expect(Math.abs(third.rotation)).toBeCloseTo(Math.PI, 4);
	await moveAt(page, 115, 210);
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(45, 4);
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("drawing-line-chain.png"),
		});
	await clickAt(page, 105, 165);
	await clickAt(page, 105, 165);
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await nonPinState(page)).preview).toBeNull();
});


test("selected schematic wires keep a distinct color from related net wires", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await expect(page.locator("canvas")).toBeVisible();
 await page.evaluate(async () => {
  const fixturePath = "/tests/browser/editor.tsx";
  const shapesPath = "/packages/core/src/drawing/shapes.ts";
  const { drawingStore } = await import(fixturePath);
  const storePath = "/packages/core/src/commands/drawing-store.ts";
  const { createDrawingStore } = await import(storePath);
  const { drawShape } = await import(shapesPath);
  const wire = (id: number, x: number, y: number, endX: number, endY: number) => ({...drawShape(id, "wire", {x,y}, {x:endX,y:endY}),lineWidth:0.6});
  const label = { id:5,kind:"text",x:0,y:60,width:20,height:5,fontSize:3,lineWidth:0.3,rotation:0, text:"SIGNAL", electrical:"net" };
  const shapes = [wire(1,-100,0,0,0), wire(2,0,0,0,60), wire(3,40,0,100,0), wire(4,-50,-30,-50,30), label, {...label,id:6,x:40,y:0}];
  drawingStore.transact(() => [undefined, createDrawingStore(shapes).getSnapshot()]);
 });
 await expect.poll(async () => (await state(page)).shapes.filter(shape => shape.name.startsWith("wire ")).length).toBe(4);
 await clickAt(page, -75, 0);
 const colors = async () => (await state(page)).shapes.filter(shape => shape.name.startsWith("wire ")).map(shape => shape.color);
 await expect.poll(colors).toEqual([selected, highlighted, highlighted, wire]);
 if (process.env.ECAD_SCHEMATIC_SCREENSHOT_PATH) await page.screenshot({path:process.env.ECAD_SCHEMATIC_SCREENSHOT_PATH});
 await page.keyboard.press("Escape");
 await expect.poll(colors).toEqual([wire, wire, wire, wire]);
 await clickAt(page, 0, 30);
 await expect.poll(colors).toEqual([highlighted, selected, highlighted, wire]);
});
