import { captureArtifacts } from "./artifacts";
import { expect, test, type Page } from "@playwright/test";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!);
const scene = async (page: Page) =>
	JSON.parse((await page.locator("#editor-scene").textContent())!);

async function expectAnchor(
	page: Page,
	id: string,
	point: { x: number; y: number },
) {
	const marker = page.locator(
		`[data-testid="text-anchor"][data-anchor-id="${id}"]`,
	);
	await expect(marker).toBeVisible();
	await expect
		.poll(async () => {
			const data = await scene(page);
			const canvas = (await page.locator("canvas").boundingBox())!;
			const expectedX =
				canvas.x +
				((1 +
					data.origin[0] +
					((data.corner[0] - data.origin[0]) * point.x) / 420) *
					canvas.width) /
					2;
			const expectedY =
				canvas.y +
				((1 -
					data.origin[1] -
					((data.corner[1] - data.origin[1]) * point.y) / 297) *
					canvas.height) /
					2;
			const bounds = (await marker.boundingBox())!;
			return Math.max(
				Math.abs(bounds.x + bounds.width / 2 - expectedX),
				Math.abs(bounds.y + bounds.height / 2 - expectedY),
			);
		})
		.toBeLessThan(1);
	await expect(marker).toHaveCSS("width", "9px");
	await expect(marker).toHaveCSS("height", "9px");
	await expect(marker).toHaveCSS("z-index", "1");
	await expect(marker).toHaveCSS("pointer-events", "none");
}

test("text alignment moves rendered bounds, updates multiline textures and supports undo", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	await (await toolbarButton(page, "Text")).click();
	await page.locator("canvas").click({ position: { x: 600, y: 430 } });
	const content = page.getByRole("textbox", {
		name: "Text content",
		exact: true,
	});
	await content.fill("Supply voltage\n3.3 V");
	await content.press("Tab");
	const h = page.getByRole("combobox", {
		name: "Text horizontal alignment",
		exact: true,
	});
	const v = page.getByRole("combobox", {
		name: "Text vertical alignment",
		exact: true,
	});
	const before = await state(page);
	await h.selectOption("left");
	await v.selectOption("top");
	await expectAnchor(page, "1", before.shapes[0]);
	const aligned = (await state(page)).shapes[0];
	expect(aligned).toMatchObject({
		x: before.shapes[0].x,
		y: before.shapes[0].y,
		horizontalAlign: "left",
		verticalAlign: "top",
	});
	await expect
		.poll(async () => (await scene(page)).shapes[0]?.x)
		.toBeCloseTo(aligned.x + aligned.width / 2);
	await expect
		.poll(async () => (await scene(page)).shapes[0]?.y)
		.toBeCloseTo(aligned.y - aligned.height / 2);
	const texture = (await scene(page)).shapes[0].texture;
	await h.selectOption("right");
	await expect
		.poll(async () => (await scene(page)).shapes[0]?.texture)
		.not.toBe(texture);
	await (await toolbarButton(page, "Undo")).click();
	await expect(h).toHaveValue("left");
	await (await toolbarButton(page, "Redo")).click();
	await expect(h).toHaveValue("right");
	const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
	await angle.fill("90");
	await angle.press("Tab");
	await expect
		.poll(async () => (await scene(page)).shapes[0]?.x)
		.toBeCloseTo(aligned.x + aligned.height / 2);
	await expect
		.poll(async () => (await scene(page)).shapes[0]?.y)
		.toBeCloseTo(aligned.y - aligned.width / 2);
	await expectAnchor(page, "1", aligned);
	await angle.fill("0");
	await angle.press("Tab");
	await h.selectOption("left");
	for (let i = 0; i < 6; i++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expectAnchor(page, "1", aligned);
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("text-alignment.png"),
		});
	await page
		.getByRole("button", { name: "Clear selection", exact: true })
		.click();
	await expect(page.getByTestId("text-anchor")).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
});
