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

test(
	"circuit-example",
	{ tag: ["@circuit", "@pcb"] },
	async ({ page }, testInfo) => {
		test.setTimeout(120_000);
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
		const openMs = await interaction(page, "circuit.open-example", async () => {
			await page
				.getByRole("button", { name: "Switch to circuit view", exact: true })
				.click();
			await page.waitForFunction(
				() => document.querySelectorAll(".circuit-component").length === 39,
				undefined,
				{ polling: "raf" },
			);
		});
		await page.getByRole("button", { name: "Fit graph", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Fit graph", exact: true }),
		).toHaveText("100%");
		const wheel = (zoom: boolean) =>
			page.evaluate(
				(zoom) =>
					new Promise<number[]>((resolve) => {
						const target = document.querySelector(
							'[aria-label="Circuit connections graph"]',
						);
						if (!target) throw new Error("Expected the circuit graph");
						const times: number[] = [];
						const tick = (time: number) => {
							times.push(time);
							const step = times.length;
							if (step > 60) {
								resolve(
									times.slice(1).map((value, index) => value - times[index]),
								);
								return;
							}
							const direction = step <= 30 ? 1 : -1;
							target.dispatchEvent(
								new WheelEvent("wheel", {
									deltaX: zoom ? 0 : direction * 12,
									deltaY: direction * (zoom ? -10 : 8),
									ctrlKey: zoom,
									clientX: innerWidth / 2,
									clientY: innerHeight / 2,
									bubbles: true,
									cancelable: true,
								}),
							);
							requestAnimationFrame(tick);
						};
						requestAnimationFrame(tick);
					}),
				zoom,
			);
		const panFrames: number[] = [];
		const zoomFrames: number[] = [];
		const gestures: number[] = [];
		gestures.push(
			await interaction(page, "circuit.pan", async () => {
				panFrames.push(...(await wheel(false)));
			}),
		);
		await page.keyboard.down("Control");
		gestures.push(
			await interaction(page, "circuit.zoom", async () => {
				zoomFrames.push(...(await wheel(true)));
			}),
		);
		await page.keyboard.up("Control");
		const handle = await page.evaluate(() => {
			for (const button of document.querySelectorAll<HTMLElement>(
				".circuit-node-handle button",
			)) {
				const box = button.getBoundingClientRect();
				const x = box.x + box.width / 2;
				const y = box.y + box.height / 2;
				if (x > 300 && x < innerWidth - 300 && y > 150 && y < innerHeight - 250)
					return { x, y, label: button.getAttribute("aria-label") };
			}
			return null;
		});
		const { x, y, label } = required(handle);
		const node = page
			.getByRole("button", { name: required(label), exact: true })
			.locator("xpath=../..");
		const start = required(await node.getAttribute("transform"));
		gestures.push(
			await interaction(page, "circuit.drag", async () => {
				await page.mouse.move(x, y);
				await page.mouse.down();
				await page.mouse.move(x + 120, y + 60, { steps: 20 });
				await expect(node).not.toHaveAttribute("transform", start);
				await page.mouse.move(x, y, { steps: 20 });
				await page.mouse.up();
				await expect(node).toHaveAttribute("transform", start);
			}),
		);
		await finish(page, testInfo, "circuit-example", {
			openMs,
			interactionP95Ms: percentile(gestures),
			panFrameP95Ms: percentile(panFrames),
			zoomFrameP95Ms: percentile(zoomFrames),
		});
	},
);
