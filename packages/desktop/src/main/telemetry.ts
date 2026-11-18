import type { AppSettings } from "@ecad/core/settings/schema.ts";
import type { TelemetryBatch } from "@ecad/core/telemetry/schema.ts";

export const POSTHOG_BATCH_URL = "https://eu.i.posthog.com/batch/";

export const withAppVersion = (
	batch: TelemetryBatch,
	version: string,
): TelemetryBatch => ({
	...batch,
	batch: batch.batch.map((event) => ({
		...event,
		properties: { ...event.properties, app_version: version },
	})),
});

export function keepStoredTelemetry(
	next: AppSettings,
	known: boolean | undefined,
	stored: boolean | undefined,
): AppSettings {
	if (next.telemetry !== known) return next;
	const { telemetry: _telemetry, ...rest } = next;
	return stored === undefined ? rest : { ...rest, telemetry: stored };
}

export async function sendTelemetry(
	batch: TelemetryBatch,
	{
		enabled,
		version,
		fetch,
	}: {
		enabled: boolean;
		version: string;
		fetch: (url: string, init: RequestInit) => Promise<Response>;
	},
) {
	if (!enabled) return false;
	try {
		const response = await fetch(POSTHOG_BATCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(withAppVersion(batch, version)),
		});
		return response.ok;
	} catch {
		return false;
	}
}
