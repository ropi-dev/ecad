import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
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

test(
	"editor-text-duplicate",
	{ tag: ["@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/editor?perf=1");
		await ready(page);
		await expect(
			page.getByRole("button", { name: "Select", exact: true }),
		).toBeEnabled();
		const bounds = required(await page.locator("canvas").boundingBox());
		const sources = [
			{
				kind: "Net label",
				field: "Net name",
				text: "SIGNAL",
				x: bounds.x + bounds.width * 0.3,
				y: bounds.y + bounds.height * 0.45,
				// A net label extends up and right from its anchor, so grab its
				// 75 mil text, which is only a few pixels tall at this zoom.
				grab: { x: 8, y: -1 },
			},
			{
				kind: "Text",
				field: "Text content",
				text: "Board notes",
				x: bounds.x + bounds.width * 0.5,
				y: bounds.y + bounds.height * 0.45,
				grab: { x: 0, y: 0 },
			},
		];
		let saves = await saveCount(page);
		for (const source of sources) {
			await (await toolbarButton(page, source.kind)).click();
			await page.mouse.click(source.x, source.y);
			const field = page.getByRole("textbox", {
				name: source.field,
				exact: true,
			});
			await field.fill(source.text);
			await field.press("Tab");
		}
		await expect(page.locator('[data-tool="select"]')).toBeAttached();
		await saved(page, saves);
		let expectedId = 3;
		for (const source of sources) {
			for (let repeat = 0; repeat < 3; repeat++) {
				const grab = {
					x: source.x + source.grab.x,
					y: source.y + source.grab.y,
				};
				await pointAt(page, grab);
				saves = await saveCount(page);
				await interaction(page, "text.duplicate", async () => {
					await page.keyboard.down("Alt");
					await page.mouse.move(grab.x, grab.y);
					await page.mouse.down();
					await page.mouse.move(grab.x + 80 + repeat * 40, grab.y + 60, {
						steps: 4,
					});
					await page.mouse.up();
					await page.keyboard.up("Alt");
					await expect(
						page.locator(
							`[data-testid="text-anchor"][data-anchor-id="${expectedId++}"]`,
						),
					).toBeAttached();
				});
				await saved(page, saves);
			}
		}
		const value = await report(page);
		await finish(page, testInfo, "editor-text-duplicate", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
