import { expect } from "@playwright/test";

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
