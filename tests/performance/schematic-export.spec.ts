import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { setupAppTests } from "./app-fixture.ts";
import { finish, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("schematic-export", async ({ page }, testInfo) => {
	const content = await readFile(
		"tests/fixtures/rp2350a-reference/drawing.ecaddraw",
		"utf8",
	);
	await page.goto("/editor?perf=1");
	await ready(page);
	await page.evaluate(async (content) => {
		const directory = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle("Export fixture", { create: true });
		for (const [name, data] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Export fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", content],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(data);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Export fixture");
	}, content);
	await page.reload();
	await ready(page);
	const button = page.getByRole("button", {
		name: "Export drawing",
		exact: true,
	});
	await expect(button).toBeEnabled();
	await button.click();
	const dialog = page.getByRole("dialog", { name: "Export drawing" });
	for (const format of ["svg", "png"]) {
		await dialog
			.getByRole("combobox", { name: "Format", exact: true })
			.selectOption(format);
		const download = page.waitForEvent("download");
		await dialog.getByRole("button", { name: "Download", exact: true }).click();
		await download;
		await expect(
			dialog.getByRole("button", { name: "Download", exact: true }),
		).toBeEnabled();
	}
	const value = await report(page);
	await finish(page, testInfo, "schematic-export", {
		exportSvgMs: metric(value, "drawing.export-svg")!,
		exportPngMs: metric(value, "drawing.export")!,
	});
});
