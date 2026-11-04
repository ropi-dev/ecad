import { expect, test } from "@playwright/test";
import { toolbarButton } from "./toolbar.ts";

for (const openBeforePruning of [false, true]) {
	test(`history renders the retained root when ${openBeforePruning ? "already open" : "opened after pruning"}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/tests/browser/editor.html");
		await expect(await toolbarButton(page, "History")).toBeEnabled();
		await page.evaluate(async () => {
			const fixturePath = "/tests/browser/editor.tsx";
			const { placeRectangle, replaceShapes, drawingStore } = await import(
				fixturePath
			);
			placeRectangle({
				x: 1,
				y: 1,
				width: 10,
				height: 8,
				rotation: 0,
				lineWidth: 0.2,
			});
			for (let x = 2; x <= 99; x++)
				replaceShapes([{ ...drawingStore.getSnapshot().shapes[0], x }]);
		});
		if (openBeforePruning) await (await toolbarButton(page, "History")).click();
		await page.evaluate(async () => {
			const fixturePath = "/tests/browser/editor.tsx";
			const { replaceShapes, drawingStore } = await import(fixturePath);
			for (let x = 100; x <= 103; x++)
				replaceShapes([{ ...drawingStore.getSnapshot().shapes[0], x }]);
		});
		if (!openBeforePruning)
			await (await toolbarButton(page, "History")).click();
		const panel = page.getByRole("region", {
			name: "Drawing history",
			exact: true,
		});
		await expect(panel).toBeVisible();
		await expect(panel.locator("[data-history-node-id]")).toHaveCount(100);
		await expect(panel.locator('[data-history-node-id="0"]')).toHaveCount(0);
		await expect(panel.locator('[data-history-node-id="4"]')).toHaveCount(1);
		await expect(panel.locator('[data-history-node-id="103"]')).toHaveAttribute(
			"aria-current",
			"step",
		);
		await panel.locator('[data-history-node-id="4"]').click();
		await expect(await toolbarButton(page, "Undo")).toBeDisabled();
		await (await toolbarButton(page, "Redo")).click();
		await (await toolbarButton(page, "History")).click();
		await expect(panel.locator('[data-history-node-id="5"]')).toHaveAttribute(
			"aria-current",
			"step",
		);
		await panel.locator('[data-history-node-id="102"]').click();
		await page.evaluate(async () => {
			const fixturePath = "/tests/browser/editor.tsx";
			const { replaceShapes, drawingStore } = await import(fixturePath);
			replaceShapes([{ ...drawingStore.getSnapshot().shapes[0], x: -1 }]);
		});
		await expect(panel.locator("[data-history-node-id]")).toHaveCount(100);
		await panel.locator('[data-history-node-id="103"]').click();
		await expect(panel.locator('[data-history-node-id="103"]')).toHaveAttribute(
			"aria-current",
			"step",
		);
		await panel.locator('[data-history-node-id="104"]').click();
		await expect(panel.locator('[data-history-node-id="104"]')).toHaveAttribute(
			"aria-current",
			"step",
		);
		if (openBeforePruning) {
			await panel.locator('[data-history-node-id="5"]').click();
			await expect(panel.locator('[data-history-node-id="5"]')).toHaveAttribute(
				"aria-current",
				"step",
			);
			await page.screenshot({ path: "/tmp/ecad-history-retained-root.png" });
		}
		expect(errors).toEqual([]);
	});
}
