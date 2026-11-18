import assert from "node:assert/strict";
import { test } from "node:test";
import type { PerformanceSample } from "#/performance/recorder.ts";
import { createTelemetryCollector } from "#/telemetry/collector.ts";
import {
	createBrowserConsentStorage,
	getTelemetryConsent,
	isCurrentConsent,
	setConsentStorage,
	setTelemetryEnabled,
	TELEMETRY_CONSENT_KEY,
} from "#/telemetry/consent.ts";
import { browser, gpuVendor, operatingSystem } from "#/telemetry/device.ts";
import { telemetryBatchSchema } from "#/telemetry/schema.ts";

const sample = (
	name: string,
	duration: number,
	data?: PerformanceSample["data"],
	status: PerformanceSample["status"] = "ok",
): PerformanceSample => ({ name, duration, startTime: 0, status, data });

test("operations become events with only numeric and boolean data", () => {
	const collector = createTelemetryCollector({ now: () => 1_700_000_000_000 });
	collector.receive(
		sample("project.open", 41.237, {
			shapes: 663,
			cached: false,
			name: "Customer board",
			path: "/home/someone/secret",
			"bad key": 1,
			ratio: Number.NaN,
		}),
	);
	collector.receive(sample("renderer.frame", 12));
	const [event, ...rest] = collector.takeOperations();
	assert.equal(rest.length, 0);
	assert.deepEqual(event, {
		event: "perf_operation",
		timestamp: "2023-11-14T22:13:20.000Z",
		properties: {
			metric: "project.open",
			duration_ms: 41.237,
			status: "ok",
			"data.shapes": 663,
			"data.cached": false,
		},
	});
	assert.deepEqual(collector.takeOperations(), []);
});

test("each operation name sends a limited number of events per session", () => {
	const collector = createTelemetryCollector({ operationLimit: 3 });
	for (let index = 0; index < 10; index++)
		collector.receive(sample("project.save", index));
	assert.equal(collector.takeOperations().length, 3);
	collector.receive(sample("project.save", 1));
	assert.equal(collector.takeOperations().length, 0);
	const summary = collector.takeSummary();
	assert.equal(summary?.properties["project.save.count"], 11);
});

test("collected events pass the batch schema the desktop app enforces", () => {
	const collector = createTelemetryCollector();
	for (let index = 0; index < 80; index++)
		collector.receive(sample(`editor.metric-${index}`, index));
	collector.receive(sample("app.ready", 900));
	const events = [
		...collector.takeOperations(),
		...[collector.takeSummary()].filter((event) => event !== undefined),
	].map((event) => ({
		...event,
		properties: { distinct_id: "session", ...event.properties },
	}));
	const result = telemetryBatchSchema.safeParse({
		api_key: "phc_0123456789abcdefABCDEF",
		batch: events,
	});
	assert.ok(result.success, result.error?.message);
	assert.equal(
		telemetryBatchSchema.safeParse({
			api_key: "phc_0123456789abcdefABCDEF",
			batch: [{ ...events[0], event: "$pageview" }],
		}).success,
		false,
	);
	for (const properties of [
		{ metric: "app.ready" },
		{ ...events[0].properties, file: "drawings/board.ecaddraw" },
		{ ...events[0].properties, metric: "drawings/board.ecaddraw" },
		{ ...events[0].properties, $os: "Customer board" },
		{ ...events[0].properties, metric: "board.ecaddraw" },
		{ ...events[0].properties, "board.ecaddraw.p95": 1 },
	])
		assert.equal(
			telemetryBatchSchema.safeParse({
				api_key: "phc_0123456789abcdefABCDEF",
				batch: [{ ...events[0], properties }],
			}).success,
			false,
			JSON.stringify(properties),
		);
});

test("device details are reduced to coarse categories", () => {
	assert.equal(
		gpuVendor("ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0)"),
		"nvidia",
	);
	assert.equal(gpuVendor("ANGLE (AMD, AMD Radeon RX 6800 XT)"), "amd");
	assert.equal(gpuVendor("Mesa Intel(R) UHD Graphics 620 (KBL GT2)"), "intel");
	assert.equal(gpuVendor("Apple M2 Pro"), "apple");
	assert.equal(
		gpuVendor("ANGLE (Google, Vulkan 1.3.0 (SwiftShader))"),
		"software",
	);
	assert.equal(gpuVendor(""), "unknown");
	const chrome =
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	const electron =
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ecad/0.4.0 Chrome/138.0.0.0 Electron/44.1.0 Safari/537.36";
	const safari =
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
	assert.equal(operatingSystem(chrome), "Windows");
	assert.equal(operatingSystem(electron), "Linux");
	assert.equal(operatingSystem(safari), "macOS");
	assert.deepEqual(browser(chrome), ["Chrome", 131]);
	assert.deepEqual(browser(electron), ["Electron", 44]);
	assert.deepEqual(browser(safari), ["Safari", 18]);
});

test("consent is its own record, and a newer revision retires older sessions", async () => {
	const values = new Map<string, string>();
	const shared = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	};
	const storage = createBrowserConsentStorage(shared);
	assert.equal(storage.load(), undefined);
	setConsentStorage(storage);
	assert.equal(getTelemetryConsent(), undefined);

	await setTelemetryEnabled(true);
	const first = getTelemetryConsent();
	assert.equal(first?.enabled, true);
	assert.ok(first && isCurrentConsent(first.revision));
	assert.deepEqual(JSON.parse(values.get(TELEMETRY_CONSENT_KEY) ?? ""), first);

	await setTelemetryEnabled(false);
	assert.ok(first && !isCurrentConsent(first.revision));
	await setTelemetryEnabled(true);
	const second = getTelemetryConsent();
	assert.ok(second && isCurrentConsent(second.revision));
	assert.ok(first && !isCurrentConsent(first.revision));

	assert.ok(second && second.since >= (first?.since ?? 0));

	setConsentStorage({
		load: () => second,
		save: async () => {
			throw new Error("Disk full.");
		},
	});
	await assert.rejects(setTelemetryEnabled(false), /Disk full/);
	assert.equal(getTelemetryConsent(), second);
	setConsentStorage(storage);

	values.set(TELEMETRY_CONSENT_KEY, '{"enabled":true}');
	assert.equal(storage.load(), undefined);
	assert.ok(second && !isCurrentConsent(second.revision));
});
