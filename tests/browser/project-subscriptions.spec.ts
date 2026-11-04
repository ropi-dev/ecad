import { expect, test } from "@playwright/test";

test("status updates leave action, snapshot and editor subscribers alone", async ({
	page,
}) => {
	await page.goto("/tests/browser/project-subscriptions.html");
	await expect(page.locator("#status")).toContainText('"busy":false');
	const read = () =>
		page.evaluate(() => ({
			...(
				window as unknown as {
					projectSubscriptionProbe: { counts: Record<string, number> };
				}
			).projectSubscriptionProbe.counts,
		}));
	const before = await read();
	await page.evaluate(() =>
		(
			window as unknown as {
				projectSubscriptionProbe: { report(key: string, dirty: boolean): void };
			}
		).projectSubscriptionProbe.report("library", true),
	);
	await expect(page.locator("#status")).toContainText(
		'"otherUnsavedEdits":true',
	);
	const after = await read();
	if (!process.env.ECAD_SUBSCRIPTION_BASELINE) {
		expect(after.actions).toBe(before.actions);
		expect(after.editor).toBe(before.editor);
		expect(after.snapshot).toBe(before.snapshot);
	}
	expect(after.status).toBeGreaterThan(before.status);
	console.log(
		JSON.stringify({
			measurement: "status-update-render-counts",
			before,
			after,
		}),
	);
	await page.evaluate(async () =>
		(
			window as unknown as {
				projectSubscriptionProbe: { reload(): Promise<void> };
			}
		).projectSubscriptionProbe.reload(),
	);
	await expect(page.locator("#status")).toContainText('"busy":false');
	const reloaded = await read();
	expect(reloaded.snapshot).toBeGreaterThan(after.snapshot);
	expect(reloaded.editor).toBeGreaterThan(after.editor);
});
