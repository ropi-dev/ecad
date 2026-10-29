import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { demoFiles } from "../fixtures/demo-gerbers";

test("Gerber ZIP contents become individual layers alongside selected files", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	const input = page.locator("input[type=file]");
	const standalone = {
		name: demoFiles[0].name,
		mimeType: "text/plain",
		buffer: Buffer.from(demoFiles[0].source),
	};
	await input.setInputFiles(standalone);
	await expect(page.locator("[data-testid=layer-name]")).toHaveText([
		standalone.name,
	]);
	await input.setInputFiles([
		{
			name: "board.ZIP",
			mimeType: "application/zip",
			buffer: Buffer.from(
				zipSync({
					"board/top.GTL": strToU8(demoFiles[1].source),
					"board/invalid.gbr": strToU8("invalid gerber"),
					"board/bottom.copper": strToU8(demoFiles[2].source),
					"README.txt": strToU8("Manufacturing instructions"),
					"board/": new Uint8Array(),
					"__MACOSX/._top.gbr": strToU8(demoFiles[0].source),
					".hidden.gbr": strToU8(demoFiles[0].source),
				}),
			),
		},
		{ ...standalone, name: "loose.gbr" },
		{
			name: "stored.zip",
			mimeType: "application/zip",
			buffer: Buffer.from(
				zipSync({ "outline.gbr": strToU8(demoFiles[4].source) }, { level: 0 }),
			),
		},
	]);
	await expect(page.locator("[data-testid=layer-name]")).toHaveText([
		"outline.gbr",
		"loose.gbr",
		"board/bottom.copper",
		"board/top.GTL",
		standalone.name,
	]);
	await expect(page.locator("[data-testid=viewer-message]")).toContainText(
		"board/invalid.gbr:",
	);
	await expect(page.locator("[data-testid=viewer-message]")).not.toContainText(
		"README",
	);
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Remove board/top.GTL", exact: true })
		.click();
	await expect(page.locator("[data-testid=layer-name]")).toHaveCount(4);
});
