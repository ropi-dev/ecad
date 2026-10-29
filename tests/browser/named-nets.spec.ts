import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 900 } });

test("place and edit electrical labels without changing ordinary text", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const document = async () =>
		JSON.parse((await page.locator("#editor-document").textContent()) || "{}");
	const clickAt = async (x: number, y: number) => {
		const view = JSON.parse(
			(await page.locator("#editor-scene").textContent()) || "{}",
		);
		const box = (await page.locator("canvas").boundingBox())!;
		await page.mouse.click(
			box.x +
				((1 + view.origin[0] + ((view.corner[0] - view.origin[0]) * x) / 420) *
					box.width) /
					2,
			box.y +
				((1 - view.origin[1] - ((view.corner[1] - view.origin[1]) * y) / 297) *
					box.height) /
					2,
		);
	};
	await (await toolbarButton(page, "Net label")).click();
	await clickAt(-80, 40);
	await page
		.getByRole("textbox", { name: "Net name", exact: true })
		.fill("+3V3");
	await page
		.getByRole("textbox", { name: "Net name", exact: true })
		.press("Tab");
	await expect
		.poll(async () => (await document()).shapes[0]?.text)
		.toBe("+3V3");
	await expect(page.getByLabel("Label role", { exact: true })).toHaveValue(
		"net",
	);
	await page.getByLabel("Label role", { exact: true }).selectOption("supply");
	await expect
		.poll(async () => (await document()).shapes[0]?.electrical)
		.toBe("supply");
	await expect(page.getByTestId("text-anchor")).toHaveCount(1);
	await (await toolbarButton(page, "Supply label")).click();
	await clickAt(0, 40);
	await expect(
		page.getByRole("textbox", { name: "Net name", exact: true }),
	).toHaveValue("GND");
	await page
		.getByRole("textbox", { name: "Net name", exact: true })
		.fill("+3V3");
	await page
		.getByRole("textbox", { name: "Net name", exact: true })
		.press("Tab");
	await expect
		.poll(async () => (await document()).shapes[1]?.text)
		.toBe("+3V3");
	if (captureArtifacts)
		await page.screenshot({
			path: "artifacts/named-nets-editor.png",
			fullPage: true,
		});
	await page.getByLabel("Label role", { exact: true }).selectOption("text");
	await expect(
		page.getByRole("textbox", { name: "Text content", exact: true }),
	).toHaveValue("+3V3");
	await expect
		.poll(async () => (await document()).shapes[1]?.electrical)
		.toBeUndefined();
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(async () => (await document()).shapes[1]?.electrical)
		.toBe("supply");
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(-80, 40);
	await clickAt(-40, 40);
	await page.keyboard.press("Enter");
	await expect
		.poll(
			async () =>
				(await document()).shapes.filter(
					(shape: { kind: string }) => shape.kind === "wire",
				).length,
		)
		.toBe(1);
});

test("electrical labels use the normal grid for dragging and keyboard movement", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await expect(page.locator("canvas")).toBeVisible();
 const { rulerSpacing } = await import("#/engine/ruler.ts");
 const box = (await page.locator("canvas").boundingBox())!;
 const view = JSON.parse((await page.locator("#editor-scene").textContent())!);
 const scale = (view.corner[0] - view.origin[0]) * box.width / 840;
 const step = rulerSpacing(scale).minor;
 const screen = (x: number, y: number) => ({
  x: box.x + (1 + view.origin[0]) * box.width / 2 + x * scale,
  y: box.y + (1 - view.origin[1]) * box.height / 2 - y * scale,
 });
 const document = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
 for (const electrical of ["net", "supply", undefined]) {
  await page.evaluate(async electrical => {
   const path = "/tests/browser/editor.tsx";
   const { replaceShapes, placeRectangle, drawingStore } = await import(path);
   if (!drawingStore.getSnapshot().shapes.length) placeRectangle({ x: 0, y: 0, width: 10, height: 3, rotation: 0, lineWidth: 0.2 });
   replaceShapes([{ id: 1, kind: "text", x: 0, y: 0, width: 10, height: 3, rotation: 0, lineWidth: 0.2, fontSize: 2, text: "SIGNAL", horizontalAlign: "left", verticalAlign: "bottom", electrical }]);
  }, electrical);
  const source = screen(5, 1.5);
  await page.mouse.click(source.x, source.y);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("resize-handle")).toHaveCount(electrical ? 0 : 4);
  await expect(page.getByRole("spinbutton", { name: "Width", exact: true })).toHaveCount(electrical ? 0 : 1);
  await expect(page.getByRole("spinbutton", { name: "Height", exact: true })).toHaveCount(electrical ? 0 : 1);
  const snapStep = electrical ? step : step / 10;
  await expect.poll(async () => (await document()).shapes[0].x).toBeCloseTo(snapStep, 6);
  const start = screen(snapStep + 5, 1.5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + step * 1.4 * scale, start.y + step * 1.4 * scale, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await document()).shapes[0].x).toBeCloseTo(electrical ? step * 2 : step * 1.5, 6);
  await expect.poll(async () => (await document()).shapes[0].y).toBeCloseTo(electrical ? -step : -step * 1.4, 6);
  if (electrical === "net") await page.screenshot({ path: "artifacts/net-label-no-resize.png" });
 }
});
