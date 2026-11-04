import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";

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
	await expect
		.poll(() =>
			page.getByTestId("viewport-grid").evaluate((grid) => {
				const patterns = [...grid.querySelectorAll("pattern")];
				const ticks = [
					...document.querySelectorAll<SVGGElement>(
						'[aria-label="Drawing rulers in millimetres"] g',
					),
				];
				return (
					patterns.length > 0 &&
					ticks.length > 0 &&
					patterns.every(
						(pattern) =>
							pattern.querySelector("circle")?.getAttribute("r") === "1",
					) &&
					ticks.every((tick) => {
						const horizontal = tick.dataset.axis === "x";
						const position = Number(
							(
								tick.querySelector("line") ??
								(() => {
									throw new Error("Expected a value");
								})()
							).getAttribute(horizontal ? "x1" : "y1"),
						);
						return patterns.some((pattern) => {
							const spacing = Number(pattern.getAttribute("width"));
							const origin =
								Number(pattern.getAttribute(horizontal ? "x" : "y")) +
								spacing / 2;
							const offset = (position - origin) / spacing;
							return Math.abs(offset - Math.round(offset)) < 0.001;
						});
					})
				);
			}),
		)
		.toBe(true);
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
	await expect(page.getByTestId("viewer-message")).toHaveText(
		"negative.gbr: Line 5: Legacy negative image polarity IPNEG is unsupported; the image would render inverted.",
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
	await expect(list.getByRole("listitem")).toHaveText([
		"Error · Line 5Unsupported G-code G99",
		"Warning · Line 10Region contour is not closed; a closing segment was added.",
	]);
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
	).toHaveText([
		"Warning · Line 6Missing M02 end-of-file command; the file may be truncated.",
	]);
	expect(errors).toEqual([]);
});
