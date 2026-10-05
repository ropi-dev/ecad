import type { Bounds, Camera, Matrix, Point, SceneLayer } from "./types";

export function getSceneBounds(
	layers: readonly SceneLayer[],
	visibleOnly = true,
): Bounds {
	const bounds: Bounds = {
		minX: Infinity,
		minY: Infinity,
		maxX: -Infinity,
		maxY: -Infinity,
	};
	for (const layer of layers) {
		if ((visibleOnly && !layer.visible) || !layer.objects.length) continue;
		if (
			![
				layer.bounds.minX,
				layer.bounds.minY,
				layer.bounds.maxX,
				layer.bounds.maxY,
			].every(Number.isFinite)
		)
			continue;
		bounds.minX = Math.min(bounds.minX, layer.bounds.minX);
		bounds.minY = Math.min(bounds.minY, layer.bounds.minY);
		bounds.maxX = Math.max(bounds.maxX, layer.bounds.maxX);
		bounds.maxY = Math.max(bounds.maxY, layer.bounds.maxY);
	}
	return Number.isFinite(bounds.minX)
		? bounds
		: { minX: -25, minY: -20, maxX: 25, maxY: 20 };
}

export function fitCamera(
	bounds: Bounds,
	width: number,
	height: number,
	padding = 64,
): Camera {
	const scale = Math.min(
		Math.max(width - padding * 2, 1) / Math.max(bounds.maxX - bounds.minX, 0.1),
		Math.max(height - padding * 2, 1) /
			Math.max(bounds.maxY - bounds.minY, 0.1),
	);
	return {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
		scale: Math.min(100000, Math.max(0.001, scale)),
	};
}

export function screenToWorld(
	point: Point,
	camera: Camera,
	width: number,
	height: number,
	mirrored = false,
): Point {
	return {
		x: camera.x + ((point.x - width / 2) / camera.scale) * (mirrored ? -1 : 1),
		y: camera.y - (point.y - height / 2) / camera.scale,
	};
}

export function worldToScreen(
	point: Point,
	camera: Camera,
	width: number,
	height: number,
	mirrored = false,
): Point {
	return {
		x: width / 2 + (point.x - camera.x) * camera.scale * (mirrored ? -1 : 1),
		y: height / 2 - (point.y - camera.y) * camera.scale,
	};
}

export function transformPoint(point: Point, matrix?: Matrix): Point {
	if (!matrix) return point;
	const [a, b, c, d, e, f] = matrix;
	return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

export function inverseTransformPoint(
	point: Point,
	matrix?: Matrix,
): Point | null {
	if (!matrix) return point;
	const [a, b, c, d, e, f] = matrix;
	const determinant = a * d - b * c;
	if (Math.abs(determinant) < 1e-15) return null;
	const x = point.x - e;
	const y = point.y - f;
	return { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
}

export function gridSpacing(scale: number): number {
	const desired = 42 / scale;
	const magnitude = 10 ** Math.floor(Math.log10(desired));
	return [1, 2, 5, 10].find((step) => step * magnitude >= desired)! * magnitude;
}

export function parseColor(color: string): [number, number, number, number] {
	const hex = color.replace("#", "");
	if (/^[a-f\d]{6}$/i.test(hex))
		return [0, 2, 4]
			.map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
			.concat(1) as [number, number, number, number];
	if (/^[a-f\d]{3}$/i.test(hex))
		return hex
			.split("")
			.map((digit) => Number.parseInt(digit + digit, 16) / 255)
			.concat(1) as [number, number, number, number];
	return [0.3, 0.85, 0.72, 1];
}
