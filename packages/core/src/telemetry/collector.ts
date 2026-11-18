import type { PerformanceSample } from "#/performance/recorder.ts";
import type {
	TelemetryEvent,
	TelemetryProperties,
} from "#/telemetry/schema.ts";

const OPERATIONS =
	/^(?:app\.ready|navigation\.ready|renderer\.initialize|browser\.(?:lcp|first-contentful-paint)|project\.|import\.|drawing\.export|editor\.open-|circuit\.untangle|pcb\.synchronize|symbol-library\.load|footprint\.model-load)/;
const METRIC_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;
const DATA_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const DATA_LIMIT = 8;
const SUMMARY_METRIC_LIMIT = 60;

const BUCKET_BASE = 0.001;
const BUCKET_GROWTH = 1.1;
const BUCKET_COUNT = 220;

const round = (value: number) => Math.round(value * 100) / 100;

const bucketOf = (value: number) =>
	value <= BUCKET_BASE
		? 0
		: Math.min(
				BUCKET_COUNT - 1,
				Math.ceil(Math.log(value / BUCKET_BASE) / Math.log(BUCKET_GROWTH)),
			);

const bucketValue = (index: number) => BUCKET_BASE * BUCKET_GROWTH ** index;

interface Aggregate {
	count: number;
	errors: number;
	max: number;
	buckets: Uint32Array;
}

function percentile(aggregate: Aggregate, fraction: number) {
	const rank = Math.max(1, Math.ceil(aggregate.count * fraction));
	let seen = 0;
	for (let index = 0; index < BUCKET_COUNT; index++) {
		seen += aggregate.buckets[index];
		if (seen >= rank) return Math.min(aggregate.max, bucketValue(index));
	}
	return aggregate.max;
}

export function isTelemetryMetric(name: string) {
	return METRIC_NAME.test(name) && !name.startsWith("react.");
}

export function isTelemetryOperation(name: string) {
	return OPERATIONS.test(name);
}

export function telemetryData(sample: PerformanceSample): TelemetryProperties {
	const properties: TelemetryProperties = {};
	let kept = 0;
	for (const [key, value] of Object.entries(sample.data ?? {})) {
		if (kept >= DATA_LIMIT) break;
		if (!DATA_KEY.test(key)) continue;
		if (typeof value === "boolean") properties[`data.${key}`] = value;
		else if (typeof value === "number" && Number.isFinite(value))
			properties[`data.${key}`] = round(value);
		else continue;
		kept++;
	}
	return properties;
}

export interface TelemetryCollectorOptions {
	now?: () => number;
	operationLimit?: number;
}

export function createTelemetryCollector({
	now = Date.now,
	operationLimit = 50,
}: TelemetryCollectorOptions = {}) {
	let operations: TelemetryEvent[] = [];
	const operationCounts = new Map<string, number>();
	let aggregates = new Map<string, Aggregate>();
	let windowStart = now();
	const stamp = () => new Date(now()).toISOString();

	const aggregate = (sample: PerformanceSample) => {
		let entry = aggregates.get(sample.name);
		if (!entry) {
			if (aggregates.size >= SUMMARY_METRIC_LIMIT) return;
			entry = {
				count: 0,
				errors: 0,
				max: 0,
				buckets: new Uint32Array(BUCKET_COUNT),
			};
			aggregates.set(sample.name, entry);
		}
		entry.count++;
		if (sample.status === "error") entry.errors++;
		entry.max = Math.max(entry.max, sample.duration);
		entry.buckets[bucketOf(sample.duration)]++;
	};

	return {
		receive(sample: PerformanceSample) {
			if (
				!isTelemetryMetric(sample.name) ||
				!Number.isFinite(sample.duration) ||
				sample.duration < 0
			)
				return;
			aggregate(sample);
			if (!isTelemetryOperation(sample.name)) return;
			const sent = operationCounts.get(sample.name) ?? 0;
			if (sent >= operationLimit) return;
			operationCounts.set(sample.name, sent + 1);
			operations.push({
				event: "perf_operation",
				timestamp: stamp(),
				properties: {
					metric: sample.name,
					duration_ms: round(sample.duration),
					status: sample.status,
					...telemetryData(sample),
				},
			});
		},
		takeOperations(): TelemetryEvent[] {
			const taken = operations;
			operations = [];
			return taken;
		},
		takeSummary(): TelemetryEvent | undefined {
			const taken = aggregates;
			const start = windowStart;
			aggregates = new Map();
			windowStart = now();
			if (!taken.size) return undefined;
			const properties: TelemetryProperties = {
				window_ms: Math.max(0, Math.round(windowStart - start)),
			};
			for (const name of [...taken.keys()].sort()) {
				const entry = taken.get(name);
				if (!entry) continue;
				properties[`${name}.count`] = entry.count;
				if (entry.errors) properties[`${name}.errors`] = entry.errors;
				properties[`${name}.p50`] = round(percentile(entry, 0.5));
				properties[`${name}.p95`] = round(percentile(entry, 0.95));
				properties[`${name}.p99`] = round(percentile(entry, 0.99));
				properties[`${name}.max`] = round(entry.max);
			}
			return { event: "perf_summary", timestamp: stamp(), properties };
		},
		get pendingOperations() {
			return operations.length;
		},
	};
}

export type TelemetryCollector = ReturnType<typeof createTelemetryCollector>;
