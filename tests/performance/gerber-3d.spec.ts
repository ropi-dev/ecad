import { expect, type Page, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { pthGerber } from "../fixtures/pth-gerber";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

const HOLES = 2000;
const header = "%FSLAX46Y46*%\n%MOMM*%\n";
const position = (index: number) =>
	`X${(index % 100) * 2500000}Y${Math.floor(index / 100) * 2500000}`;
const drills = () =>
	`%TF.FileFunction,Plated,1,4,PTH*%\n${header}%ADD10C,0.8*%\nD10*\n${Array.from(
		{ length: HOLES },
		(_, index) => `${position(index)}D03*`,
	).join("\n")}\nM02*\n`;
const plane = () =>
	`%TF.FileFunction,Copper,L2,Inr*%\n${header}%ADD10C,0.1*%\nD10*\nG36*\nX-2000000Y-2000000D02*\nX250000000Y-2000000D01*\nX250000000Y50000000D01*\nX-2000000Y50000000D01*\nX-2000000Y-2000000D01*\nG37*\nM02*\n`;

const frames = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);

test("gerber-3d", { tag: ["@import"] }, async ({ page }, testInfo) => {
	test.setTimeout(240_000);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await (await openProjectFiles(page))
		.getByLabel("Add Gerber files")
		.setInputFiles([
			{
				name: "board-F_Cu.gbr",
				mimeType: "text/plain",
				buffer: Buffer.from(pthGerber(HOLES, false)),
			},
			{
				name: "board-In1_Cu.gbr",
				mimeType: "text/plain",
				buffer: Buffer.from(plane()),
			},
			{
				name: "board-PTH-drl.gbr",
				mimeType: "text/plain",
				buffer: Buffer.from(drills()),
			},
		]);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open all Gerber layers", exact: true })
		.click();
	await expect(page.locator("[data-layer-id]")).toHaveCount(3, {
		timeout: 60_000,
	});
	await expect
		.poll(async () => (await report(page)).metrics["import.gerber"]?.count ?? 0)
		.toBeGreaterThan(0);
	const toggle = page.getByRole("button", { name: "2D", exact: true });
	await expect(toggle).toBeEnabled();
	const axes = page.getByRole("img", { name: "XYZ axis orientation" });
	const canvas = required(await page.locator("canvas").boundingBox());
	const center = {
		x: canvas.x + canvas.width / 2,
		y: canvas.y + canvas.height / 2,
	};
	const times: number[] = [];
	times.push(
		await interaction(page, "gerber.enter-3d", async () => {
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			await expect(axes).toBeVisible();
			await frames(page);
		}),
	);
	times.push(
		await interaction(page, "gerber.orbit", async () => {
			await page.keyboard.down("Shift");
			await page.mouse.move(center.x, center.y);
			await page.mouse.down();
			await page.mouse.move(center.x - 200, center.y + 60, { steps: 20 });
			await page.mouse.up();
			await page.keyboard.up("Shift");
			await frames(page);
		}),
	);
	times.push(
		await interaction(page, "gerber.leave-3d", async () => {
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-pressed", "true");
			await expect(axes).toHaveCount(0);
			await frames(page);
		}),
	);
	await finish(page, testInfo, "gerber-3d", {
		interactionP95Ms: percentile(times),
	});
});
