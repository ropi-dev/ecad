import assert from "node:assert/strict";
import { test } from "node:test";
import type { TelemetryBatch } from "@ecad/core/telemetry/schema.ts";
import { telemetryChannels } from "#/bridge.ts";
import { parseIpcArguments } from "#/main/ipc.ts";
import {
	keepStoredTelemetry,
	POSTHOG_BATCH_URL,
	sendTelemetry,
} from "#/main/telemetry.ts";

const batch: TelemetryBatch = {
	api_key: "phc_0123456789abcdefABCDEF",
	batch: [
		{
			event: "perf_operation",
			timestamp: "2026-11-18T10:00:00.000Z",
			properties: {
				distinct_id: "session",
				metric: "project.open",
				duration_ms: 12.5,
				app_version: "renderer",
			},
		},
	],
};

test("the main process forwards batches to PostHog EU with its own version", async () => {
	const requests: { url: string; init: RequestInit }[] = [];
	const sent = await sendTelemetry(batch, {
		enabled: true,
		version: "1.2.3",
		fetch: async (url, init) => {
			requests.push({ url, init });
			return new Response("{}");
		},
	});
	assert.equal(sent, true);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, POSTHOG_BATCH_URL);
	assert.match(POSTHOG_BATCH_URL, /^https:\/\/eu\./);
	const body = JSON.parse(String(requests[0].init.body));
	assert.equal(body.api_key, batch.api_key);
	assert.equal(body.batch[0].properties.app_version, "1.2.3");
	assert.equal(body.batch[0].properties.metric, "project.open");
});

test("the main process drops batches while usage data is off and ignores network errors", async () => {
	let calls = 0;
	const fetch = async () => {
		calls++;
		throw new Error("offline");
	};
	assert.equal(
		await sendTelemetry(batch, { enabled: false, version: "1", fetch }),
		false,
	);
	assert.equal(calls, 0);
	assert.equal(
		await sendTelemetry(batch, { enabled: true, version: "1", fetch }),
		false,
	);
	assert.equal(calls, 1);
});

test("a save that leaves usage data alone keeps the stored choice from other windows", () => {
	const stale = {
		version: 1 as const,
		theme: "dark" as const,
		telemetry: true,
	};
	assert.deepEqual(keepStoredTelemetry(stale, true, false), {
		version: 1,
		theme: "dark",
		telemetry: false,
	});
	assert.deepEqual(keepStoredTelemetry(stale, true, undefined), {
		version: 1,
		theme: "dark",
	});
	assert.equal(
		keepStoredTelemetry({ ...stale, telemetry: false }, true, true).telemetry,
		false,
	);
	assert.equal(keepStoredTelemetry(stale, undefined, false).telemetry, true);
});

test("telemetry requests must be PostHog batches of known events", () => {
	assert.deepEqual(parseIpcArguments(telemetryChannels.send, [batch]), [batch]);
	for (const invalid of [
		{ ...batch, api_key: "not-a-key" },
		{ ...batch, host: "https://example.com" },
		{ ...batch, batch: [] },
		{ ...batch, batch: [{ ...batch.batch[0], event: "$identify" }] },
		{
			...batch,
			batch: [
				{
					...batch.batch[0],
					properties: { ...batch.batch[0].properties, shapes: [1, 2] },
				},
			],
		},
		...[
			{ file: "drawings/sample-board.ecaddraw" },
			{ metric: "sample-board.ecaddraw" },
			{ "sample-board.ecaddraw.count": 1 },
			{ "sample-board.ecaddraw": 1 },
		].map((extra) => ({
			...batch,
			batch: [
				{
					...batch.batch[0],
					properties: { ...batch.batch[0].properties, ...extra },
				},
			],
		})),
	])
		assert.throws(
			() => parseIpcArguments(telemetryChannels.send, [invalid]),
			/Invalid telemetry:send request/,
		);
});
