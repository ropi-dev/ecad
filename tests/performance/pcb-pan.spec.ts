import { expect, test } from "@playwright/test";
import { projectRail } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	percentile,
	ready,
} from "./app-helpers.ts";

setupAppTests();

test("pcb-pan", { tag: ["@pcb"] }, async ({ page }, testInfo) => {
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
	await expect(page.getByText("All connections routed")).toBeVisible();
	const area = page.locator("[data-tool][data-view]");
	await expect(area).toHaveAttribute("data-view", "2d");
	const box = required(await area.boundingBox());
	const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(centre.x, centre.y);
	// A trackpad pan: one wheel event per frame, as the browser delivers them.
	const pan = () =>
		page.evaluate(
			(centre) =>
				new Promise<number[]>((resolve) => {
					const target = document.querySelector(
						"[data-tool][data-view] canvas",
					);
					if (!target) throw new Error("Expected the board canvas");
					const times: number[] = [];
					const tick = (time: number) => {
						times.push(time);
						const step = times.length;
						if (step > 90) {
							resolve(
								times.slice(1).map((value, index) => value - times[index]),
							);
							return;
						}
						target.dispatchEvent(
							new WheelEvent("wheel", {
								deltaX: Math.round(Math.sin(step / 10) * 25),
								deltaY: Math.round(Math.cos(step / 13) * 25),
								clientX: centre.x,
								clientY: centre.y,
								bubbles: true,
								cancelable: true,
							}),
						);
						requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				}),
			centre,
		);
	const frames: number[] = [];
	const gestures: number[] = [];
	for (const zoom of [0, 3]) {
		for (let step = 0; step < zoom; step++)
			await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		await page.mouse.move(centre.x, centre.y);
		await page.waitForTimeout(500);
		gestures.push(
			await interaction(page, "pcb.pan", async () => {
				frames.push(...(await pan()));
			}),
		);
	}
	await finish(page, testInfo, "pcb-pan", {
		interactionP95Ms: percentile(gestures),
		panFrameP50Ms: percentile(frames, 0.5),
		panFrameP95Ms: percentile(frames),
	});
});
