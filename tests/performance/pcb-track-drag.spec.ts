import { expect, test } from "@playwright/test";
import { projectRail } from "../browser/project-files";
import { screenPointOfMillimetres } from "../browser/rulers";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	percentile,
	ready,
} from "./app-helpers.ts";

setupAppTests();

const diagonal = { x: 11.2, y: -18 };

test("pcb-track-drag", { tag: ["@pcb"] }, async ({ page }, testInfo) => {
	test.setTimeout(240_000);
	await page.goto("/editor?perf=1");
	await ready(page);
	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "RP2350A reference design", exact: true })
		.click();
	await editorReady(page, "PCB editor · RP2350A");
	const routed = page.getByText("All connections routed");
	await expect(routed).toBeVisible();
	const redo = page.getByRole("button", { name: "Redo", exact: true });
	const start = await screenPointOfMillimetres(page, diagonal.x, diagonal.y);
	await page.mouse.move(start.x, start.y);
	await page.keyboard.down("Control");
	for (let step = 0; step < 8; step++) {
		await page.mouse.wheel(0, -300);
		await page.waitForTimeout(100);
	}
	await page.keyboard.up("Control");
	await page.waitForTimeout(500);
	const drags: number[] = [];
	for (let round = 0; round < 3; round++) {
		const grip = await screenPointOfMillimetres(page, diagonal.x, diagonal.y);
		const across = await screenPointOfMillimetres(
			page,
			diagonal.x + 1,
			diagonal.y + 1,
		);
		await page.mouse.click(grip.x, grip.y);
		await page.mouse.move(grip.x, grip.y);
		drags.push(
			await interaction(page, "pcb.track-drag", async () => {
				await page.mouse.down();
				await page.mouse.move(across.x, across.y, { steps: 16 });
				await page.mouse.up();
				await expect(redo).toBeDisabled();
				await expect(routed).toBeVisible();
			}),
		);
		await page.keyboard.press("ControlOrMeta+z");
		await expect(redo).toBeEnabled();
	}
	await finish(page, testInfo, "pcb-track-drag", {
		interactionP95Ms: percentile(drags),
	});
});
