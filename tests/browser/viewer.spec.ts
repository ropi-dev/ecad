import { captureArtifacts } from "./artifacts";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";

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
	await expect(page.locator("[data-testid=layer-name]").first()).toHaveText(
		latest.name,
	);
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	await expect(page.locator("[data-testid=viewer-message]")).toHaveCount(0);
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect(page.locator("[data-testid=layer-name]").first()).toHaveText(
		latest.name,
	);
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
	await expect.poll(() => page.getByTestId("viewport-grid").evaluate((grid) => {
		const patterns = [...grid.querySelectorAll("pattern")];
		const ticks = [...document.querySelectorAll<SVGGElement>('[aria-label="Drawing rulers in millimetres"] g')];
		return patterns.length > 0 && ticks.length > 0 &&
			patterns.every((pattern) => pattern.querySelector("circle")?.getAttribute("r") === "1") &&
			ticks.every((tick) => {
				const horizontal = tick.dataset.axis === "x";
				const position = Number(tick.querySelector("line")!.getAttribute(horizontal ? "x1" : "y1"));
				return patterns.some((pattern) => {
					const spacing = Number(pattern.getAttribute("width"));
					const origin = Number(pattern.getAttribute(horizontal ? "x" : "y")) + spacing / 2;
					const offset = (position - origin) / spacing;
					return Math.abs(offset - Math.round(offset)) < 0.001;
				});
			});
	})).toBe(true);
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
		await canvasHandle!.evaluate(
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
