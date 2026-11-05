import { expect, test } from "@playwright/test";
import { drawingPoint } from "../browser/symbol-items";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test(
	"editor-physical-zoom",
	{ tag: ["@editor"] },
	async ({ page }, testInfo) => {
		const session = await page.context().newCDPSession(page);
		await session.send("Emulation.setDeviceMetricsOverride", {
			width: 1280,
			height: 800,
			deviceScaleFactor: 2,
			mobile: false,
		});
		await page.addInitScript(() => {
			let calibration: { pixelsPerMm: number } | null = { pixelsPerMm: 6.4 };
			const listeners = new Set<() => void>();
			window.ecadDisplay = {
				getCalibration: async () => calibration,
				onChanged: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			};
			window.addEventListener("test-display", (event) => {
				calibration = (event as CustomEvent).detail;
				for (const listener of listeners) listener();
			});
		});
		await page.goto("/editor?perf=1");
		await ready(page);
		const actual = page.getByRole("button", {
			name: "Actual size",
			exact: true,
		});
		await expect(actual).toBeEnabled();
		const expectScale = async (pixels: number) => {
			await expect
				.poll(async () => {
					const left = await drawingPoint(page, { x: 0, y: 0 });
					const right = await drawingPoint(page, { x: 100, y: 0 });
					return Math.round((right.x - left.x) * 100) / 100;
				})
				.toBe(pixels);
		};
		for (let repeat = 0; repeat < 3; repeat++) {
			await page
				.getByRole("button", { name: "Fit drawing", exact: true })
				.click();
			await interaction(page, "display.actual-size", async () => {
				await actual.click();
				await expect(actual).toHaveText("100%");
				await expectScale(320);
			});
			await page.getByRole("button", { name: "Zoom in", exact: true }).click();
			await expect(actual).toHaveText("125%");
		}
		await actual.click();
		await session.send("Emulation.setDeviceMetricsOverride", {
			width: 1200,
			height: 900,
			deviceScaleFactor: 2,
			mobile: false,
		});
		await expectScale(320);
		await expect(actual).toHaveText("100%");
		await page.evaluate(() =>
			window.dispatchEvent(
				new CustomEvent("test-display", { detail: { pixelsPerMm: 8 } }),
			),
		);
		await expectScale(400);
		await expect(actual).toHaveText("100%");
		await session.send("Emulation.setDeviceMetricsOverride", {
			width: 1201,
			height: 900,
			deviceScaleFactor: 2.5,
			mobile: false,
		});
		await expectScale(320);
		await expect(actual).toHaveText("100%");
		await page.screenshot({ path: "/tmp/ecad-physical-zoom/actual-size.png" });
		await page
			.getByRole("button", { name: "Fit drawing", exact: true })
			.click();
		await page.screenshot({ path: "/tmp/ecad-physical-zoom/fit-drawing.png" });
		await page.evaluate(() =>
			window.dispatchEvent(new CustomEvent("test-display", { detail: null })),
		);
		await expect(actual).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Fit drawing", exact: true }),
		).toBeEnabled();
		const value = await report(page);
		await finish(page, testInfo, "editor-physical-zoom", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
