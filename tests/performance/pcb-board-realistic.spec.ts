import { expect, test } from "@playwright/test";
import { projectRail } from "../browser/project-files";
import { screenPointOfMillimetres } from "../browser/rulers";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	metric,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

const flashChip = { x: 5.07, y: 13.5 };

test(
	"pcb-board-realistic",
	{ tag: ["@pcb", "@footprint"] },
	async ({ page }, testInfo) => {
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
		const body = await screenPointOfMillimetres(page, flashChip.x, flashChip.y);
		await page.mouse.click(body.x, body.y);
		const flat = page.getByRole("button", { name: "2D", exact: true });
		const area = page.locator("[data-tool][data-view]");
		await interaction(page, "pcb.board-open", async () => {
			await flat.click();
			await expect(area).toHaveAttribute("data-view", "3d");
			await expect(flat).toHaveAttribute("aria-pressed", "false");
		});
		const realistic = page.getByRole("button", { name: "Realistic board" });
		const realisticOn = await interaction(
			page,
			"pcb.board-realistic",
			async () => {
				await realistic.click();
				await expect(realistic).toHaveAttribute("aria-pressed", "true");
			},
		);
		const outline = page.locator('[data-testid="board-selection"]');
		await expect(outline).toHaveCount(1);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					let last = "";
					let still = 0;
					const check = () => {
						const points =
							document
								.querySelector('[data-testid="board-selection"]')
								?.getAttribute("points") ?? "";
						still = points && points === last ? still + 1 : 0;
						last = points;
						if (still >= 6) resolve();
						else requestAnimationFrame(check);
					};
					check();
				}),
		);
		const view = required(await area.boundingBox());
		const moves: number[] = [];
		for (let round = 0; round < 3; round++) {
			const placed = required(await outline.getAttribute("points"));
			const corners = placed
				.split(" ")
				.map((corner) => corner.split(",").map(Number));
			const grip = {
				x: view.x + corners.reduce((sum, [x]) => sum + x, 0) / corners.length,
				y: view.y + corners.reduce((sum, [, y]) => sum + y, 0) / corners.length,
			};
			await page.mouse.move(grip.x, grip.y);
			moves.push(
				await interaction(
					page,
					"pcb.board-realistic-move-footprint",
					async () => {
						await page.mouse.down();
						await page.mouse.move(grip.x + 80, grip.y - 40, { steps: 16 });
						await page.mouse.up();
						await expect(outline).not.toHaveAttribute("points", placed);
						await expect(page.getByText(/unrouted connections?/)).toBeVisible();
					},
				),
			);
			await page.keyboard.press("ControlOrMeta+z");
			await expect(routed).toBeVisible();
			await page.mouse.click(grip.x, grip.y);
			await expect(outline).toHaveAttribute("points", placed);
		}
		const value = await report(page);
		await finish(page, testInfo, "pcb-board-realistic", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
			realisticOnMs: realisticOn,
			moveFootprintMs: percentile(moves),
		});
	},
);
