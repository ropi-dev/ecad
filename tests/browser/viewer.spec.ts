import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";

test("Gerber uses the locked top viewer and supports pan, zoom and fit", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/viewer.html");
	await expect(page.getByText("Choose Gerber files or a ZIP archive to view them.", { exact: true })).toHaveCount(0);
	await expect(page.getByTestId("viewport-grid")).toBeVisible();
	await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toBeEnabled();
	await expect(page.getByRole("complementary", { name: "Layers" })).toHaveCount(0);
	const emptyState = JSON.parse((await page.locator("#scene-state").textContent())!);
	expect(emptyState.objects).toEqual([]);
	expect(emptyState.camera[0]).toBeCloseTo(0, 8);
	expect(emptyState.camera[1]).toBeCloseTo(0, 8);
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toHaveText("125%");
	await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
	await page.screenshot({ path: test.info().outputPath("empty-gerber-grid.png") });
	const file = demoFiles[0];
	await page.locator("input[type=file]").setInputFiles({
		name: file.name,
		mimeType: "text/plain",
		buffer: Buffer.from(file.source),
	});
	const canvas = page.locator("canvas");
	await expect(
		page.getByRole("button", { name: "Fit drawing", exact: true }),
	).toBeEnabled();
	await expect(canvas).toHaveAttribute(
		"aria-label",
		/Gerber drawing.*Top view locked/,
	);
	const capture = async () => {
		await page.mouse.move(0, 0);
		return createHash("sha256")
			.update(await canvas.screenshot())
			.digest("hex");
	};
	const top = await capture();
	await expect(
		page.getByRole("button", { name: /^(Iso|Top|Front)$/ }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect.poll(capture).not.toBe(top);
	await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
	await expect.poll(capture).toBe(top);
	// Start clear of the layer panel on the left.
	await page.mouse.move(400, 350);
	await page.keyboard.down("Shift");
	await page.mouse.down();
	await page.mouse.move(480, 390, { steps: 5 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await expect.poll(capture).not.toBe(top);
	await expect(page.locator("[data-testid=viewer-message]")).toHaveCount(0);
	expect(errors).toEqual([]);
	await page.screenshot({ path: test.info().outputPath("gerber-3d.png") });
	await page.reload();
	await expect(canvas).toHaveCount(1);
	await expect(page.getByTestId("viewport-grid")).toBeVisible();
});

test("Gerber reports unavailable 3D rendering and leaves file controls usable", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			type: string,
			...args: unknown[]
		) {
			return type === "webgl2"
				? null
				: Reflect.apply(original, this, [type, ...args]);
		} as typeof original;
	});
	await page.goto("/tests/browser/viewer.html");
	const file = demoFiles[0];
	await page.locator("input[type=file]").setInputFiles({
		name: file.name,
		mimeType: "text/plain",
		buffer: Buffer.from(file.source),
	});
	await expect(page.locator("[data-testid=viewer-message]")).toContainText(
		"3D viewer unavailable",
	);
	await expect(page.locator("canvas")).toHaveCount(0);
	await expect(
		page.getByRole("toolbar", { name: "View controls" }),
	).toHaveCount(0);
	await page
		.getByRole("button", { name: `Remove ${file.name}`, exact: true })
		.click();
	await expect(page.locator("[data-layer-id]")).toHaveCount(0);
	await expect(page.locator("input[type=file]")).toBeEnabled();
});

test("displays an already parsed object with shared view controls and no file loading", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	await page.goto("/tests/browser/standalone-viewer.html");
	await expect(page.locator("#ready")).toHaveText("true");
	const canvas = page.locator("canvas");
	await expect(canvas).toHaveCount(1);
	await expect(canvas).toHaveAttribute(
		"aria-label",
		/Gerber drawing.*Top view locked/,
	);
	await expect(page.locator("header, footer, input, dl")).toHaveCount(0);
	await expect(
		page.getByRole("toolbar", { name: "View controls", exact: true }),
	).toHaveCount(1);
	expect(requests.some((url) => url.includes("parse.worker"))).toBe(false);
	const capture = async () => {
		await page.mouse.move(0, 0);
		return (
			await canvas.screenshot({ style: "canvas { outline: none !important; }" })
		).toString("base64");
	};
	const before = await capture();
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect.poll(capture).not.toBe(before);
	await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
	await expect.poll(capture).toBe(before);
	await canvas.focus();
	await page.keyboard.press("+");
	await expect.poll(capture).not.toBe(before);
	await page.keyboard.press("F6");
	await expect.poll(capture).toBe(before);
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
	await expect(page.locator("[data-testid=viewer-message]")).toBeVisible();
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect(page.getByTestId("viewport-grid")).toBeVisible();
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
	await expect(page.locator("[data-testid=layer-name]").first()).toHaveText(latest.name);
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	await expect(page.locator("[data-testid=viewer-message]")).toHaveCount(0);
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect(page.locator("[data-testid=layer-name]").first()).toHaveText(latest.name);
	await input.setInputFiles({
		name: demoFiles[0].name,
		mimeType: "text/plain",
		buffer: Buffer.from(demoFiles[0].source),
	});
	await expect(page.locator("[data-testid=layer-name]").first()).toHaveText(
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
	const rows = page.locator("[data-layer-id]");
	const names = page.locator("[data-testid=layer-name]");
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
	const canvasHandle = await page.locator("canvas").elementHandle();
	const capture = async () => {
		await page.mouse.move(0, 0);
		return createHash("sha256")
			.update(await page.locator("canvas").screenshot())
			.digest("hex");
	};
	const zoomed = await capture();
	const focused = demoFiles[1].name;
	await names.filter({ hasText: focused }).click();
	const focusButton = page.getByRole("button", {
		name: `Focus ${focused}`,
		exact: true,
	});
	await expect(focusButton).toHaveAttribute("aria-pressed", "true");
	await rows.filter({ hasText: focused }).click({ position: { x: 2, y: 2 } });
	await expect(focusButton).toHaveAttribute("aria-pressed", "false");
	await expect.poll(capture).toBe(zoomed);
	await focusButton.focus();
	await page.keyboard.press("Space");
	await expect(focusButton).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator('[data-testid=layer-select][aria-pressed="true"]')).toHaveCount(
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
	expect(
		await canvasHandle!.evaluate(
			(element) => element === document.querySelector("canvas"),
		),
	).toBe(true);
	await page
		.getByRole("button", { name: `Hide ${focused}`, exact: true })
		.click();
	await expect(page.locator('[data-testid=layer-select][aria-pressed="true"]')).toHaveCount(
		0,
	);
	await expect(page.locator('[data-layer-id][data-hidden="true"]')).toHaveCount(1);
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	await expect(page.locator('[data-layer-id][data-hidden="true"]')).toHaveCount(0);
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	await expect(page.locator('[data-testid=layer-select][aria-pressed="true"]')).toHaveCount(
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
				const panel = await page.getByRole("complementary", { name: "Layers" }).boundingBox();
				const canvas = await page.locator("canvas").boundingBox();
				return (
					!!panel &&
					!!canvas &&
					Math.abs(panel.y + panel.height / 2 - height / 2) < 1 &&
					Math.abs(panel.x - (width <= 600 ? 36 : 40)) < 1 &&
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
	await expect(page.locator('[data-testid=layer-select][aria-pressed="true"]')).toHaveCount(
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
	await page.locator("input[type=file]").setInputFiles(
		names.map((name) => ({
			name,
			mimeType: "text/plain",
			buffer: Buffer.from(demoFiles[0].source),
		})),
	);
	await expect(page.locator("[data-layer-id]")).toHaveCount(names.length);
	await page
		.getByRole("button", { name: `Focus ${names.at(-1)}`, exact: true })
		.click();
	const checkColumns = async () => {
		const rows = await page.locator("[data-layer-id]").evaluateAll((elements) =>
			elements.map((row) => {
				const buttons = row.querySelectorAll("button");
				const swatch = row.querySelector("[data-testid=layer-swatch]")!;
				const name = row.querySelector("[data-testid=layer-name]")!;
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
	await expect(page.locator("[data-testid=layer-name]").first()).toHaveAttribute(
		"title",
		names.at(-1)!,
	);
	await page
		.getByRole("complementary", { name: "Layers" })
		.screenshot({ path: test.info().outputPath("layer-alignment.png") });
	await page.setViewportSize({ width: 390, height: 500 });
	await checkColumns();
	const list = page.locator("[aria-label=Layers] ol");
	await list.hover();
	await page.mouse.wheel(0, 1000);
	await expect
		.poll(() => list.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
	await expect(
		page.getByRole("button", { name: `Remove ${names[0]}`, exact: true }),
	).toBeVisible();
	await page
		.getByRole("complementary", { name: "Layers" })
		.screenshot({ path: test.info().outputPath("layer-alignment-mobile.png") });
});

test("Gerber layers occupy separate Z positions and fit the full stack", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	const file = (name: string) => ({
		name,
		mimeType: "text/plain",
		buffer: Buffer.from("%FSLAX46Y46*%%MOMM*%%ADD10C,0.02*%D10*X0Y0D03*M02*"),
	});
	const input = page.locator("input[type=file]");
	await input.setInputFiles([
		file("bottom.gbr"),
		file("middle.gbr"),
		file("top.gbr"),
	]);
	const state = async () =>
		JSON.parse((await page.locator("#scene-state").textContent()) || "{}");
	const heights = async () =>
		Object.fromEntries(
			((await state()).objects ?? []).map(
				(object: { name: string; z: number }) => [object.name, object.z],
			),
		);
	await expect
		.poll(heights)
		.toEqual({ "bottom.gbr": 0, "middle.gbr": 0.1, "top.gbr": 0.2 });
	const initial = await state();
	// A tall, narrow stack catches fitting against the original coplanar bounds.
	for (const object of initial.objects) {
		for (const corner of object.corners) {
			for (const value of corner) expect(Math.abs(value)).toBeLessThan(1);
		}
	}
	await page
		.getByRole("button", { name: "Hide middle.gbr", exact: true })
		.click();
	await expect
		.poll(
			async () =>
				(await state()).objects.find(
					(object: { name: string }) => object.name === "middle.gbr",
				).visible,
		)
		.toBe(false);
	await expect
		.poll(heights)
		.toEqual({ "bottom.gbr": 0, "middle.gbr": 0.1, "top.gbr": 0.2 });
	expect((await state()).camera).toEqual(initial.camera);
	await page
		.getByRole("button", { name: "Reorder middle.gbr", exact: true })
		.focus();
	await page.keyboard.press("ArrowUp");
	await expect
		.poll(heights)
		.toEqual({ "bottom.gbr": 0, "middle.gbr": 0.2, "top.gbr": 0.1 });
	expect((await state()).camera).toEqual(initial.camera);
	await page
		.getByRole("button", { name: "Remove middle.gbr", exact: true })
		.click();
	await expect.poll(heights).toEqual({ "bottom.gbr": 0, "top.gbr": 0.1 });
	await input.setInputFiles(file("new.gbr"));
	await expect
		.poll(heights)
		.toEqual({ "bottom.gbr": 0, "top.gbr": 0.1, "new.gbr": 0.2 });
	await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
	await page.screenshot({
		path: test.info().outputPath("separated-layers.png"),
	});
});

test("Gerber imports away from the origin fit around world 0,0", async ({ page }) => {
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles({
		name: "offset-board.gbr",
		mimeType: "text/plain",
		buffer: Buffer.from("%FSLAX46Y46*%%MOMM*%%ADD10R,40X20*%D10*X123000000Y-47000000D03*M02*"),
	});
	const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
	await expect(fit).toBeEnabled();
	const state = async () => JSON.parse((await page.locator("#scene-state").textContent()) || "{}");
	const checkCenter = async () => {
		await expect(async () => {
			const current = await state();
			expect(current.camera[0]).toBeCloseTo(0, 8);
			expect(current.camera[1]).toBeCloseTo(0, 8);
			const corners: number[][] = current.objects[0].corners;
			for (const axis of [0, 1]) {
				const values = corners.map((corner) => corner[axis]);
				expect((Math.min(...values) + Math.max(...values)) / 2).toBeCloseTo(0, 8);
				expect(Math.max(...values.map(Math.abs))).toBeLessThan(1);
			}
		}).toPass();
	};
	await checkCenter();
	await page.mouse.move(640, 360);
	await page.mouse.wheel(120, 80);
	await expect.poll(async () => (await state()).camera[0]).not.toBeCloseTo(0, 4);
	await fit.click();
	await checkCenter();
	await page.getByRole("button", { name: "Orthographic camera" }).click();
	await checkCenter();
	await page.getByRole("button", { name: "Hide offset-board.gbr", exact: true }).click();
	await page.getByRole("button", { name: "Show offset-board.gbr", exact: true }).click();
	await fit.click();
	await checkCenter();
	await page.screenshot({ path: test.info().outputPath("origin-centered-gerber.png") });
});
