import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { demoFiles } from "../fixtures/demo-gerbers";

for (const format of ["step", "gerber"] as const) {
	test(`${format} shares zoom shortcuts and preserves its view through resize and reopening`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript(() =>
			Object.defineProperty(navigator, "gpu", { value: undefined }),
		);
		await page.goto(
			`/tests/browser/${format === "step" ? "step" : "viewer"}.html`,
		);
		const file =
			format === "step"
				? resolve(
						"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
					)
				: {
						name: demoFiles[0].name,
						mimeType: "text/plain",
						buffer: Buffer.from(demoFiles[0].source),
					};
		const input = page.locator("input[type=file]");
		await input.setInputFiles(file);
		const canvas = page.locator("canvas");
		const capture = async () => {
			await page.mouse.move(0, 0);
			return (
				await canvas.screenshot({
					style: "canvas { outline: none !important; }",
				})
			).toString("base64");
		};
		const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
		await expect(zoomIn).toBeEnabled({ timeout: 30000 });
		await canvas.focus();
		const initial = await capture();
		await page.keyboard.press("+");
		const zoomed = await capture();
		expect(zoomed).not.toBe(initial);
		await page.keyboard.press("0");
		await expect.poll(capture).toBe(initial);
		await zoomIn.click();
		await canvas.focus();
		await expect.poll(capture).toBe(zoomed);
		const viewport = page.viewportSize()!;
		await page.setViewportSize({ width: 700, height: 500 });
		await expect
			.poll(() =>
				canvas.evaluate((element: HTMLCanvasElement) => [
					element.width,
					element.height,
				]),
			)
			.toEqual([700, 500]);
		await page.setViewportSize(viewport);
		await expect.poll(capture).toBe(zoomed);
		const close =
			format === "step"
				? page.getByRole("button", { name: "Close", exact: true })
				: page.getByRole("button", {
						name: `Remove ${demoFiles[0].name}`,
						exact: true,
					});
		await close.click();
		await expect(canvas).toHaveCount(0);
		await input.setInputFiles(file);
		await expect(zoomIn).toBeEnabled({ timeout: 30000 });
		await canvas.focus();
		await expect.poll(capture).toBe(initial);
		expect(errors).toEqual([]);
	});
}

test("Gerber imports retain successful files and report errors within one batch", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles([
		{
			name: "invalid.gbr",
			mimeType: "text/plain",
			buffer: Buffer.from("invalid"),
		},
		...demoFiles.slice(0, 2).map((file) => ({
			name: file.name,
			mimeType: "text/plain",
			buffer: Buffer.from(file.source),
		})),
	]);
	await expect(page.locator("[data-testid=layer-name]")).toHaveText(
		demoFiles
			.slice(0, 2)
			.reverse()
			.map((file) => file.name),
	);
	await expect(page.locator("[data-testid=viewer-message]")).toContainText("invalid.gbr:");
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
});

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
	await expect(page.locator("[data-testid=layer-name]")).toHaveText([standalone.name]);
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
	await expect(page.locator("[data-testid=viewer-message]")).not.toContainText("README");
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Remove board/top.GTL", exact: true })
		.click();
	await expect(page.locator("[data-testid=layer-name]")).toHaveCount(4);
});

test("Gerber ZIP layers display in PCB stack order regardless of archive order", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	const layers = [
		["F_Silkscreen.gto", "Legend,Top"],
		["F_Paste.gtp", "Paste,Top"],
		["F_Mask.gts", "Soldermask,Top"],
		["F_Cu.gtl", "Copper,L1,Top"],
		["In1_Cu.g1", "Copper,L2,Inr"],
		["In2_Cu.g2", "Copper,L3,Inr"],
		["B_Cu.gbl", "Copper,L4,Bot"],
		["B_Mask.gbs", "Soldermask,Bot"],
		["B_Paste.gbp", "Paste,Bot"],
		["B_Silkscreen.gbo", "Legend,Bot"],
		["Edge_Cuts.gm1", "Profile,NP"],
		["PTH-drl_map.gbr", "Drillmap"],
	];
	const archive = Object.fromEntries(
		[5, 9, 1, 7, 3, 10, 0, 6, 4, 8, 11, 2].map((index) => {
			const [name, fileFunction] = layers[index];
			return [
				name,
				strToU8(
					`%TF.FileFunction,${fileFunction}*%%FSLAX46Y46*%%MOMM*%%ADD10C,1*%D10*X0Y0D03*M02*`,
				),
			];
		}),
	);
	await page
		.locator("input[type=file]")
		.setInputFiles({
			name: "pcb.zip",
			mimeType: "application/zip",
			buffer: Buffer.from(zipSync(archive)),
		});
	await expect(page.locator("[data-testid=layer-name]")).toHaveText(
		layers.map(([name]) => name),
	);
});

test("Gerber ZIP errors do not discard valid files in the selection", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles([
		{
			name: "broken.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("broken"),
		},
		{
			name: "empty.zip",
			mimeType: "application/zip",
			buffer: Buffer.from(zipSync({})),
		},
		{
			name: "notes.zip",
			mimeType: "application/zip",
			buffer: Buffer.from(zipSync({ "README.txt": strToU8("Notes") })),
		},
		{
			name: demoFiles[0].name,
			mimeType: "text/plain",
			buffer: Buffer.from(demoFiles[0].source),
		},
	]);
	await expect(page.locator("[data-testid=layer-name]")).toHaveText([demoFiles[0].name]);
	await expect(page.locator("[data-testid=viewer-message]")).toContainText(
		"broken.zip: Unable to read this ZIP archive.",
	);
	await expect(page.locator("[data-testid=viewer-message]")).toContainText(
		"empty.zip: This ZIP archive contains no Gerber files.",
	);
	await expect(page.locator("[data-testid=viewer-message]")).toContainText(
		"notes.zip: This ZIP archive contains no Gerber files.",
	);
});

for (const stage of ["archive", "entry"] as const) {
	test(`new Gerber selection cancels a ZIP import during ${stage} reading`, async ({
		page,
	}) => {
		await page.addInitScript((stage) => {
			const method = stage === "archive" ? "arrayBuffer" : "text";
			const original = File.prototype[method];
			Object.defineProperty(File.prototype, method, {
				value: async function (this: File) {
					if (this.name === (stage === "archive" ? "slow.zip" : "slow.gbr")) {
						document.documentElement.dataset.importPaused = "true";
						await new Promise((resolve) =>
							window.addEventListener("resume-import", resolve, { once: true }),
						);
					}
					return Reflect.apply(original, this, []);
				},
			});
		}, stage);
		await page.goto("/tests/browser/viewer.html");
		const input = page.locator("input[type=file]");
		await input.setInputFiles({
			name: "slow.zip",
			mimeType: "application/zip",
			buffer: Buffer.from(
				zipSync({
					"first.gbr": strToU8(demoFiles[0].source),
					"slow.gbr": strToU8(demoFiles[1].source),
				}),
			),
		});
		await expect(page.locator("html")).toHaveAttribute(
			"data-import-paused",
			"true",
		);
		await input.setInputFiles({
			name: "latest.gbr",
			mimeType: "text/plain",
			buffer: Buffer.from(demoFiles[2].source),
		});
		await expect(page.locator("[data-testid=layer-name]")).toHaveText(["latest.gbr"]);
		await page.evaluate(() => window.dispatchEvent(new Event("resume-import")));
		await expect(
			page.getByRole("button", { name: "Zoom in", exact: true }),
		).toBeEnabled();
		await expect(page.locator("[data-testid=layer-name]")).toHaveText(["latest.gbr"]);
		await expect(page.locator("[data-testid=viewer-message]")).toHaveCount(0);
	});
}
