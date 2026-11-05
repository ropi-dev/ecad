import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"project-new-symbol",
	{ tag: ["@projects", "@symbols"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toBeVisible();
		await interaction(page, "symbol.create", async () => {
			await (await openProjectFiles(page))
				.getByRole("button", { name: "Add file", exact: true })
				.click();
			await page
				.getByRole("menuitem", { name: "New symbol", exact: true })
				.click();
			await page.waitForFunction(
				() => document.querySelector('[role="dialog"] input') !== null,
				undefined,
				{ polling: "raf", timeout: 30_000 },
			);
			await page.getByLabel("Symbol name", { exact: true }).fill("New part");
			await page
				.getByRole("button", { name: "Create symbol", exact: true })
				.click();
			await editorReady(page, "Symbol editor · New part");
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
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Workspace home", exact: true })
			.click();
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open new-part.ecadsym", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Select", exact: true }),
		).toBeEnabled();
		await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(
			0,
		);
		const value = await report(page);
		await finish(page, testInfo, "project-new-symbol", {
			createMs: required(
				value.events.find(
					(event) =>
						event.name === "scenario.interaction" &&
						event.data?.name === "symbol.create",
				),
			).duration,
		});
	},
);
