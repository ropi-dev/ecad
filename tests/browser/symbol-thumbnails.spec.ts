import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { stableScreenshot } from "./stable-screenshot";

test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });

test("a delayed thumbnail shows a skeleton and still allows placement", async ({
	page,
}) => {
	let release = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/SymbolPreview.tsx*", async (route) => {
		await pending;
		await route.continue();
	});
	try {
		await page.goto("/tests/browser/editor.html");
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		const resistor = page.getByRole("button", {
			name: "Insert Resistor",
			exact: true,
		});
		await expect(resistor.locator("[data-thumbnail-skeleton]")).toHaveCount(1);
		await expect(resistor.locator("svg")).toHaveCount(0);
		if (captureArtifacts)
			await stableScreenshot(() =>
				page
					.locator("[data-symbol-picker]")
					.screenshot({
						path: test.info().outputPath("thumbnail-skeletons.png"),
					}),
			);
		await resistor.click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		await canvas.click({
			position: { x: bounds.width / 2, y: bounds.height / 2 },
		});
		await expect(
			page.getByRole("textbox", { name: "Reference", exact: true }),
		).toHaveValue("R1");
	} finally {
		release();
		await page.unrouteAll({ behavior: "wait" });
	}
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(
		page
			.getByRole("button", { name: "Insert Resistor", exact: true })
			.locator("svg"),
	).toHaveCount(1);
});
