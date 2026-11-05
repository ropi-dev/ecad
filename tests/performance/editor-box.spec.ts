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
	for (let repeat = 0; repeat < 3; repeat++) {
		await selectParent();
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
			await input.fill(String(0.4 + repeat * 0.1));
			await input.press("Tab");
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
		await page.mouse.click(
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
