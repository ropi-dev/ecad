import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createSerialQueue } from "@ecad/core/lib/serial-queue.ts";
import {
	type AppSettings,
	defaultAppSettings,
	parseAppSettings,
	SETTINGS_FILE_LIMIT,
	serializeAppSettings,
} from "@ecad/core/settings/schema.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { LoadedDesktopSettings } from "#/bridge.ts";
import { configPaths } from "#/main/config-directory.ts";

export class DesktopSettings {
	readonly path: string;
	private readonly sequential = createSerialQueue();

	constructor(homeDirectory?: string) {
		this.path = join(configPaths(homeDirectory).directory, "settings.json");
	}

	load(): Promise<LoadedDesktopSettings> {
		return this.sequential(async () => {
			try {
				const metadata = await stat(this.path);
				if (!metadata.isFile())
					throw new Error("The settings path is not a file.");
				if (metadata.size > SETTINGS_FILE_LIMIT)
					throw new Error("The settings file must be 1 MB or smaller.");
				return {
					path: this.path,
					settings: parseAppSettings(await readFile(this.path, "utf8")),
				};
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code === "ENOENT")
					return { path: this.path, settings: defaultAppSettings() };
				return {
					path: this.path,
					settings: defaultAppSettings(),
					error: errorMessage(cause, "The settings file is invalid."),
				};
			}
		});
	}

	save(settings: AppSettings): Promise<void> {
		return this.sequential(async () => {
			const contents = serializeAppSettings(settings);
			await mkdir(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
				await rename(temporary, this.path);
			} finally {
				await rm(temporary, { force: true });
			}
		});
	}
}
