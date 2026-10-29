import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";

test("3D toolbar projection switching preserves framing and fits on mobile", async ({
	page,
}) => {
	await page.goto("/tests/browser/generic-viewers.html?3d");
	const toolbar = page.getByRole("toolbar", { name: "3D view controls" });
	const toggle = toolbar.getByRole("button", { name: "Orthographic camera" });
	await expect(toggle).toBeEnabled();
	const camera = async () =>
		JSON.parse((await page.locator("#camera").textContent())!);
	const visibleHeight = (state: {
		type: string;
		position: number[];
		target: number[];
		projectionY: number;
	}) =>
		(2 *
			(state.type === "OrthographicCamera"
				? 1
				: Math.hypot(
						...state.position.map(
							(value, index) => value - state.target[index],
						),
					))) /
		state.projectionY;
	await toolbar.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(
		toolbar.getByRole("button", { name: "Fit model", exact: true }),
	).toHaveText("125%");
	const before = await camera();
	for (const orthographic of [true, false]) {
		await toggle.click();
		await expect
			.poll(async () => (await camera()).type)
			.toBe(orthographic ? "OrthographicCamera" : "PerspectiveCamera");
		const after = await camera();
		expect(visibleHeight(after)).toBeCloseTo(visibleHeight(before), 8);
		for (const key of ["target", "direction", "up"]) {
			for (let axis = 0; axis < 3; axis++)
				expect(after[key][axis]).toBeCloseTo(before[key][axis], 8);
		}
		await expect(toggle).toHaveAttribute("aria-pressed", String(orthographic));
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.locator("canvas").evaluate((canvas) => {
		canvas.parentElement!.parentElement!.style.width = "390px";
	});
	await expect
		.poll(async () => (await toolbar.boundingBox())!.width)
		.toBeLessThan(390);
	const bounds = (await toolbar.boundingBox())!;
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
	for (const button of await toolbar.getByRole("button").all()) {
		const box = (await button.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(bounds.x);
		expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
	}
	if (captureArtifacts) await page.screenshot({
		path: test.info().outputPath("projection-toolbar-mobile.png"),
	});
});
