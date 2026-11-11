import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { useSyncExternalStore } from "react";
import { createSerialQueue } from "#/lib/serial-queue.ts";
import {
	type AppSettings,
	appSettingsSchema,
	defaultAppSettings,
	parseAppSettings,
	serializeAppSettings,
} from "#/settings/schema.ts";

export const SETTINGS_STORAGE_KEY = "ecad.settings.v1";
const LEGACY_ANTIALIAS_KEY = "ecad.antialias";

export interface SettingsStorage {
	location: string;
	load(): AppSettings;
	save(settings: AppSettings): Promise<void>;
	subscribe?(listener: () => void): () => void;
}

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createBrowserSettingsStorage(
	storage?: BrowserStorage,
): SettingsStorage {
	const target = (): BrowserStorage | undefined =>
		storage ?? globalThis.localStorage;
	return {
		location: "in this browser",
		load() {
			let saved: string | null;
			let legacy: string | null;
			try {
				saved = target()?.getItem(SETTINGS_STORAGE_KEY) ?? null;
				legacy = target()?.getItem(LEGACY_ANTIALIAS_KEY) ?? null;
			} catch {
				return defaultAppSettings();
			}
			if (saved !== null) return parseAppSettings(saved);
			return legacy === null
				? defaultAppSettings()
				: { version: 1, antialiasing: legacy === "0" ? "off" : "on" };
		},
		async save(settings) {
			const text = serializeAppSettings(settings);
			try {
				const browser = target();
				if (!browser) throw new Error("No browser storage.");
				browser.setItem(SETTINGS_STORAGE_KEY, text);
				browser.removeItem(LEGACY_ANTIALIAS_KEY);
			} catch (cause) {
				throw new Error(
					"Browser storage is unavailable. Settings last until you reload.",
					{ cause },
				);
			}
		},
		subscribe(listener) {
			if (storage || typeof window === "undefined") return () => {};
			const onStorage = (event: StorageEvent) => {
				if (event.key === SETTINGS_STORAGE_KEY || event.key === null)
					listener();
			};
			window.addEventListener("storage", onStorage);
			return () => window.removeEventListener("storage", onStorage);
		},
	};
}

export interface SettingsStatus {
	location: string;
	error: string;
}

const listeners = new Set<() => void>();
const queue = createSerialQueue();
let storage = createBrowserSettingsStorage();
let current: AppSettings | undefined;
let status: SettingsStatus = { location: storage.location, error: "" };
let stopExternal: (() => void) | undefined;
const serverSettings = defaultAppSettings();
const serverStatus: SettingsStatus = { location: storage.location, error: "" };

const notify = () => {
	for (const listener of listeners) listener();
};

function read() {
	try {
		current = storage.load();
		status = { location: storage.location, error: "" };
	} catch (cause) {
		current = defaultAppSettings();
		status = {
			location: storage.location,
			error: `Saved settings could not be read: ${errorMessage(cause)} The next change replaces them.`,
		};
	}
	return current;
}

function watchExternal() {
	stopExternal ??=
		storage.subscribe?.(() => {
			read();
			notify();
		}) ?? (() => {});
}

export function setSettingsStorage(next: SettingsStorage) {
	stopExternal?.();
	stopExternal = undefined;
	storage = next;
	read();
	if (listeners.size) watchExternal();
	notify();
}

export const getAppSettings = (): AppSettings => current ?? read();

export function getSettingsStatus(): SettingsStatus {
	if (!current) read();
	return status;
}

export function subscribeAppSettings(listener: () => void) {
	listeners.add(listener);
	watchExternal();
	return () => {
		listeners.delete(listener);
	};
}

export function updateAppSettings(
	change: (settings: AppSettings) => AppSettings,
): Promise<void> {
	let next: AppSettings;
	try {
		next = appSettingsSchema.parse(change(getAppSettings()));
	} catch (cause) {
		return Promise.reject(cause);
	}
	current = next;
	notify();
	const saving = storage;
	const report = (error: string) => {
		if (saving !== storage || status.error === error) return;
		status = { ...status, error };
		notify();
	};
	return queue(() => saving.save(next)).then(
		() => report(""),
		(cause) => {
			report(errorMessage(cause, "Unable to save settings."));
			throw cause;
		},
	);
}

export function useAppSettings(): AppSettings {
	return useSyncExternalStore(
		subscribeAppSettings,
		getAppSettings,
		() => serverSettings,
	);
}

export function useSettingsStatus(): SettingsStatus {
	return useSyncExternalStore(
		subscribeAppSettings,
		getSettingsStatus,
		() => serverStatus,
	);
}
