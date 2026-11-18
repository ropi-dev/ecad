import { z } from "zod";

export const TELEMETRY_BATCH_LIMIT = 50;
export const TELEMETRY_PROPERTY_LIMIT = 400;

export const telemetryEvents = ["perf_operation", "perf_summary"] as const;

export const telemetryKeyPattern = /^phc_[A-Za-z0-9]{16,64}$/;

const STRING_PROPERTIES = new Set([
	"distinct_id",
	"metric",
	"status",
	"platform",
	"app_version",
	"$lib",
	"$os",
	"$browser",
	"gpu_vendor",
]);
const STRING_VALUE = /^[A-Za-z0-9._+~-]{1,64}$/;
const SHARED_PROPERTIES = new Set([
	...STRING_PROPERTIES,
	"$process_person_profile",
	"$geoip_disable",
	"$browser_version",
	"cpu_cores",
	"device_memory_gb",
	"device_pixel_ratio",
	"duration_ms",
	"window_ms",
]);
const DATA_PROPERTY = /^data\.[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const SUMMARY_PROPERTY = /^(.+)\.(?:count|errors|p50|p95|p99|max)$/;

const METRIC_AREAS = [
	"app",
	"browser",
	"circuit",
	"display",
	"drawing",
	"editor",
	"footprint",
	"footprint-library",
	"import",
	"navigation",
	"pcb",
	"project",
	"renderer",
	"schematic",
	"symbol",
	"symbol-library",
	"ui",
];
export const telemetryMetricPattern = new RegExp(
	`^(?:${METRIC_AREAS.join("|")})(?:\\.[a-z0-9-]+)+$`,
);

function knownProperty(key: string, value: unknown) {
	if (typeof value === "string")
		return (
			STRING_PROPERTIES.has(key) &&
			STRING_VALUE.test(value) &&
			(key !== "metric" || telemetryMetricPattern.test(value))
		);
	if (SHARED_PROPERTIES.has(key) || DATA_PROPERTY.test(key)) return true;
	const metric = SUMMARY_PROPERTY.exec(key)?.[1];
	return metric !== undefined && telemetryMetricPattern.test(metric);
}

const propertyValue = z.union([z.number(), z.boolean(), z.string()]);

export const telemetryEventSchema = z.strictObject({
	event: z.enum(telemetryEvents),
	timestamp: z.iso.datetime(),
	properties: z
		.record(z.string().max(96), propertyValue)
		.refine(
			(properties) =>
				Object.keys(properties).length <= TELEMETRY_PROPERTY_LIMIT,
			"Too many properties.",
		)
		.refine(
			(properties) => typeof properties.distinct_id === "string",
			"Events need a distinct_id.",
		)
		.refine(
			(properties) =>
				Object.entries(properties).every(([key, value]) =>
					knownProperty(key, value),
				),
			"Events can hold only known properties, with short identifiers as text.",
		),
});

export const telemetryBatchSchema = z.strictObject({
	api_key: z.string().regex(telemetryKeyPattern),
	batch: z.array(telemetryEventSchema).min(1).max(TELEMETRY_BATCH_LIMIT),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;
export type TelemetryProperties = TelemetryEvent["properties"];
