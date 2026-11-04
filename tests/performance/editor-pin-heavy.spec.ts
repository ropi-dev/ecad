import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-pin-heavy", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const pins = Array.from({ length: 2000 }, (_, index) => ({
			id: index + 1,
			kind: "pin",
			name: "",
			x: (index % 50) * 6 - 150,
			y: Math.floor(index / 50) * 6 + 20,
			width: 0.508,
			height: 0.508,
			lineWidth: 0.254,
			rotation: 0,
		}));
		const wires = pins.slice(0, 1000).map((pin, index) => ({
			id: 2001 + index,
			kind: "wire",
			x: pin.x + 1,
			y: pin.y,
			width: 2,
			height: 0.254,
			lineWidth: 0.254,
			rotation: 0,
		}));
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Pin fixture", {
			create: true,
		});
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Pin fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes: [...pins, ...wires] })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Pin fixture");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	for (let repeat = 0; repeat < 5; repeat++) {
		await interaction(page, "pin-heavy.empty-click", async () => {
			await canvas.click({
				position: {
					x: bounds.width * 0.85 + repeat * 10,
					y: bounds.height * 0.75,
				},
			});
			await page.waitForFunction(
				() => document.activeElement?.tagName === "CANVAS",
			);
			await expect(
				page.getByRole("button", { name: "Clear selection", exact: true }),
			).toHaveCount(0);
		});
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-pin-heavy", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
