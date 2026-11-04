import { expect, test } from "@playwright/test";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-clipboard", async ({ page, context }, testInfo) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await canvas.click({
		position: { x: bounds.width / 2, y: bounds.height / 2 },
	});
	await page.keyboard.press("Control+c");
	await page.waitForFunction(
		() =>
			window.__ecadPerformance!.snapshot().metrics["drawing.clipboard-write"]
				?.count === 1,
	);
	await page.evaluate(async () => {
		const [item] = await navigator.clipboard.read();
		const selection = JSON.parse(
			await (await item.getType("web application/x-ecad-shapes+json")).text(),
		);
		const source = selection.shapes[0];
		selection.shapes = Array.from({ length: 32 }, (_, i) => ({
			...source,
			id: i + 1,
			x: (i % 8) * 15,
			y: Math.floor(i / 8) * 20,
		}));
		await navigator.clipboard.writeText(JSON.stringify(selection));
	});
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "clipboard.paste", async () => {
			await page.keyboard.press("Control+v");
			await page.waitForFunction(
				(count) =>
					(window.__ecadPerformance!.snapshot().metrics[
						"drawing.clipboard-paste"
					]?.count ?? 0) === count,
				repeat + 1,
			);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
		await page.keyboard.press("Control+c");
		await page.waitForFunction(
			(count) =>
				window.__ecadPerformance!.snapshot().metrics["drawing.clipboard-write"]
					?.count === count,
			repeat + 2,
		);
		await page.keyboard.press("Control+z");
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-clipboard", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
		pasteP95Ms: metric(value, "drawing.clipboard-paste")!,
		copyP95Ms: metric(value, "drawing.clipboard-write")!,
	});
});
