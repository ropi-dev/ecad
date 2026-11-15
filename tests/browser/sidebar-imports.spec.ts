import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";

async function screenshot(page: Page, name: string) {
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("/tmp/ecad-browser-artifacts", test.info().testId, name),
		});
}

test("files imported from the sidebar open in their editor or viewer", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await page.goto("/tests/browser/projects.html");
	const sidebar = await openProjectFiles(page);
	await expect(sidebar.getByLabel("Add symbol files")).toBeEnabled();
	await sidebar.getByLabel("Add symbol files").setInputFiles({
		name: "imported.ecadsym",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify({
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "imported-part",
				name: "Imported part",
				description: "",
				prefix: "TP",
				value: "",
				shapes: [
					{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 },
					{ kind: "pin", name: "Signal", x: -6, y: 0 },
				],
			}),
		),
	});
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Symbol editor · Imported part",
	);
	await closeProjectFiles(page);
	await screenshot(page, "symbol.png");

	const [gerber] = demoFiles;
	await (await openProjectFiles(page))
		.getByLabel("Add Gerber files", { exact: true })
		.setInputFiles({
			name: gerber.name,
			mimeType: "text/plain",
			buffer: Buffer.from(gerber.source),
		});
	await closeProjectFiles(page);
	await expect(page.locator("[data-layer-id]")).toHaveCount(1, {
		timeout: 30_000,
	});
	await screenshot(page, "gerber.png");

	await (await openProjectFiles(page))
		.getByLabel("Add STEP files", { exact: true })
		.setInputFiles(
			resolve(
				"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
			),
		);
	await closeProjectFiles(page);
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled({ timeout: 30_000 });
	await screenshot(page, "step.png");
});
