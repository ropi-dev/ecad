import type {
	Bounds,
	Camera,
	Matrix,
	Point,
	SceneLayer,
} from "#/engine/types.ts";

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
