import { expect, test } from "@playwright/test";

test("diagnostics capture browser stalls, export reports, and bound storage", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects-startup.html?perf=1");
	await page.waitForFunction(
		() =>
			window.__ecadPerformance?.snapshot().metrics["app.ready"]?.count === 1,
	);
	await page.evaluate(() => {
		const api = window.__ecadPerformance!;
		api.appReady();
		for (let index = 0; index < 2000; index++)
			api.record("fixture.work", index);
	});
	const bounded = await page.evaluate(() =>
		window.__ecadPerformance!.snapshot(),
	);
	expect(bounded.events).toHaveLength(512);
	expect(bounded.metrics["fixture.work"].count).toBe(2000);
	expect(bounded.metrics["fixture.work"].sampleCount).toBe(120);
	expect(bounded.metrics["app.ready"].count).toBe(1);
	await page.evaluate(() => window.__ecadPerformance!.reset());
	await page.waitForTimeout(300);
	await page.evaluate(() => {
		setTimeout(() => {
			const start = performance.now();
			while (performance.now() - start < 350) Math.sqrt(performance.now());
		}, 0);
	});
	await expect
		.poll(async () =>
			page.evaluate(
				() =>
					window.__ecadPerformance!.snapshot().metrics["browser.long-task"]
						?.max ?? 0,
			),
		)
		.toBeGreaterThanOrEqual(300);
	await expect
		.poll(async () =>
			page.evaluate(
				() =>
					window.__ecadPerformance!.snapshot().metrics[
						"browser.event-loop-delay"
					]?.max ?? 0,
			),
		)
		.toBeGreaterThan(50);
	const exported = await page.evaluate(() =>
		JSON.parse(window.__ecadPerformance!.export()),
	);
	expect(exported.version).toBe(1);
	expect(exported.environment.supportedEntryTypes).toContain("longtask");
	expect(exported.metrics["fixture.work"]).toBeUndefined();
	await page.evaluate(() => window.__ecadPerformance!.stop());
	const stopped = await page.evaluate(
		() =>
			window.__ecadPerformance!.snapshot().metrics["browser.event-loop-delay"]
				.count,
	);
	await page.waitForTimeout(500);
	expect(
		await page.evaluate(
			() =>
				window.__ecadPerformance!.snapshot().metrics["browser.event-loop-delay"]
					.count,
		),
	).toBe(stopped);
});

test("diagnostics can be disabled without changing project startup", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects-startup.html?perf=0");
	await expect(
		page.getByRole("heading", { name: "Large project", exact: true }),
	).toBeVisible();
	expect(await page.evaluate(() => window.__ecadPerformance)).toBeUndefined();
});
