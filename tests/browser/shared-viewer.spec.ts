import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
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
	await expect(page.locator(".layer-name")).toHaveText(
		demoFiles
			.slice(0, 2)
			.reverse()
			.map((file) => file.name),
	);
	await expect(page.locator(".viewer-message")).toContainText("invalid.gbr:");
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
});
