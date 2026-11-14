import { Matrix4, Plane, Ray, Vector3, Vector4 } from "three";
import { screenToWorld, worldToScreen } from "#/engine/camera.ts";
import type { Camera, Point } from "#/engine/types.ts";

export interface ViewProjection {
	matrix: readonly number[];
	eyeZ: number;
}

export interface ViewMapping {
	toScreen(point: Point, z?: number): Point | null;
	toWorld(screen: Point, z?: number): Point | null;
}

export const MIN_GRAZING_SLOPE = 0.02;

export function viewMapping({
	camera,
	viewport: { width, height },
	projection,
}: {
	camera: Camera;
	viewport: { width: number; height: number };
	projection?: ViewProjection;
}): ViewMapping {
	if (!projection)
		return {
			toScreen: (point) => worldToScreen(point, camera, width, height),
			toWorld: (screen) => screenToWorld(screen, camera, width, height),
		};
	const toClip = new Matrix4().fromArray(projection.matrix);
	const fromClip = toClip.clone().invert();
	const clip = new Vector4();
	const near = new Vector3();
	const far = new Vector3();
	const ray = new Ray();
	const plane = new Plane(new Vector3(0, 0, 1));
	const hit = new Vector3();
	return {
		toScreen: (point, z = 0) => {
			clip.set(point.x, point.y, z, 1).applyMatrix4(toClip);
			return clip.w > 0
				? {
						x: ((clip.x / clip.w + 1) / 2) * width,
						y: ((1 - clip.y / clip.w) / 2) * height,
					}
				: null;
		},
		toWorld: (screen, z = 0) => {
			const x = (screen.x / width) * 2 - 1;
			const y = 1 - (screen.y / height) * 2;
			near.set(x, y, -1).applyMatrix4(fromClip);
			far.set(x, y, 1).applyMatrix4(fromClip);
			ray.set(near, far.sub(near).normalize());
			if (Math.abs(ray.direction.z) < MIN_GRAZING_SLOPE) return null;
			plane.constant = -z;
			return ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y } : null;
		},
	};
}
