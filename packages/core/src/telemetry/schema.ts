import { z } from "zod";

export const TELEMETRY_BATCH_LIMIT = 50;
export const TELEMETRY_PROPERTY_LIMIT = 400;

export const telemetryEvents = ["perf_operation", "perf_summary"] as const;

export const telemetryKeyPattern = /^phc_[A-Za-z0-9]{16,64}$/;

const propertyName = z.string().regex(/^[$a-z][a-z0-9_.-]{0,95}$/i);
const propertyValue = z.union([z.number(), z.boolean(), z.string().max(128)]);

export const telemetryEventSchema = z.strictObject({
	event: z.enum(telemetryEvents),
	timestamp: z.iso.datetime(),
	properties: z
		.record(propertyName, propertyValue)
		.refine(
			(properties) =>
				Object.keys(properties).length <= TELEMETRY_PROPERTY_LIMIT,
			"Too many properties.",
		)
		.refine(
			(properties) => typeof properties.distinct_id === "string",
			"Events need a distinct_id.",
		),
});

export const telemetryBatchSchema = z.strictObject({
	api_key: z.string().regex(telemetryKeyPattern),
	batch: z.array(telemetryEventSchema).min(1).max(TELEMETRY_BATCH_LIMIT),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;
export type TelemetryProperties = TelemetryEvent["properties"];
