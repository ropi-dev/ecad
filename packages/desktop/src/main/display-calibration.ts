import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DisplayCalibration } from "@ecad/core/components/viewer/displayScale.ts";

const run = promisify(execFile);
export interface DisplayGeometry {
	id: number;
	bounds: { x: number; y: number; width: number; height: number };
	size: { width: number; height: number };
	scaleFactor: number;
	rotation: number;
	nativeOrigin?: { x: number; y: number };
}

export function calibrateDisplay(
	display: DisplayGeometry,
	widthMm: number,
	heightMm: number,
): DisplayCalibration | null {
	if (display.rotation === 90 || display.rotation === 270)
		[widthMm, heightMm] = [heightMm, widthMm];
	const x = (display.size.width * display.scaleFactor) / widthMm;
	const y = (display.size.height * display.scaleFactor) / heightMm;
	if (
		![widthMm, heightMm, x, y].every(Number.isFinite) ||
		Math.min(widthMm, heightMm) < 40 ||
		Math.max(widthMm, heightMm) > 3000 ||
		Math.min(x, y) < 1 ||
		Math.max(x, y) > 40 ||
		Math.abs(x / y - 1) > 0.05
	)
		return null;
	return { pixelsPerMm: (x + y) / 2 };
}

export function xrandrDimensions(output: string, display: DisplayGeometry) {
	const origin = display.nativeOrigin;
	if (!origin) return null;
	const matches = [
		...output.matchAll(
			/^\S+ connected[^\n]*? (\d+)x(\d+)([+-]\d+)([+-]\d+)[^\n]*? (\d+)mm x (\d+)mm\s*$/gm,
		),
	].filter(
		(match) =>
			Number(match[3]) === origin.x &&
			Number(match[4]) === origin.y &&
			Math.abs(Number(match[1]) - display.size.width * display.scaleFactor) <
				2 &&
			Math.abs(Number(match[2]) - display.size.height * display.scaleFactor) <
				2,
	);
	if (matches.length !== 1) return null;
	return [Number(matches[0][5]), Number(matches[0][6])] as const;
}

export function edidDimensions(bytes: Uint8Array) {
	if (
		bytes.length < 128 ||
		![0, 255, 255, 255, 255, 255, 255, 0].every((v, i) => bytes[i] === v) ||
		bytes.slice(0, 128).reduce((sum, value) => sum + value, 0) % 256 !== 0
	)
		return null;
	for (let offset = 54; offset < 126; offset += 18) {
		const d = bytes.slice(offset, offset + 18);
		if (!d[0] && !d[1]) continue;
		const width = d[12] + ((d[14] >> 4) << 8);
		const height = d[13] + ((d[14] & 15) << 8);
		if (width && height) return [width, height] as const;
	}
	return bytes[21] && bytes[22]
		? ([bytes[21] * 10, bytes[22] * 10] as const)
		: null;
}

async function command(file: string, args: string[]) {
	return (await run(file, args, { timeout: 2000, maxBuffer: 256 * 1024 }))
		.stdout;
}

export async function readDisplayCalibration(
	display: DisplayGeometry,
	displayCount: number,
): Promise<DisplayCalibration | null> {
	if (display.id < 0) return null;
	try {
		if (process.platform === "darwin") {
			const output = await command("/usr/bin/osascript", [
				"-l",
				"JavaScript",
				"-e",
				`ObjC.import('CoreGraphics'); var s = $.CGDisplayScreenSize(${display.id}); var b = $.CGDisplayBounds(${display.id}); Math.abs(s.width - b.size.width / 2.835) < 1 && Math.abs(s.height - b.size.height / 2.835) < 1 ? 'null' : JSON.stringify([s.width, s.height]);`,
			]);
			const dimensions = JSON.parse(output);
			if (!dimensions) return null;
			const [width, height] = dimensions;
			return calibrateDisplay(display, width, height);
		}
		if (process.platform === "win32" && displayCount === 1) {
			const output = await command("powershell.exe", [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"@(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBasicDisplayParams | Where-Object Active | ForEach-Object { @{width=$_.MaxHorizontalImageSize*10; height=$_.MaxVerticalImageSize*10} }) | ConvertTo-Json -Compress",
			]);
			const value = JSON.parse(output);
			const monitors = Array.isArray(value) ? value : [value];
			return monitors.length === 1
				? calibrateDisplay(display, monitors[0].width, monitors[0].height)
				: null;
		}
		if (process.platform !== "linux") return null;
		if (process.env.XDG_SESSION_TYPE !== "wayland" && process.env.DISPLAY) {
			try {
				const dimensions = xrandrDimensions(
					await command("xrandr", ["--query"]),
					display,
				);
				if (dimensions) return calibrateDisplay(display, ...dimensions);
			} catch {}
		}
		if (displayCount !== 1) return null;
		const root = "/sys/class/drm";
		const connected: string[] = [];
		for (const entry of await readdir(root)) {
			if (!/^card\d+-/.test(entry)) continue;
			try {
				if (
					(await readFile(join(root, entry, "status"), "utf8")).trim() ===
					"connected"
				)
					connected.push(entry);
			} catch {}
		}
		if (connected.length !== 1) return null;
		const dimensions = edidDimensions(
			await readFile(join(root, connected[0], "edid")),
		);
		return dimensions ? calibrateDisplay(display, ...dimensions) : null;
	} catch {
		return null;
	}
}
