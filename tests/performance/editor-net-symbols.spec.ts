import { snapCoordinate } from "@ecad/drawing-core/drawing/shapes.ts";
import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { expect, type Page, test } from "@playwright/test";
import { drawingGridStep, drawingPoint } from "../browser/symbol-items";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

async function placedPoint(
	page: Page,
	position: { x: number; y: number },
	offset: { x: number; y: number },
) {
	const box = required(await page.locator("canvas").boundingBox());
	const zero = await drawingPoint(page, { x: 0, y: 0 });
	const unit = await drawingPoint(page, { x: 1, y: 1 });
	const step = await drawingGridStep(page);
	const world = (axis: "x" | "y") =>
		snapCoordinate(
			(box[axis] + position[axis] - zero[axis]) / (unit[axis] - zero[axis]),
			step,
		) + offset[axis];
	return drawingPoint(page, { x: world("x"), y: world("y") });
}

test("editor-net-symbols", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	for (const name of ["Ground", "VDD"]) {
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page.getByRole("searchbox", { name: "Search symbols" }).fill(name);
		await page
			.getByRole("button", { name: `Insert ${name}`, exact: true })
			.click();
		const canvas = page.locator("canvas");
		const bounds = required(await canvas.boundingBox());
		const position = {
			x: bounds.width * (name === "Ground" ? 0.35 : 0.55),
			y: bounds.height * 0.45,
		};
		await canvas.click({ position });
		const body = await placedPoint(page, position, {
			x: 0,
			y: fromMils(name === "Ground" ? 0 : 50),
		});
		// Shift keeps the press from starting a wire or picking a pin.
		await canvas.dblclick({
			position: { x: body.x - bounds.x, y: body.y - bounds.y },
			modifiers: ["Shift"],
		});
		await expect(
			page.getByRole("checkbox", { name: "Net symbol", exact: true }),
		).toBeChecked();
		await expect(
			page.getByRole("textbox", { name: "Reference", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("textbox", { name: "Value", exact: true }),
		).toHaveCount(0);
		const netName = page.getByRole("textbox", { name: "Name", exact: true });
		await expect(netName).toHaveValue(name === "Ground" ? "GND" : "VDD");
		await interaction(page, "net-symbol.rename", async () => {
			await netName.fill("+3V3");
			await netName.press("Tab");
			await expect(netName).toHaveAttribute("data-committed-value", "+3V3");
		});
		await interaction(page, "net-symbol.role", async () => {
			await page
				.getByRole("checkbox", { name: "Net symbol", exact: true })
				.uncheck();
			await expect(
				page.getByRole("textbox", { name: "Name", exact: true }),
			).toHaveValue("+3V3");
			await page
				.getByRole("checkbox", { name: "Net symbol", exact: true })
				.check();
			await expect(netName).toHaveValue("+3V3");
		});
	}
	await page.screenshot({ path: "/tmp/ecad-net-symbols/interface.png" });
	await finish(page, testInfo, "editor-net-symbols", {
		interactionP95Ms: required(
			metric(await report(page), "scenario.interaction"),
		),
	});
});
