import { createHash } from "node:crypto";
import type { Camera } from "three";
import { demoFiles } from "../fixtures/demo-gerbers";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { expect, test } from "./seeded-project";

test("reorders layers and preserves focus, visibility and camera", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
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
	// The viewport draws the grid; editor.spec checks that dots meet the ticks.
	await expect(
		page.locator('[aria-label="Drawing rulers in millimetres"] [data-axis]'),
	).not.toHaveCount(0);
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
	await expect(
		page.locator('[data-testid=layer-select][aria-pressed="true"]'),
	).toHaveCount(1);
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
		await required(canvasHandle).evaluate(
			(element) => element === document.querySelector("canvas"),
		),
	).toBe(true);
	await page
		.getByRole("button", { name: `Hide ${focused}`, exact: true })
		.click();
	await expect(
		page.locator('[data-testid=layer-select][aria-pressed="true"]'),
	).toHaveCount(0);
	await expect(page.locator('[data-layer-id][data-hidden="true"]')).toHaveCount(
		1,
	);
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	await expect(page.locator('[data-layer-id][data-hidden="true"]')).toHaveCount(
		0,
	);
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	await expect(
		page.locator('[data-testid=layer-select][aria-pressed="true"]'),
	).toHaveCount(0);
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(
		page.locator(
			"dl, .layer-panel-heading, .layer-panel-footer, .layer-panel-hint, .renderer-label, .navigation-hint",
		),
	).toHaveCount(0);
	const checkFloatingPanel = async (width: number, height: number) => {
		await expect
			.poll(async () => {
				const panel = await page
					.getByRole("complementary", { name: "Layers" })
					.boundingBox();
				const canvas = await page.locator("canvas").boundingBox();
				// On a wide screen the panel floats at the top right. On a phone it
				// is a sheet above the toolbar.
				const placed =
					!!panel &&
					(width <= 760
						? Math.abs(panel.x - 8) < 1 &&
							panel.y >= height * 0.4 &&
							panel.y + panel.height <= height - 60
						: panel.y < 80 &&
							panel.x + panel.width <= width - 16 &&
							panel.x + panel.width > width - 80);
				return (
					!!panel &&
					!!canvas &&
					placed &&
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
	const collapse = page.getByRole("button", {
		name: "Collapse layers",
		exact: true,
	});
	await expect(collapse).toHaveAttribute("aria-expanded", "true");
	await collapse.click();
	const expand = page.getByRole("button", {
		name: "Expand layers",
		exact: true,
	});
	await expect(expand).toHaveAttribute("aria-expanded", "false");
	await expect(rows.first()).toBeHidden();
	await expand.click();
	await expect(rows.first()).toBeVisible();
	await page
		.getByRole("button", { name: `Focus ${focused}`, exact: true })
		.click();
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("layer-focus.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(rows.first()).toBeVisible();
	await expect(page.locator("canvas")).toBeVisible();
	await checkFloatingPanel(390, 844);
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("layers-mobile.png"),
		});
	await page
		.getByRole("button", { name: `Remove ${focused}`, exact: true })
		.click();
	await expect(rows).toHaveCount(2);
	await expect(
		page.locator('[data-testid=layer-select][aria-pressed="true"]'),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("hovering a Gerber shape does not highlight it, but clicking selects it", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles(
		demoFiles.slice(0, 1).map((file) => ({
			name: file.name,
			mimeType: "text/plain",
			buffer: Buffer.from(file.source),
		})),
	);
	await expect(page.locator("[data-layer-id]")).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	const highlighted = async () =>
		JSON.parse((await page.locator("#scene-state").textContent()) || "{}")
			.highlighted ?? 0;
	const selection = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	const box = required(await page.locator("canvas").boundingBox());
	let point: { x: number; y: number } | undefined;
	for (let step = 0; step < 40 && !point; step++) {
		const x = box.x + box.width * (0.35 + 0.3 * ((step % 8) / 7));
		const y = box.y + box.height * (0.35 + 0.3 * (Math.floor(step / 8) / 4));
		await page.mouse.dblclick(x, y);
		if (await selection.isVisible()) point = { x, y };
	}
	const target = required(point);
	await page.keyboard.press("Escape");
	await page.mouse.move(target.x + 1, target.y + 1);
	await page.mouse.move(target.x, target.y);
	await page.waitForTimeout(300);
	expect(await highlighted()).toBe(0);
	await page.mouse.click(target.x, target.y);
	await page.waitForTimeout(300);
	await expect(selection).toBeHidden();
	await page.mouse.dblclick(target.x, target.y);
	await expect(selection).toBeVisible();
	await page.mouse.move(target.x + 1, target.y);
	await page.waitForTimeout(300);
	expect(await highlighted()).toBe(0);
	expect(errors).toEqual([]);
});

test("the 3D camera orbits the same viewport and layer stack and returns to the top view", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles(
		demoFiles.slice(0, 3).map((file) => ({
			name: file.name,
			mimeType: "text/plain",
			buffer: Buffer.from(file.source),
		})),
	);
	await expect(page.locator("[data-layer-id]")).toHaveCount(3);
	const state = async () =>
		JSON.parse(
			(await page.locator("#scene-state").textContent()) || '{"objects":[]}',
		) as {
			objects: { name: string; z: number }[];
			grids: { flat: boolean; plane: boolean };
			camera: number[];
		};
	const heights = async () =>
		Object.fromEntries(
			(await state()).objects.map((object) => [
				object.name,
				Number(object.z.toFixed(3)),
			]),
		);
	const rulers = page.locator('[aria-label="Drawing rulers in millimetres"]');
	const axes = page.getByRole("img", { name: "XYZ axis orientation" });
	const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
	await expect(zoomIn).toBeEnabled();
	await zoomIn.click();
	await zoomIn.click();
	const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
	const zoomed = "156%";
	await expect(fit).toHaveText(zoomed);
	const canvas = required(await page.locator("canvas").elementHandle());
	const sameCanvas = () =>
		canvas.evaluate((element) => element === document.querySelector("canvas"));
	const toggle = page.getByRole("button", { name: "2D", exact: true });
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.poll(async () => (await state()).camera.length).toBe(3);
	const flatHeight = (await state()).camera[2];
	await expect(axes).toHaveCount(0);
	const stack = {
		"atlas-F_Cu.gbr": 0.835,
		"atlas-B_Cu.gbr": -0.835,
		"atlas-F_Mask.gbr": 0.855,
	};
	await expect.poll(heights).toEqual(stack);
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(rulers).toHaveCount(0);
	await expect(axes).toBeVisible();
	expect(await heights()).toEqual(stack);
	await expect
		.poll(async () => (await state()).grids)
		.toEqual({ flat: false, plane: true });
	await expect
		.poll(async () => {
			const [x, y] = (await state()).camera;
			return Math.hypot(x, y);
		})
		.toBeGreaterThan(1);
	expect(await sameCanvas()).toBe(true);
	await expect(
		page.getByRole("button", { name: "Iso", exact: true }),
	).toHaveCount(0);
	await expect(fit).toHaveText(zoomed);
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("layers-3d.png") });
	const box = required(await page.locator("canvas").boundingBox());
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 200, {
		steps: 8,
	});
	await page.mouse.up();
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(rulers).toHaveCount(1);
	await expect(axes).toHaveCount(0);
	const percent = async () =>
		Number.parseInt((await fit.textContent()) ?? "", 10);
	await expect
		.poll(
			async () =>
				((await state()).camera[2] / flatHeight) *
				((await percent()) / Number.parseInt(zoomed, 10)),
		)
		.toBeCloseTo(1, 2);
	expect(await heights()).toEqual(stack);
	await expect
		.poll(async () => (await state()).grids)
		.toEqual({ flat: true, plane: false });
	expect(await sameCanvas()).toBe(true);
	expect(errors).toEqual([]);
});

test("3D navigation turns around and drags the board point under the cursor", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles(
		demoFiles.slice(0, 3).map((file) => ({
			name: file.name,
			mimeType: "text/plain",
			buffer: Buffer.from(file.source),
		})),
	);
	await expect(page.locator("[data-layer-id]")).toHaveCount(3);
	const plane = async () =>
		JSON.parse((await page.locator("#scene-state").textContent()) || "{}").grids
			?.plane;
	await page.getByRole("button", { name: "2D", exact: true }).click();
	await expect.poll(plane).toBe(true);
	const box = required(await page.locator("canvas").boundingBox());
	const ground = (x: number, y: number) =>
		page.evaluate(
			({ x, y }) => {
				const camera = (window as unknown as { sceneCamera: Camera })
					.sceneCamera;
				const near = camera.position.clone().set(x, y, -1).unproject(camera);
				const far = camera.position.clone().set(x, y, 1).unproject(camera);
				return near
					.clone()
					.lerp(far, near.z / (near.z - far.z))
					.toArray();
			},
			{
				x: ((x - box.x) / box.width) * 2 - 1,
				y: 1 - ((y - box.y) / box.height) * 2,
			},
		);
	const screen = (point: number[]) =>
		page.evaluate((point) => {
			const camera = (window as unknown as { sceneCamera: Camera }).sceneCamera;
			const [x, y] = camera.position
				.clone()
				.fromArray(point)
				.project(camera)
				.toArray();
			return [x, y];
		}, point);
	const drag = async (
		from: { x: number; y: number },
		dx: number,
		dy: number,
		shift = false,
	) => {
		await page.mouse.move(from.x, from.y);
		if (shift) await page.keyboard.down("Shift");
		await page.mouse.down();
		await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
		await page.mouse.up();
		if (shift) await page.keyboard.up("Shift");
		await page.waitForTimeout(150);
	};
	const toPixels = ([x, y]: number[]) => ({
		x: box.x + ((x + 1) / 2) * box.width,
		y: box.y + ((1 - y) / 2) * box.height,
	});
	const near = (actual: number[], expected: { x: number; y: number }) => {
		const pixel = toPixels(actual);
		expect(Math.abs(pixel.x - expected.x)).toBeLessThan(1.5);
		expect(Math.abs(pixel.y - expected.y)).toBeLessThan(1.5);
	};
	const cursor = {
		x: box.x + box.width * 0.42,
		y: box.y + box.height * 0.55,
	};
	await drag(cursor, -150, -60);
	const centre = await ground(box.x + box.width / 2, box.y + box.height / 2);
	const offBoard = { x: box.x + 12, y: box.y + box.height - 12 };
	const before = toPixels(await screen(centre));
	await drag(offBoard, 100, -60, true);
	near(await screen(centre), before);
	const grabbed = await ground(cursor.x, cursor.y);
	await drag(cursor, 140, -90, true);
	near(await screen(grabbed), cursor);
	await drag(cursor, 120, 70);
	near(await screen(grabbed), { x: cursor.x + 120, y: cursor.y + 70 });
	const focus = async () =>
		JSON.parse((await page.locator("#scene-state").textContent()) || "{}")
			.focus as number[] | null;
	const start = { x: cursor.x + 120, y: cursor.y + 70 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x - 80, start.y + 40, { steps: 6 });
	await page.waitForTimeout(150);
	expect(await focus()).toBeNull();
	await page.mouse.up();
	const pivot = { x: start.x - 80, y: start.y + 40 };
	await page.mouse.move(pivot.x, pivot.y);
	await page.keyboard.down("Shift");
	await page.mouse.down();
	await page.waitForTimeout(150);
	expect(await focus()).toBeNull();
	await page.mouse.move(pivot.x + 90, pivot.y - 50, { steps: 6 });
	await expect.poll(focus).not.toBeNull();
	near(await screen(required(await focus())), pivot);
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("orbit-focus.png") });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await expect.poll(focus).toBeNull();
	expect(errors).toEqual([]);
});

test("Gerber layers with recoverable problems render and list their diagnostics", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/viewer.html");
	const header = "%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1*%\nD10*\n";
	const file = (name: string, source: string) => ({
		name,
		mimeType: "text/plain",
		buffer: Buffer.from(source),
	});
	await page
		.locator("input[type=file]")
		.setInputFiles([
			file("truncated.gbr", `${header}X0Y0D03*\nX2000000Y0D03*\n`),
			file(
				"region.gbr",
				`${header}G99*\nG36*\nX0Y0D02*\nX1000000Y0D01*\nX1000000Y1000000D01*\nG37*\nM02*\n`,
			),
			file("negative.gbr", `${header}%IPNEG*%\nX0Y0D03*\nM02*\n`),
		]);
	await expect(page.locator("[data-testid=layer-name]")).toHaveText([
		"region.gbr",
		"truncated.gbr",
	]);
	await expect(page.getByTestId("viewer-message")).toContainText(
		"negative.gbr",
	);
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await page.locator("#scene-state").textContent()) ||
						'{"objects":[]}',
				).objects.filter((object: { visible: boolean }) => object.visible)
					.length,
		)
		.toBe(2);
	const truncated = page.getByRole("button", {
		name: "Diagnostics for truncated.gbr: 1 warning",
		exact: true,
	});
	await expect(truncated).toHaveText("1");
	await expect(truncated).toHaveAttribute("aria-expanded", "false");
	const region = page.getByRole("button", {
		name: "Diagnostics for region.gbr: 2 problems (1 error, 1 warning)",
		exact: true,
	});
	await expect(region).not.toHaveAttribute("aria-controls");
	await region.click();
	await expect(region).toHaveAttribute("aria-expanded", "true");
	await expect(region).toHaveAttribute(
		"aria-controls",
		required(
			await page.getByTestId("layer-diagnostics-list").getAttribute("id"),
		),
	);
	const list = page.getByRole("list", {
		name: "Diagnostics for region.gbr",
		exact: true,
	});
	await expect(list.getByRole("listitem")).toHaveText([/Line 5/, /Line 10/]);
	// Reading the list must not toggle layer focus.
	await list.getByRole("listitem").first().click();
	await expect(
		page.locator('[data-testid=layer-select][aria-pressed="true"]'),
	).toHaveCount(0);
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("layer-diagnostics.png"),
		});
	await truncated.click();
	await expect(
		page
			.getByRole("list", { name: "Diagnostics for truncated.gbr", exact: true })
			.getByRole("listitem"),
	).toHaveText([/Line 6/]);
	expect(errors).toEqual([]);
});
