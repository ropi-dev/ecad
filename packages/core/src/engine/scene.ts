import {
	type Camera,
	Group,
	type Material,
	Mesh,
	type Object3D,
	type WebGLRenderer,
} from "three";
import type { PlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
	getPlanarGeometry,
} from "#/engine/planar-object.ts";
import { PlanarOutline } from "#/engine/planar-outline.ts";
import type { PlanarObject, SceneLayer } from "#/engine/types.ts";

export type { PlanarObject } from "#/engine/types.ts";
export interface SpatialObject {
	type: "spatial";
	object: Object3D;
}
export type ViewerObject = PlanarObject | SpatialObject;
/** Ordered objects shared by both viewports. Units are millimetres. */
export type ViewerScene = readonly ViewerObject[];
export interface SceneDisplayEntry {
	object: Object3D;
	planar?: PlanarGeometry;
}
export function createPlanarObject(layer: SceneLayer): PlanarObject {
	return { ...layer, type: "planar" };
}

/** Borrows source geometry; each viewport owns its display materials. */
export function createSceneDisplay(source: ViewerScene) {
	const resources: (() => void)[] = [];
	const dispose = () => {
		for (const release of resources.splice(0)) release();
	};
	try {
		const group = new Group();
		const entries: SceneDisplayEntry[] = [];
		const materials = new Map<Material, Material>();
		const cloneMaterial = (material: Material) => {
			let clone = materials.get(material);
			if (!clone) {
				clone = material.clone();
				materials.set(material, clone);
				const owned = clone;
				resources.push(() => owned.dispose());
			}
			return clone;
		};
		for (const [index, entry] of source.entries()) {
			if (entry.type === "spatial") {
				const object = entry.object.clone(true);
				if (object.userData.planarObject) object.renderOrder = index;
				object.traverse((part) => {
					if (part instanceof Mesh)
						part.material = Array.isArray(part.material)
							? part.material.map(cloneMaterial)
							: cloneMaterial(part.material);
				});
				group.add(object);
				entries.push({ object, planar: getPlanarGeometry(entry.object) });
			} else {
				const object = createPlanarObject3D(entry);
				object.renderOrder = index;
				resources.push(() => disposePlanarObject3D(object));
				group.add(object);
				entries.push({ object, planar: getPlanarGeometry(object) });
			}
		}
		let hasOutlines = false;
		group.traverse((part) => {
			if (part instanceof PlanarOutline) hasOutlines = true;
		});
		const update = (renderer: WebGLRenderer, camera: Camera) => {
			if (!hasOutlines) return;
			group.updateWorldMatrix(true, true);
			camera.updateWorldMatrix(true, false);
			group.traverseVisible((part) => {
				if (part instanceof PlanarOutline) part.updateDetail(renderer, camera);
			});
		};
		return { object: group, entries, dispose, update, hasOutlines };
	} catch (error) {
		dispose();
		throw error;
	}
}
