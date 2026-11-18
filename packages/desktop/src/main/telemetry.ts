import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createSerialQueue } from "@ecad/core/lib/serial-queue.ts";
import {
	parseTelemetryConsent,
	type TelemetryConsent,
} from "@ecad/core/telemetry/consent.ts";
import type { TelemetryBatch } from "@ecad/core/telemetry/schema.ts";
import { configPaths } from "#/main/config-directory.ts";

export const POSTHOG_BATCH_URL = "https://eu.i.posthog.com/batch/";
const CONSENT_FILE_LIMIT = 4096;

export class DesktopTelemetryConsent {
	readonly path: string;
	private readonly sequential = createSerialQueue();

	constructor(homeDirectory?: string) {
		this.path = join(configPaths(homeDirectory).directory, "telemetry.json");
	}

	async load(): Promise<TelemetryConsent | null> {
		try {
			const metadata = await stat(this.path);
			if (!metadata.isFile() || metadata.size > CONSENT_FILE_LIMIT) return null;
			return parseTelemetryConsent(await readFile(this.path, "utf8")) ?? null;
		} catch {
			return null;
		}
	}

	save(consent: TelemetryConsent): Promise<void> {
		return this.sequential(async () => {
			await mkdir(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, `${JSON.stringify(consent)}\n`, {
					mode: 0o600,
					flag: "wx",
				});
				await rename(temporary, this.path);
			} finally {
				await rm(temporary, { force: true });
			}
		});
	}
}

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

export async function sendTelemetry(
	batch: TelemetryBatch,
	revision: string,
	{
		consent,
		version,
		fetch,
	}: {
		consent: TelemetryConsent | null;
		version: string;
		fetch: (url: string, init: RequestInit) => Promise<Response>;
	},
) {
	if (!consent?.enabled || consent.revision !== revision) return false;
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
