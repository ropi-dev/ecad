import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";

test("the background grid does not draw over opaque layer geometry", async ({
	page,
}) => {
	await page.goto("/tests/browser/generic-viewers.html");
	await expect(page.getByTestId("viewport-grid")).toBeVisible();
	await page.mouse.move(0, 0);
	const { camera, viewport } = JSON.parse(
		(await page.locator("#snapshot").textContent())!,
	);
	const canvas = (await page.locator("canvas").boundingBox())!;
	const clip = {
		x: canvas.x + viewport.width / 2 + (-12 - camera.x) * camera.scale - 20,
		y: canvas.y + viewport.height / 2 + camera.y * camera.scale - 20,
		width: 40,
		height: 40,
	};
	const withGrid = await page.screenshot({ clip });
	await page.getByTestId("viewport-grid").evaluate((element) => {
		element.style.visibility = "hidden";
	});
	expect((await page.screenshot({ clip })).equals(withGrid)).toBe(true);
});

test("rulers follow pan, zoom and both 2D projections", async ({ page }) => {
	await page.goto("/tests/browser/generic-viewers.html");
	const rulers = page.getByRole("img", {
		name: "Drawing rulers in millimetres",
	});
	await expect(rulers).toBeVisible();
	const xZero = rulers.locator('[data-axis="x"][data-value="0"] line');
	const yZero = rulers.locator('[data-axis="y"][data-value="0"] line');
	await expect(xZero).toHaveAttribute("x1", "400");
	await expect(yZero).toHaveAttribute("x1", "776");
	await expect(yZero).toHaveAttribute("x2", "785");
	await expect
		.poll(async () => Number(await yZero.getAttribute("y1")))
		.toBeCloseTo(300);
	const checkProjection = async () => {
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const { position, projectionY, type } = JSON.parse(
						document.querySelector("#camera")!.textContent!,
					);
					const scale =
						(300 * projectionY) /
						(type === "OrthographicCamera" ? 1 : position[2]);
					const ticks = [
						...document.querySelectorAll<SVGGElement>('[role="img"][aria-label="Drawing rulers in millimetres"] g'),
					];
					const grid = [
						...document.querySelectorAll<SVGLineElement>('[data-testid="viewport-grid"] line'),
					];
					const columns = grid
						.filter((line) => line.getAttribute("x1") === line.getAttribute("x2"))
						.map((line) => Number(line.getAttribute("x1")))
						.sort((first, second) => first - second);
					return (
						grid.length > 0 &&
						columns[0] <= columns[1] - columns[0] + 0.01 &&
						grid.length >= ticks.length &&
						ticks.every((tick) => {
							const horizontal = tick.dataset.axis === "x";
							const value = Number(tick.dataset.value);
							const actual = Number(
								tick
									.querySelector("line")!
									.getAttribute(horizontal ? "x1" : "y1"),
							);
							const expected = horizontal
								? 400 + (value - position[0]) * scale
								: 300 - (value - position[1]) * scale;
							const matchingLine = grid.find((line) =>
								Number(line.getAttribute(horizontal ? "y1" : "x1")) === 0 &&
								Math.abs(Number(line.getAttribute(horizontal ? "x1" : "y1")) - actual) < 0.01,
							);
							return (
								Math.abs(actual - expected) < 0.01 &&
								matchingLine !== undefined &&
								Number(matchingLine.getAttribute(horizontal ? "y2" : "x2")) ===
									(horizontal ? 600 : 800)
							);
						})
					);
				}),
			)
			.toBe(true);
	};
	for (const orthographic of [false, true]) {
		if (orthographic)
			await page.getByRole("button", { name: "Orthographic camera" }).click();
		await page.getByRole("button", { name: "Pan", exact: true }).click();
		await expect(xZero).not.toHaveAttribute("x1", "400");
		await checkProjection();
		const beforeZoom = await page.locator("#snapshot").textContent();
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		await expect(page.locator("#snapshot")).not.toHaveText(beforeZoom!);
		await checkProjection();
		await page.getByRole("button", { name: "Reset", exact: true }).click();
		await expect(xZero).toHaveAttribute("x1", "400");
	}
	// Panning well beyond the board still leaves a full, aligned grid.
	await page.locator("canvas").hover({ position: { x: 500, y: 100 } });
	const beforePan = await page.locator("#snapshot").textContent();
	await page.mouse.wheel(2000, 1500);
	await expect(page.locator("#snapshot")).not.toHaveText(beforePan!);
	await checkProjection();
	// The ruler overlay must leave canvas navigation available.
	expect(
		await rulers.evaluate((element) => getComputedStyle(element).pointerEvents),
	).toBe("none");
});

test("rulers fit desktop and mobile Gerber viewports without covering controls", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles(
		demoFiles.slice(0, 3).map((file) => ({
			name: file.name,
			mimeType: "text/plain",
			buffer: Buffer.from(file.source),
		})),
	);
	const rulers = page.getByRole("img", {
		name: "Drawing rulers in millimetres",
	});
	for (const [width, height] of [
		[1280, 800],
		[390, 844],
	]) {
		await page.setViewportSize({ width, height });
		await expect(rulers).toHaveAttribute("width", String(width));
		await expect(rulers).toHaveAttribute("height", String(height));
		await expect(rulers.locator('[data-axis="y"] line').first()).toHaveAttribute("x1", String(width - 24));
		await expect(page.getByTestId("viewport-grid")).toHaveAttribute(
			"width",
			String(width),
		);
		await expect(page.getByTestId("viewport-grid")).toHaveAttribute(
			"height",
			String(height),
		);
		for (const selector of ["header", '[aria-label="Layers"]']) {
			const box = (await page.locator(selector).boundingBox())!;
			expect(box.x).toBeGreaterThan(24);
			expect(box.y).toBeGreaterThan(24);
		}
		if (captureArtifacts) await page.screenshot({
			path: `perf-artifacts/rulers-right-gerber-${width}.png`,
		});
	}
});
