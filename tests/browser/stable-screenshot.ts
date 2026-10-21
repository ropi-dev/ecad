import { expect, type Locator } from "@playwright/test";

// Match Playwright's screenshot assertions by waiting for consecutive frames.
export async function stableScreenshot(capture: () => Promise<Buffer>) {
	let previous = await capture();
	await expect
		.poll(
			async () => {
				const current = await capture();
				const stable = current.equals(previous);
				previous = current;
				return stable;
			},
			{ timeout: 10_000 },
		)
		.toBe(true);
	return previous;
}

// Canvas element screenshots include overlapping DOM controls. Disable their
// composited effects and focus rings so scene comparisons do not depend on them.
export const sceneScreenshotStyle = `
* { backdrop-filter: none !important; box-shadow: none !important; }
canvas { outline: none !important; }
`;

export function canvasScreenshot(canvas: Locator) {
	return stableScreenshot(() => canvas.screenshot({ style: sceneScreenshotStyle }));
}
