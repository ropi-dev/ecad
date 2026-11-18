import assert from "node:assert/strict";
import { test } from "node:test";
import type { TelemetryBatch } from "@ecad/core/telemetry/schema.ts";
import { telemetryChannels } from "#/bridge.ts";
import { parseIpcArguments } from "#/main/ipc.ts";
import { POSTHOG_BATCH_URL, sendTelemetry } from "#/main/telemetry.ts";

const revision = "6f3d2a6e-1c1d-4a59-9d36-0e7d6b1c2f10";
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

const recorder = () => {
	const requests: { url: string; init: RequestInit }[] = [];
	return {
		requests,
		fetch: async (url: string, init: RequestInit) => {
			requests.push({ url, init });
			return new Response("{}");
		},
	};
};

test("the main process forwards batches to PostHog EU with its own version", async () => {
	const { requests, fetch } = recorder();
	const sent = await sendTelemetry(batch, revision, {
		consent: { enabled: true, revision, since: 1 },
		version: "1.2.3",
		fetch,
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

test("batches go out only under the consent that is on disk now", async () => {
	const { requests, fetch } = recorder();
	for (const consent of [
		null,
		{ enabled: false, revision, since: 1 },
		{ enabled: true, revision: "0b6b5a3e-turned-on-again-later", since: 2 },
	])
		assert.equal(
			await sendTelemetry(batch, revision, { consent, version: "1", fetch }),
			false,
		);
	assert.equal(requests.length, 0);
	assert.equal(
		await sendTelemetry(batch, revision, {
			consent: { enabled: true, revision, since: 1 },
			version: "1",
			fetch: async () => {
				throw new Error("offline");
			},
		}),
		false,
	);
});

test("telemetry requests must be PostHog batches of known events", () => {
	assert.deepEqual(
		parseIpcArguments(telemetryChannels.send, [batch, revision]),
		[batch, revision],
	);
	assert.throws(
		() => parseIpcArguments(telemetryChannels.send, [batch]),
		/telemetry:send/,
	);
	assert.throws(
		() =>
			parseIpcArguments(telemetryChannels.saveConsent, [
				{ enabled: true, revision: "../x", since: 1 },
			]),
		/telemetry:save-consent/,
	);
	for (const invalid of [
		{ ...batch, api_key: "not-a-key" },
		{ ...batch, host: "https://example.com" },
		{ ...batch, batch: [] },
		{ ...batch, batch: [{ ...batch.batch[0], event: "$identify" }] },
		...[
			{ shapes: [1, 2] },
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
			() => parseIpcArguments(telemetryChannels.send, [invalid, revision]),
			/telemetry:send/,
		);
});
