import type { Camera, Point } from "./types";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

/** Move the drawing by a distance in CSS pixels. */
export function panCamera(camera: Camera, delta: Point): Camera {
	return {
		...camera,
		x: camera.x - delta.x / camera.scale,
		y: camera.y + delta.y / camera.scale,
	};
}

/** Keep the world point under `from` under `to` while changing scale. */
export function gestureCamera(
	camera: Camera,
	from: Point,
	to: Point,
	factor: number,
	width: number,
	height: number,
	baseScale: number,
): Camera {
	if (!Number.isFinite(factor) || factor <= 0) return camera;
	const scale = Math.max(
		baseScale * MIN_ZOOM,
		Math.min(baseScale * MAX_ZOOM, camera.scale * factor),
	);
	return {
		x:
			camera.x +
			(from.x - width / 2) / camera.scale -
			(to.x - width / 2) / scale,
		y:
			camera.y -
			(from.y - height / 2) / camera.scale +
			(to.y - height / 2) / scale,
		scale,
	};
}
