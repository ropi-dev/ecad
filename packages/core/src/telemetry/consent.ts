import { useSyncExternalStore } from "react";
import { z } from "zod";

export const TELEMETRY_CONSENT_KEY = "ecad.telemetry.v1";

export const telemetryConsentSchema = z.strictObject({
	enabled: z.boolean(),
	revision: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

export type TelemetryConsent = z.infer<typeof telemetryConsentSchema>;

export interface ConsentStorage {
	load(): TelemetryConsent | undefined;
	save(consent: TelemetryConsent): Promise<void>;
	subscribe?(listener: () => void): () => void;
}

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export function parseTelemetryConsent(text: string | null) {
	if (text === null) return undefined;
	try {
		const result = telemetryConsentSchema.safeParse(JSON.parse(text));
		return result.success ? result.data : undefined;
	} catch {
		return undefined;
	}
}

export function createBrowserConsentStorage(
	storage?: BrowserStorage,
): ConsentStorage {
	const target = (): BrowserStorage | undefined =>
		storage ?? globalThis.localStorage;
	return {
		load() {
			try {
				return parseTelemetryConsent(
					target()?.getItem(TELEMETRY_CONSENT_KEY) ?? null,
				);
			} catch {
				return undefined;
			}
		},
		async save(consent) {
			target()?.setItem(TELEMETRY_CONSENT_KEY, JSON.stringify(consent));
		},
		subscribe(listener) {
			if (storage || typeof window === "undefined") return () => {};
			const onStorage = (event: StorageEvent) => {
				if (event.key === TELEMETRY_CONSENT_KEY || event.key === null)
					listener();
			};
			window.addEventListener("storage", onStorage);
			return () => window.removeEventListener("storage", onStorage);
		},
	};
}

export function newConsentRevision() {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

const listeners = new Set<() => void>();
let storage = createBrowserConsentStorage();
let current: TelemetryConsent | undefined;
let loaded = false;
let stopExternal: (() => void) | undefined;

const notify = () => {
	for (const listener of listeners) listener();
};

function read() {
	current = storage.load();
	loaded = true;
	return current;
}

export function setConsentStorage(next: ConsentStorage) {
	stopExternal?.();
	stopExternal = undefined;
	storage = next;
	read();
	if (listeners.size) watchExternal();
	notify();
}

function watchExternal() {
	stopExternal ??=
		storage.subscribe?.(() => {
			read();
			notify();
		}) ?? (() => {});
}

export const getTelemetryConsent = () => (loaded ? current : read());

export const isCurrentConsent = (revision: string) => {
	const stored = storage.load();
	return stored?.enabled === true && stored.revision === revision;
};

export function subscribeTelemetryConsent(listener: () => void) {
	listeners.add(listener);
	watchExternal();
	return () => {
		listeners.delete(listener);
	};
}

export function setTelemetryEnabled(enabled: boolean) {
	const next = { enabled, revision: newConsentRevision() };
	current = next;
	loaded = true;
	notify();
	return storage.save(next).catch(() => undefined);
}

export function useTelemetryEnabled() {
	return useSyncExternalStore(
		subscribeTelemetryConsent,
		() => getTelemetryConsent()?.enabled === true,
		() => false,
	);
}
