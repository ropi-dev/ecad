import {
	acquirePerformance,
	getAppPerformance,
} from "#/performance/runtime.ts";
import { createTelemetryCollector } from "#/telemetry/collector.ts";
import {
	getTelemetryConsent,
	isCurrentConsent,
	subscribeTelemetryConsent,
} from "#/telemetry/consent.ts";
import { deviceProperties } from "#/telemetry/device.ts";
import {
	TELEMETRY_BATCH_LIMIT,
	type TelemetryBatch,
	type TelemetryEvent,
	type TelemetryProperties,
	telemetryKeyPattern,
} from "#/telemetry/schema.ts";

const apiKey: string = import.meta.env?.VITE_POSTHOG_KEY ?? "";
const appVersion: string = import.meta.env?.VITE_APP_VERSION ?? "";

export const telemetryAvailable = telemetryKeyPattern.test(apiKey);

const OPERATION_FLUSH_MS = 30_000;
const SUMMARY_MS = 5 * 60_000;
const OPERATION_BATCH = 20;

export type TelemetryTransport = (
	batch: TelemetryBatch,
	revision: string,
) => Promise<unknown>;
export type TelemetryPlatform = "web" | "desktop";

export const webTelemetryTransport: TelemetryTransport = async (
	batch,
	revision,
) => {
	if (!isCurrentConsent(revision)) return;
	await fetch("/ingest/batch/", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(batch),
		credentials: "omit",
		referrerPolicy: "no-referrer",
		keepalive: true,
	});
};

function sessionId() {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function beginSession(
	transport: TelemetryTransport,
	platform: TelemetryPlatform,
	since: number,
	revision: string,
) {
	const release = acquirePerformance();
	const recorder = getAppPerformance();
	if (!recorder) {
		release();
		return () => {};
	}
	const collector = createTelemetryCollector();
	const distinctId = sessionId();
	let shared: TelemetryProperties | undefined;
	const properties = () =>
		(shared ??= {
			distinct_id: distinctId,
			$process_person_profile: false,
			$geoip_disable: true,
			$lib: "ecad",
			platform,
			...(appVersion ? { app_version: appVersion } : {}),
			...deviceProperties(),
		});
	let active = true;
	const send = (events: TelemetryEvent[]) => {
		for (let start = 0; start < events.length; start += TELEMETRY_BATCH_LIMIT)
			void transport(
				{
					api_key: apiKey,
					batch: events
						.slice(start, start + TELEMETRY_BATCH_LIMIT)
						.map((event) => ({
							...event,
							properties: { ...properties(), ...event.properties },
						})),
				},
				revision,
			).catch(() => undefined);
	};
	const flushOperations = () => {
		if (active) send(collector.takeOperations());
	};
	const flushAll = () => {
		if (!active) return;
		const summary = collector.takeSummary();
		send([...collector.takeOperations(), ...(summary ? [summary] : [])]);
	};
	const onVisibility = () => {
		if (document.visibilityState === "hidden") flushAll();
	};
	const unsubscribe = recorder.subscribe((sample) => {
		if (sample.startTime < since) return;
		collector.receive(sample);
		if (collector.pendingOperations >= OPERATION_BATCH) flushOperations();
	});
	const operationTimer = setInterval(flushOperations, OPERATION_FLUSH_MS);
	const summaryTimer = setInterval(flushAll, SUMMARY_MS);
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("pagehide", flushAll);
	return () => {
		active = false;
		unsubscribe();
		clearInterval(operationTimer);
		clearInterval(summaryTimer);
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("pagehide", flushAll);
		release();
	};
}

let stopWatching: (() => void) | undefined;

export function startTelemetry({
	transport = webTelemetryTransport,
	platform = "web",
}: {
	transport?: TelemetryTransport;
	platform?: TelemetryPlatform;
} = {}) {
	if (typeof window === "undefined" || !telemetryAvailable || stopWatching)
		return;
	let stop: (() => void) | undefined;
	let revision: string | undefined;
	const sync = () => {
		const consent = getTelemetryConsent();
		const next = consent?.enabled ? consent.revision : undefined;
		if (next === revision) return;
		stop?.();
		stop = undefined;
		revision = next;
		if (consent && next)
			stop = beginSession(
				transport,
				platform,
				Math.max(0, consent.since - performance.timeOrigin),
				next,
			);
	};
	const unsubscribe = subscribeTelemetryConsent(sync);
	stopWatching = () => {
		unsubscribe();
		stop?.();
		stop = undefined;
		revision = undefined;
		stopWatching = undefined;
	};
	sync();
}

export function stopTelemetry() {
	stopWatching?.();
}
