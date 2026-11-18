import type { TelemetryBatch } from "#/telemetry/schema.ts";
import { expect, test } from "./seeded-project";

const events = (batches: TelemetryBatch[]) =>
	batches.flatMap((batch) => batch.batch);

test("performance data reaches the ingest proxy only while usage data is on", async ({
	page,
}) => {
	const batches: TelemetryBatch[] = [];
	const referrers: (string | undefined)[] = [];
	await page.route("**/ingest/batch/", async (route) => {
		batches.push(route.request().postDataJSON());
		referrers.push((await route.request().allHeaders()).referer);
		await route.fulfill({ status: 200, body: "{}" });
	});
	await page.evaluate(() =>
		localStorage.setItem(
			"ecad.settings.v1",
			JSON.stringify({ version: 1, antialiasing: "off", telemetry: true }),
		),
	);
	await page.goto("/tests/browser/projects.html");
	await page.waitForFunction(
		() => !document.querySelector('[aria-busy="true"]'),
	);
	const flush = () =>
		page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

	await expect
		.poll(async () => {
			await flush();
			const sent = events(batches);
			return (
				sent.some((event) => event.properties.metric === "app.ready") &&
				sent.some((event) => event.event === "perf_summary")
			);
		})
		.toBe(true);
	const first = events(batches);
	const session = first[0].properties.distinct_id;
	expect(typeof session).toBe("string");
	for (const batch of batches)
		expect(batch.api_key).toBe("phc_browserTestProjectKey");
	for (const event of first)
		expect(event.properties).toMatchObject({
			distinct_id: session,
			$process_person_profile: false,
			$geoip_disable: true,
			platform: "web",
		});
	expect(JSON.stringify(batches)).not.toMatch(/Untitled|seeded/);
	expect(referrers.filter(Boolean)).toEqual([]);

	const settings = page.getByRole("dialog", { name: "Settings" });
	await page
		.getByRole("navigation", { name: "Sidebar shortcuts", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await settings.getByRole("tab", { name: "Usage data" }).click();
	const toggle = settings.getByRole("checkbox", {
		name: "Send performance data",
	});
	await expect(toggle).toBeChecked();
	await toggle.uncheck();
	const disabledAt = await page.evaluate(() => Date.now());
	await flush();
	await toggle.check();

	await expect
		.poll(async () => {
			await flush();
			return events(batches).some(
				(event) => event.properties.distinct_id !== session,
			);
		})
		.toBe(true);
	for (const event of events(batches))
		if (event.properties.distinct_id === session)
			expect(Date.parse(event.timestamp)).toBeLessThanOrEqual(disabledAt);
		else expect(event.properties.metric).not.toBe("app.ready");
	expect(
		await page.evaluate(() =>
			JSON.parse(localStorage.getItem("ecad.settings.v1") ?? "{}"),
		),
	).toMatchObject({ telemetry: true });
});
