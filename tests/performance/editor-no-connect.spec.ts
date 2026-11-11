import { snapCoordinate } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, type Page, test } from "@playwright/test";
import { drawingGridStep, drawingPoint } from "../browser/symbol-items";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

async function snappedPosition(page: Page, position: { x: number; y: number }) {
	const box = required(await page.locator("canvas").boundingBox());
	const zero = await drawingPoint(page, { x: 0, y: 0 });
	const unit = await drawingPoint(page, { x: 1, y: 1 });
	const step = await drawingGridStep(page);
	const world = (axis: "x" | "y") =>
		snapCoordinate(
			(box[axis] + position[axis] - zero[axis]) / (unit[axis] - zero[axis]),
			step,
		);
	const point = await drawingPoint(page, { x: world("x"), y: world("y") });
	return { x: point.x - box.x, y: point.y - box.y };
}

test("editor-no-connect", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	const pin = { x: bounds.width * 0.45, y: bounds.height / 2 };
	await (await toolbarButton(page, "Pin")).click();
	await canvas.click({ position: pin });
	const terminal = await snappedPosition(page, pin);
	// Shift keeps the press on the pin from starting a wire.
	const open = () =>
		canvas.dblclick({ position: terminal, modifiers: ["Shift"] });
	await open();
	const pinX = await page
		.getByRole("spinbutton", { name: "Center X", exact: true })
		.inputValue();
	for (let repeat = 0; repeat < 3; repeat++) {
		await (await toolbarButton(page, "No connect")).click();
		await interaction(page, "no-connect.place", async () => {
			await canvas.click({ position: { x: pin.x + 2, y: pin.y + 2 } });
			await page.waitForFunction(() =>
				document.querySelector('[data-tool="select"]'),
			);
		});
		await open();
		await expect(
			page.getByRole("spinbutton", { name: "Center X", exact: true }),
		).toHaveValue(pinX);
		await expect(page.getByText("no-connect", { exact: true })).toBeVisible();
		if (repeat === 2) {
			await page.keyboard.press("F6");
			await page.mouse.move(50, 50);
			await page.screenshot({ path: "/tmp/ecad-no-connect.png" });
		}
		await (await toolbarButton(page, "Undo")).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-no-connect", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
