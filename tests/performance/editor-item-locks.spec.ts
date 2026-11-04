import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-item-locks", async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		const file = {
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "lock-part",
			name: "Lock part",
			description: "",
			prefix: "U",
			value: "",
			shapes: [
				{ kind: "rectangle", x: 0, y: 0, width: 40, height: 160 },
				{
					kind: "text",
					text: "Controller",
					x: 0,
					y: 0,
					width: 15,
					height: 3,
					fontSize: 2,
				},
				...Array.from({ length: 128 }, (_, index) => ({
					kind: "pin",
					x: index < 64 ? -20 : 20,
					y: ((index % 64) - 32) * 2.54,
					name: `Signal ${index + 1}`,
					number: String(index + 1),
					locked: index === 0,
				})),
			],
		};
		localStorage.setItem(
			"ecad.user-config.v1",
			JSON.stringify({
				version: 1,
				symbolLibraries: [
					{
						id: "locks",
						name: "Locks",
						enabled: true,
						source: { kind: "embedded", symbols: [file] },
					},
				],
			}),
		);
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Lock part", exact: true })
		.click();
	const canvas = page.locator("canvas");
	const box = required(await canvas.boundingBox());
	const position = { x: box.width * 0.45, y: box.height * 0.5 };
	await canvas.click({ position });
	await expect(page.getByTestId("symbol-child-selection")).toHaveCount(0);
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "symbol.lock", async () => {
			if (repeat === 1)
				await page
					.getByRole("checkbox", { name: "Locked", exact: true })
					.click();
			else
				await page
					.getByRole("button", { name: "Lock selection", exact: true })
					.click();
			await page.waitForFunction(
				() => !document.querySelector('[aria-label="Selection attributes"]'),
				undefined,
				{ polling: "raf" },
			);
		});
		await interaction(page, "symbol.select-locked", async () => {
			await page
				.getByRole("button", { name: "Select locked items", exact: true })
				.click();
			await canvas.click({ position });
			await page.waitForFunction(
				() =>
					document.querySelector<HTMLButtonElement>(
						'button[aria-label="Unlock selection"]',
					)?.disabled === false,
				undefined,
				{ polling: "raf" },
			);
		});
		await interaction(page, "symbol.unlock", async () => {
			if (repeat === 1)
				await page
					.getByRole("checkbox", { name: "Locked", exact: true })
					.uncheck();
			else
				await page
					.getByRole("button", { name: "Unlock selection", exact: true })
					.click();
			await page
				.getByRole("button", { name: "Select locked items", exact: true })
				.click();
			await page.waitForFunction(
				() =>
					document.querySelector<HTMLButtonElement>(
						'button[aria-label="Lock selection"]',
					)?.disabled === false,
				undefined,
				{ polling: "raf" },
			);
		});
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-item-locks", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
