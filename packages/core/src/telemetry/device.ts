import {
	isSoftwareRenderer,
	webglRenderer,
} from "#/components/viewer/antialiasing.ts";
import type { TelemetryProperties } from "#/telemetry/schema.ts";

const GPU_VENDORS: [RegExp, string][] = [
	[/nvidia|geforce|quadro|rtx/i, "nvidia"],
	[/\bamd\b|radeon/i, "amd"],
	[/intel/i, "intel"],
	[/apple/i, "apple"],
	[/adreno|qualcomm/i, "qualcomm"],
	[/mali|\barm\b/i, "arm"],
	[/powervr|imagination/i, "imagination"],
];

export function gpuVendor(renderer: string) {
	if (!renderer) return "unknown";
	if (isSoftwareRenderer(renderer)) return "software";
	return (
		GPU_VENDORS.find(([pattern]) => pattern.test(renderer))?.[1] ?? "other"
	);
}

export function operatingSystem(userAgent: string) {
	if (/Windows/.test(userAgent)) return "Windows";
	if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
	if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS";
	if (/Android/.test(userAgent)) return "Android";
	if (/CrOS/.test(userAgent)) return "ChromeOS";
	if (/Linux/.test(userAgent)) return "Linux";
	return "other";
}

const BROWSERS: [RegExp, string][] = [
	[/Electron\/(\d+)/, "Electron"],
	[/Edg\/(\d+)/, "Edge"],
	[/Firefox\/(\d+)/, "Firefox"],
	[/Chrome\/(\d+)/, "Chrome"],
	[/Version\/(\d+)[\d.]* .*Safari\//, "Safari"],
];

export function browser(userAgent: string): [string, number | undefined] {
	for (const [pattern, name] of BROWSERS) {
		const match = pattern.exec(userAgent);
		if (match) return [name, Number(match[1])];
	}
	return ["other", undefined];
}

const bucket = (value: number, steps: number[]) =>
	steps.filter((step) => value >= step).at(-1) ?? steps[0];

export function deviceProperties(): TelemetryProperties {
	const userAgent = navigator.userAgent;
	const [name, version] = browser(userAgent);
	const memory = (navigator as Navigator & { deviceMemory?: number })
		.deviceMemory;
	return {
		$os: operatingSystem(userAgent),
		$browser: name,
		...(version === undefined ? {} : { $browser_version: version }),
		cpu_cores: bucket(
			navigator.hardwareConcurrency || 1,
			[1, 2, 4, 6, 8, 12, 16, 24, 32],
		),
		...(memory ? { device_memory_gb: memory } : {}),
		device_pixel_ratio: Math.round(devicePixelRatio * 4) / 4,
		gpu_vendor: gpuVendor(webglRenderer()),
	};
}
