import { expect, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";

for (const fallback of ["webgl", "canvas"] as const) {
	test(`keeps file loading and navigation with ${fallback} fallback`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript((fallback) => {
			Object.defineProperty(navigator, "gpu", { value: undefined });
			if (fallback === "canvas") {
				const original = HTMLCanvasElement.prototype.getContext;
				HTMLCanvasElement.prototype.getContext = function (
					this: HTMLCanvasElement,
					type: string,
					...args: unknown[]
				) {
					if (type === "webgl2") return null;
					return Reflect.apply(original, this, [type, ...args]);
				} as typeof original;
			}
		}, fallback);
		await page.goto("/tests/browser/viewer.html");
		await expect(page.locator(".empty-message")).toHaveText(
			"Choose a Gerber file to view it.",
		);
		await expect(page.locator("canvas")).toHaveCount(0);
		const file = demoFiles[0];
		await page.locator("input[type=file]").setInputFiles({
			name: file.name,
			mimeType: "text/plain",
			buffer: Buffer.from(file.source),
		});
		await expect(page.locator("canvas")).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "Zoom in", exact: true }),
		).toBeEnabled();
		await expect(
			page.locator("dl, .renderer-label, .navigation-hint"),
		).toHaveCount(0);
		await expect(page.locator(".layer-name")).toHaveText(file.name);
		await page.mouse.move(350, 350);
		await page.mouse.wheel(100, 100);
		await expect(page.locator(".zoom-level")).toHaveText("100%");
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, -50);
		await page.keyboard.up("Control");
		await expect(page.locator(".zoom-level")).not.toHaveText("100%");
		await page.getByRole("button", { name: "Reset zoom to 100%" }).click();
		await expect(page.locator(".zoom-level")).toHaveText("100%");
		await expect(page.locator(".viewer-message")).toHaveCount(0);
		expect(errors).toEqual([]);
		await page.screenshot({
			path: test.info().outputPath(`${fallback}-viewer.png`),
		});
		await page.reload();
		await expect(page.locator(".empty-message")).toHaveText(
			"Choose a Gerber file to view it.",
		);
		await expect(page.locator("canvas")).toHaveCount(0);
	});
}

test("displays an already parsed layer without file loading or page chrome", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	await page.addInitScript(() =>
		Object.defineProperty(navigator, "gpu", { value: undefined }),
	);
	await page.goto("/tests/browser/standalone-viewer.html");
	const snapshot = async () =>
		JSON.parse((await page.locator("#snapshot").textContent()) || "{}");
	await expect
		.poll(async () => (await snapshot()).diagnostics?.triangles ?? 0)
		.toBeGreaterThan(10);
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect(page.locator("header, footer, input, button, dl")).toHaveCount(
		0,
	);
	expect(requests.some((url) => url.includes("parse.worker"))).toBe(false);
	const before = await snapshot();
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await expect
		.poll(async () => (await snapshot()).camera.x)
		.not.toBe(before.camera.x);
	await page.keyboard.press("0");
	await expect
		.poll(async () => (await snapshot()).camera.x)
		.toBe(before.camera.x);
	await page.mouse.move(350, 350);
	await page.mouse.wheel(70, 100);
	await expect
		.poll(async () => (await snapshot()).camera.y)
		.not.toBe(before.camera.y);
	expect((await snapshot()).zoom).toBe(before.zoom);
	const panned = await snapshot();
	await page.mouse.down();
	await page.mouse.move(390, 380, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(async () => (await snapshot()).camera.x)
		.toBeCloseTo(panned.camera.x - 40 / panned.camera.scale);
	await expect
		.poll(async () => (await snapshot()).camera.y)
		.toBeCloseTo(panned.camera.y + 30 / panned.camera.scale);
});

test("handles parse failures and keeps the latest file selection", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "gpu", { value: undefined });
		const read = File.prototype.text;
		File.prototype.text = async function () {
			if (this.name === "slow.gbr")
				await new Promise((resolve) => setTimeout(resolve, 250));
			return read.call(this);
		};
	});
	await page.goto("/tests/browser/viewer.html");
	const input = page.locator("input[type=file]");
	await input.setInputFiles({
		name: "invalid.gbr",
		mimeType: "text/plain",
		buffer: Buffer.from("not a gerber file"),
	});
	await expect(page.locator(".viewer-message")).toBeVisible();
	await expect(page.locator("canvas")).toHaveCount(0);
	await input.setInputFiles({
		name: "slow.gbr",
		mimeType: "text/plain",
		buffer: Buffer.from(demoFiles[0].source),
	});
	const latest = demoFiles[1];
	await input.setInputFiles({
		name: latest.name,
		mimeType: "text/plain",
		buffer: Buffer.from(latest.source),
	});
	await expect(page.locator(".layer-name").first()).toHaveText(latest.name);
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	await expect(page.locator(".viewer-message")).toHaveCount(0);
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect(page.locator(".layer-name").first()).toHaveText(latest.name);
	await input.setInputFiles({
		name: demoFiles[0].name,
		mimeType: "text/plain",
		buffer: Buffer.from(demoFiles[0].source),
	});
	await expect(page.locator(".layer-name").first()).toHaveText(
		demoFiles[0].name,
	);
	await expect(page.locator("canvas")).toHaveCount(1);
});

test("reorders layers and preserves focus, visibility and camera", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(() =>
		Object.defineProperty(navigator, "gpu", { value: undefined }),
	);
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles(
		demoFiles.slice(0, 3).map((file) => ({
			name: file.name,
			mimeType: "text/plain",
			buffer: Buffer.from(file.source),
		})),
	);
	const rows = page.locator(".layer-row");
	const names = page.locator(".layer-name");
	await expect(rows).toHaveCount(3);
	await expect(names).toHaveText(
		demoFiles
			.slice(0, 3)
			.reverse()
			.map((file) => file.name),
	);
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(page.locator(".zoom-level")).toHaveText("125%");
	const zoom = "125%";
	const focused = demoFiles[1].name;
	await names.filter({ hasText: focused }).click();
	const focusButton = page.getByRole("button", {
		name: `Focus ${focused}`,
		exact: true,
	});
	await expect(focusButton).toHaveAttribute("aria-pressed", "true");
	await rows.filter({ hasText: focused }).click({ position: { x: 2, y: 2 } });
	await expect(focusButton).toHaveAttribute("aria-pressed", "false");
	await focusButton.focus();
	await page.keyboard.press("Space");
	await expect(focusButton).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator('.layer-select[aria-pressed="true"]')).toHaveCount(
		1,
	);
	await expect(page.locator(".layer-detail")).toHaveCount(0);
	const handle = page.getByRole("button", {
		name: `Reorder ${focused}`,
		exact: true,
	});
	await handle.focus();
	await page.keyboard.press("ArrowUp");
	await expect(names.first()).toHaveText(focused);
	await expect(
		page.getByRole("button", { name: `Focus ${focused}`, exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await handle.dragTo(rows.last(), { targetPosition: { x: 80, y: 40 } });
	await expect(names.last()).toHaveText(focused);
	await expect(page.locator(".zoom-level")).toHaveText(zoom);
	await page
		.getByRole("button", { name: `Hide ${focused}`, exact: true })
		.click();
	await expect(page.locator('.layer-select[aria-pressed="true"]')).toHaveCount(
		0,
	);
	await expect(page.locator('.layer-row[data-hidden="true"]')).toHaveCount(1);
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	await expect(page.locator('.layer-row[data-hidden="true"]')).toHaveCount(0);
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	await expect(page.locator('.layer-select[aria-pressed="true"]')).toHaveCount(
		0,
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(
		page.locator(
			"dl, .layer-panel-heading, .layer-panel-footer, .layer-panel-hint, .renderer-label, .navigation-hint",
		),
	).toHaveCount(0);
	const checkFloatingPanel = async (width: number, height: number) => {
		await expect
			.poll(async () => {
				const panel = await page.locator(".layer-panel").boundingBox();
				const canvas = await page.locator("canvas").boundingBox();
				return (
					!!panel &&
					!!canvas &&
					Math.abs(panel.y - (width <= 600 ? 64 : 16)) < 1 &&
					panel.x > width / 4 &&
					panel.x + panel.width <= width &&
					canvas.x === 0 &&
					canvas.y === 0 &&
					canvas.width === width &&
					canvas.height === height
				);
			})
			.toBe(true);
	};
	await checkFloatingPanel(1440, 900);
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	await page.screenshot({ path: test.info().outputPath("layer-focus.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(rows.first()).toBeVisible();
	await expect(page.locator("canvas")).toBeVisible();
	await checkFloatingPanel(390, 844);
	await page.screenshot({ path: test.info().outputPath("layers-mobile.png") });
	await page
		.getByRole("button", { name: `Remove ${focused}`, exact: true })
		.click();
	await expect(rows).toHaveCount(2);
	await expect(page.locator('.layer-select[aria-pressed="true"]')).toHaveCount(
		0,
	);
	expect(errors).toEqual([]);
});

test("keeps layer actions aligned with long filenames and a scrolling list", async ({
	page,
}) => {
	await page.addInitScript(() =>
		Object.defineProperty(navigator, "gpu", { value: undefined }),
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/tests/browser/viewer.html");
	const names = [
		"In2_Cu.g2",
		"In1_Cu.g1",
		"F_Silkscreen.gto",
		"F_Paste.gtp",
		"F_Mask.gts",
		"F_Cu.gtl",
		"Edge_Cuts.gm1",
		"B_Silkscreen.gbo",
		"B_Paste.gbp",
		"B_Mask.gbs",
		"B_Cu.gbl",
	].map((name) => `midi-pedal-pcb-${name}`);
	names.push(
		"midi-pedal-pcb-with-a-very-long-project-name-and-revision-F_Cu.gtl",
	);
	await page
		.locator("input[type=file]")
		.setInputFiles(
			names.map((name) => ({
				name,
				mimeType: "text/plain",
				buffer: Buffer.from(demoFiles[0].source),
			})),
		);
	await expect(page.locator(".layer-row")).toHaveCount(names.length);
	await page
		.getByRole("button", { name: `Focus ${names.at(-1)}`, exact: true })
		.click();
	const checkColumns = async () => {
		const rows = await page.locator(".layer-row").evaluateAll((elements) =>
			elements.map((row) => {
				const buttons = row.querySelectorAll("button");
				const swatch = row.querySelector(".layer-swatch")!;
				const name = row.querySelector(".layer-name")!;
				return {
					visibility: buttons[2].getBoundingClientRect().x,
					remove: buttons[3].getBoundingClientRect().x,
					swatch: swatch.getBoundingClientRect().width,
					nameRight: name.getBoundingClientRect().right,
					truncated: name.scrollWidth > name.clientWidth,
				};
			}),
		);
		for (const row of rows) {
			expect(row.visibility).toBe(rows[0].visibility);
			expect(row.remove).toBe(rows[0].remove);
			expect(row.swatch).toBe(7);
			expect(row.nameRight).toBeLessThan(row.visibility);
		}
		expect(rows[0].truncated).toBe(true);
	};
	await checkColumns();
	await expect(page.locator(".layer-name").first()).toHaveAttribute(
		"title",
		names.at(-1)!,
	);
	await page
		.locator(".layer-panel")
		.screenshot({ path: test.info().outputPath("layer-alignment.png") });
	await page.setViewportSize({ width: 390, height: 500 });
	await checkColumns();
	const list = page.locator(".layer-list");
	await list.hover();
	await page.mouse.wheel(0, 1000);
	await expect
		.poll(() => list.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
	await expect(
		page.getByRole("button", { name: `Remove ${names[0]}`, exact: true }),
	).toBeVisible();
	await page
		.locator(".layer-panel")
		.screenshot({ path: test.info().outputPath("layer-alignment-mobile.png") });
});
