import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";

for (const format of ["step", "gerber"] as const) {
	test(`${format} parser returns one scene that renders directly in both viewers`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/tests/browser/parser-viewers.html");
		await page.getByLabel("Open scene").setInputFiles(
			format === "step"
				? resolve(
						"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
					)
				: {
						name: demoFiles[0].name,
						mimeType: "text/plain",
						buffer: Buffer.from(demoFiles[0].source),
					},
		);
		await expect(page.locator("#ready")).toHaveText("true", { timeout: 30000 });
		await expect(page.locator("canvas")).toHaveCount(2);
		const snapshot = async () =>
			JSON.parse((await page.locator("#snapshot").textContent()) || "{}");
		await expect
			.poll(async () => (await snapshot()).diagnostics?.triangles ?? 0)
			.toBeGreaterThan(0);
		if (format === "gerber")
			expect((await snapshot()).diagnostics.textures).toBe(0);
		await page.getByRole("button", { name: "Zoom 2D" }).click();
		await expect.poll(async () => (await snapshot()).zoom).toBe(1.25);
		await expect(page.getByRole("alert")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

test("multiple STEP parts and Gerber objects share one array in both viewers", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/parser-viewers.html");
	const { readFile } = await import("node:fs/promises");
	const cube = await readFile(
		"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
	);
	await page.getByLabel("Open scene").setInputFiles([
		{ name: "first.step", mimeType: "application/octet-stream", buffer: cube },
		{
			name: demoFiles[0].name,
			mimeType: "text/plain",
			buffer: Buffer.from(demoFiles[0].source),
		},
		{ name: "second.step", mimeType: "application/octet-stream", buffer: cube },
		{
			name: demoFiles[1].name,
			mimeType: "text/plain",
			buffer: Buffer.from(demoFiles[1].source),
		},
	]);
	await expect(page.locator("#ready")).toHaveText("true", { timeout: 30000 });
	await expect(page.locator("#objects")).toHaveText(
		'["spatial","spatial","spatial","spatial"]',
	);
	await expect(page.locator("canvas")).toHaveCount(2);
	await expect
		.poll(
			async () =>
				JSON.parse((await page.locator("#snapshot").textContent()) || "{}")
					.diagnostics?.triangles ?? 0,
		)
		.toBeGreaterThan(24);
	await page.getByRole("button", { name: "Zoom 2D" }).click();
	await expect
		.poll(
			async () =>
				JSON.parse((await page.locator("#snapshot").textContent()) || "{}")
					.zoom,
		)
		.toBe(1.25);
	await expect(page.getByRole("alert")).toHaveCount(0);
	expect(errors).toEqual([]);
});
