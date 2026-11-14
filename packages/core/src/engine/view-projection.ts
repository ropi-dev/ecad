import { screenToWorld, worldToScreen } from "#/engine/camera.ts";
import type { Camera, Point } from "#/engine/types.ts";

/** A camera turned off the top view. */
export interface ViewProjection {
	/** World millimetres to clip space, as a column-major 4 by 4 matrix. */
	matrix: readonly number[];
	/** Height of the camera, which tells the side of a plane it looks at. */
	eyeZ: number;
}

interface View {
	camera: Camera;
	viewport: { width: number; height: number };
	projection?: ViewProjection;
}

/** Depth of a point in front of the camera, or null at or behind the camera. */
function depthAt(m: readonly number[], point: Point, z: number) {
	const terms = [m[3] * point.x, m[7] * point.y, m[11] * z, m[15]];
	const depth = terms.reduce((sum, term) => sum + term, 0);
	const size = terms.reduce((sum, term) => sum + Math.abs(term), 0);
	return depth > 1e-6 * size ? depth : null;
}

/** The canvas pixel showing a point on the plane at height `z`, or null behind the camera. */
export function screenAt(view: View, point: Point, z = 0): Point | null {
	const { width, height } = view.viewport;
	if (!view.projection) return worldToScreen(point, view.camera, width, height);
	const m = view.projection.matrix;
	const w = depthAt(m, point, z);
	if (w === null) return null;
	return {
		x:
			(((m[0] * point.x + m[4] * point.y + m[8] * z + m[12]) / w + 1) / 2) *
			width,
		y:
			((1 - (m[1] * point.x + m[5] * point.y + m[9] * z + m[13]) / w) / 2) *
			height,
	};
}

/** The point under a canvas pixel on the plane at height `z`, or null when the view misses it. */
export function worldAt(view: View, screen: Point, z = 0): Point | null {
	const { width, height } = view.viewport;
	if (!view.projection)
		return screenToWorld(screen, view.camera, width, height);
	const m = view.projection.matrix;
	const x = (screen.x / width) * 2 - 1;
	const y = 1 - (screen.y / height) * 2;
	const a = m[0] - x * m[3];
	const b = m[4] - x * m[7];
	const c = (m[8] - x * m[11]) * z + m[12] - x * m[15];
	const d = m[1] - y * m[3];
	const e = m[5] - y * m[7];
	const f = (m[9] - y * m[11]) * z + m[13] - y * m[15];
	const determinant = a * e - b * d;
	if (Math.abs(determinant) <= 1e-9 * (Math.abs(a * e) + Math.abs(b * d)))
		return null;
	const point = {
		x: (b * f - c * e) / determinant,
		y: (c * d - a * f) / determinant,
	};
	return depthAt(m, point, z) === null ? null : point;
}
