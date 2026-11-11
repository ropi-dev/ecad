import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	ready,
	report,
	savedShapes,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-placement-rotate",
	{ tag: ["@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/editor?perf=1");
		await ready(page);
		const canvas = page.locator("canvas");
		const box = required(await canvas.boundingBox());
		for (let repeat = 0; repeat < 3; repeat++) {
			await page.getByRole("button", { name: "Symbols", exact: true }).click();
			await page
				.getByRole("button", { name: "Insert Resistor", exact: true })
				.click();
			await page.mouse.move(
				box.x + box.width / 2 + repeat * 30,
				box.y + box.height / 2,
			);
			await canvas.focus();
			await interaction(page, "placement.rotate", async () => {
				await page.keyboard.press("r");
				await page.keyboard.press("Shift+r");
				await page.keyboard.press("r");
				await page.mouse.move(
					box.x + box.width / 2 + repeat * 30,
					box.y + box.height / 2 + 30,
				);
				await page.mouse.click(
					box.x + box.width / 2 + repeat * 30,
					box.y + box.height / 2 + 30,
				);
				await page.waitForFunction(
					(id) =>
						document.querySelector(
							`[data-testid="text-anchor"][data-anchor-id^="${id}:label:"]`,
						),
					repeat + 1,
					{ polling: "raf" },
				);
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() =>
								requestAnimationFrame(() => resolve()),
							),
						),
				);
			});
			await expect(
				page.getByRole("button", { name: "Select", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
		}
		const project = required(
			await page.evaluate(() => localStorage.getItem("ecad.active-project")),
		);
		await expect
			.poll(async () =>
				(await savedShapes<{ kind: string; rotation: number }>(page, project))
					?.filter((shape) => shape.kind === "symbol")
					.map((shape) => Math.round((shape.rotation * 180) / Math.PI)),
			)
			.toEqual([90, 90, 90]);
		const value = await report(page);
		await finish(page, testInfo, "editor-placement-rotate", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
