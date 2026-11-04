import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-wire-crossings", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const shapes = [0, 1].flatMap((axis) =>
			Array.from({ length: 20 }, (_, index) => ({
				id: axis * 20 + index + 1,
				kind: "wire",
				x: axis ? index * 6 - 57 : 0,
				y: axis ? 0 : index * 6 - 57,
				width: 126,
				height: 0.254,
				lineWidth: 0.254,
				rotation: (axis * Math.PI) / 2,
			})),
		);
		const directory = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle("Crossing fixture", { create: true });
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Crossing fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Crossing fixture");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	const canvas = page.locator("canvas");
	await expect(canvas).toBeVisible();
	await expect
		.poll(
			async () =>
				(await report(page)).metrics["editor.wire-crossings"]?.count ?? 0,
		)
		.toBeGreaterThan(0);
	const bounds = required(await canvas.boundingBox());
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "crossings.select-all", async () => {
			await page.mouse.move(
				bounds.x + bounds.width * 0.25,
				bounds.y + bounds.height * 0.2,
			);
			await page.mouse.down();
			await page.mouse.move(
				bounds.x + bounds.width * 0.75,
				bounds.y + bounds.height * 0.8,
			);
			await page.mouse.up();
			await expect(
				page.getByText("Selected shapes", { exact: true }),
			).toBeVisible();
		});
		await page
			.getByRole("button", { name: "Clear selection", exact: true })
			.click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-wire-crossings", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
		crossingsP95Ms: required(metric(value, "editor.wire-crossings")),
	});
});
