import { expect, test } from "@playwright/test";
import { openProjectFiles, projectRail } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"project-new-drawing",
	{ tag: ["@projects", "@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toBeVisible();
		const createMs = await interaction(page, "drawing.create", async () => {
			await projectRail(page)
				.getByRole("button", { name: "Add file", exact: true })
				.click();
			await page
				.getByRole("menuitem", { name: "New drawing", exact: true })
				.click();
			await page
				.getByLabel("Drawing name", { exact: true })
				.fill("Power stage");
			await page
				.getByRole("button", { name: "Create drawing", exact: true })
				.click();
			await page.waitForFunction(
				() =>
					document
						.querySelector("h1")
						?.textContent?.startsWith("Schematic editor · Power stage") &&
					document.querySelector<HTMLButtonElement>(
						'button[aria-label="Select"]',
					)?.disabled === false,
				undefined,
				{ polling: "raf", timeout: 30_000 },
			);
		});
		await (await toolbarButton(page, "Rectangle")).click();
		await page.mouse.move(600, 300);
		await page.mouse.down();
		await page.mouse.move(710, 400);
		await page.mouse.up();
		await expect
			.poll(
				async () => (await report(page)).metrics["project.save"]?.count ?? 0,
			)
			.toBeGreaterThan(1);
		await page.goto("/projects?perf=1");
		await ready(page);
		const switchTimes: number[] = [];
		for (let repeat = 0; repeat < 3; repeat++) {
			const sidebar = await openProjectFiles(page);
			switchTimes.push(
				await interaction(page, "drawing.reopen", async () => {
					await sidebar
						.getByRole("link", {
							name: "Open Power stage.ecaddraw",
							exact: true,
						})
						.click();
					await page.waitForFunction(
						() =>
							document
								.querySelector("h1")
								?.textContent?.startsWith("Schematic editor · Power stage") &&
							document.querySelector<HTMLButtonElement>(
								'button[aria-label="Select"]',
							)?.disabled === false,
						undefined,
						{ polling: "raf" },
					);
				}),
			);
			await openProjectFiles(page);
			await sidebar
				.getByRole("link", {
					name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
					exact: true,
				})
				.click();
			await page.waitForFunction(
				() =>
					document
						.querySelector("h1")
						?.textContent?.startsWith("Schematic editor · A3") &&
					document.querySelector<HTMLButtonElement>(
						'button[aria-label="Select"]',
					)?.disabled === false,
				undefined,
				{ polling: "raf" },
			);
		}
		await finish(page, testInfo, "project-new-drawing", {
			createMs,
			interactionP95Ms: percentile(switchTimes),
		});
	},
);
