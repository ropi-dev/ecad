import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
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

test("projects-large", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Performance fixture", {
			create: true,
		});
		const manifest =
			'format = "ecad-project"\nversion = 1\nname = "Performance fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n' +
			Array.from(
				{ length: 10000 },
				(_, index) =>
					`\n[[assets]]\npath = "assets/file-${index}.gbr"\nname = "file-${index}.gbr"\nkind = "gerber"\n`,
			).join("");
		for (const [name, content] of [
			[".ecadprj", manifest],
			["drawing.ecaddraw", '{"shapes":[]}'],
		]) {
			const stream = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await stream.write(content);
			await stream.close();
		}
		localStorage.setItem("ecad.active-project", "Performance fixture");
	});
	await page.reload();
	await ready(page);
	await openProjectFiles(page);
	await expect(page.getByRole("row")).toHaveCount(51);
	for (let i = 0; i < 3; i++) {
		await interaction(page, "files.next", async () => {
			await page.getByRole("button", { name: "Next files" }).click();
			await expect(
				page.getByText(`file-${48 + i * 50}.gbr`, { exact: true }),
			).toBeVisible();
		});
	}

	const value = await report(page);
	await interaction(page, "files.search", async () => {
		await page.getByLabel("Search project files").fill("file-9999.gbr");
		await expect(
			page.getByText("file-9999.gbr", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("row")).toHaveCount(2);
	});
	await page.getByRole("button", { name: "Clear file search" }).click();
	await interaction(page, "files.filter", async () => {
		await page
			.getByRole("group", { name: "File types" })
			.getByRole("button", { name: /^Gerber/ })
			.click();
		await expect(page.getByText("file-0.gbr", { exact: true })).toBeVisible();
	});
	const fileInteractions = await report(page);
	await finish(page, testInfo, "projects-large", {
		interactionP95Ms: percentile(
			value.events
				.filter((event) => event.name === "scenario.interaction")
				.map((event) => event.duration),
		),
		searchMs: required(
			fileInteractions.events.find(
				(event) =>
					event.data?.name === "files.search" &&
					event.name === "scenario.interaction",
			),
		).duration,
		filterMs: required(
			fileInteractions.events.find(
				(event) =>
					event.data?.name === "files.filter" &&
					event.name === "scenario.interaction",
			),
		).duration,
	});
});
