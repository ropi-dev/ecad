import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { expect, test } from "@playwright/test";
import { selectSymbolParent } from "../browser/symbol-items";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	committed,
	finish,
	interaction,
	metric,
	pointAt,
	ready,
	report,
	saveCount,
	saved,
} from "./app-helpers.ts";

setupAppTests();

test("editor-box", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Box", exact: true }).click();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	await canvas.click({
		position: { x: bounds.width / 2, y: bounds.height / 2 },
	});
	const selectParent = () => selectSymbolParent(page);
	const openBox = async () => {
		const handle = (id: string) =>
			page
				.locator(`[data-testid="resize-handle"][data-handle="${id}"]`)
				.boundingBox()
				.then(required);
		const [middle, corner] = await Promise.all([handle("0,1"), handle("1,1")]);
		// Shift keeps the press on the selected box from picking a label.
		await canvas.dblclick({
			position: {
				x: (middle.x + corner.x + middle.width) / 2 - bounds.x,
				y: (middle.y + corner.y + middle.height) / 2 - bounds.y,
			},
			modifiers: ["Shift"],
		});
		await expect(
			page.getByRole("spinbutton", { name: "Font size", exact: true }),
		).toBeVisible();
	};
	for (let repeat = 0; repeat < 3; repeat++) {
		await selectParent();
		await openBox();
		const saves = await saveCount(page);
		await interaction(page, "box.font-size", async () => {
			const value = 120 + repeat * 20;
			const input = page.getByRole("spinbutton", {
				name: "Font size",
				exact: true,
			});
			await input.fill(String(value));
			await input.press("Tab");
			await committed(page, "Font size", fromMils(value));
		});
		await saved(page, saves);
		await selectParent();
		await expect(page.getByTestId("resize-handle")).toHaveCount(8);
		const corner = page.locator(
			'[data-testid="resize-handle"][data-handle="1,1"]',
		);
		const handle = required(await corner.boundingBox());
		const grab = {
			x: handle.x + handle.width / 2,
			y: handle.y + handle.height / 2,
		};
		await pointAt(page, grab);
		await interaction(page, "box.resize", async () => {
			await page.mouse.move(grab.x, grab.y);
			await page.mouse.down();
			await page.mouse.move(handle.x + 25, handle.y - 15, { steps: 3 });
			await page.mouse.up();
			await page.waitForFunction(
				(before) => {
					const box = document
						.querySelector('[data-testid="resize-handle"][data-handle="1,1"]')
						?.getBoundingClientRect();
					return box !== undefined && box.x > before.x + 10;
				},
				handle,
				{ polling: "raf" },
			);
		});
		await interaction(page, "box.border", async () => {
			await page
				.getByRole("combobox", { name: "Line style", exact: true })
				.selectOption(repeat % 2 ? "dotted" : "dashed");
			const input = page.getByRole("spinbutton", {
				name: "Line width",
				exact: true,
			});
			// A symbol's Line width is entered in mils: 16, 20 and 24 mil are
			// about 0.41, 0.51 and 0.61 mm. Entering millimeters here would draw
			// a hairline whose dash pattern hits the cycle cap.
			const width = 16 + repeat * 4;
			await input.fill(String(width));
			await input.press("Tab");
			await committed(page, "Line width", fromMils(width));
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
		const textAnchor = required(
			await page.locator('[data-anchor-id="1:text:2"]').boundingBox(),
		);
		await page.mouse.dblclick(
			textAnchor.x + textAnchor.width / 2 + 5,
			textAnchor.y + textAnchor.height / 2 + 5,
		);
		await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
		await interaction(page, "box.text", async () => {
			const content = page.getByRole("textbox", {
				name: "Text content",
				exact: true,
			});
			await content.fill(`Power supply ${repeat + 1}\n3.3 V`);
			await content.press("Tab");
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-box", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
