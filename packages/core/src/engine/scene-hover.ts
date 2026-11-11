import {
	BufferAttribute,
	BufferGeometry,
	Color,
	Group,
	type Material,
	Mesh,
	type Object3D,
	Plane,
	type Ray,
	Raycaster,
	Vector3,
} from "three";
import { viewerTheme } from "#/drawing/schematic-theme.ts";
import { hoverLayerColor } from "#/engine/layer-style.ts";
import { copyHoleCut, insideHole } from "#/engine/planar-holes.ts";
import {
	pickPlanarRegion,
	planarRegionPositions,
} from "#/engine/planar-regions.ts";
import type { SceneDisplayEntry } from "#/engine/scene.ts";

export interface SceneHover {
	object: Object3D;
	update: (
		ray: Ray | null,
		pixelSize: number,
		target?: SceneTarget | null,
	) => number;
	getTarget: () => SceneTarget | undefined;
	dispose: () => void;
}

export interface SceneTarget {
	entry: SceneDisplayEntry;
	mesh: Mesh;
	region?: number;
	distance: number;
}

/** Callers can disable picking on an object or a whole subtree independently of visibility. */
function hoverable(object: Object3D): boolean {
	for (let part: Object3D | null = object; part; part = part.parent)
		if (
			(!part.visible && !part.userData.pickWhenHidden) ||
			part.userData.hoverEnabled === false
		)
			return false;
	return true;
}

function materials(mesh: Mesh): Material[] {
	return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Geometry-based picking shared by planar drawings and spatial model parts. */
export function createSceneHover(
	entries: readonly SceneDisplayEntry[],
	mode: "hover" | "selection" = "hover",
): SceneHover {
	const object = new Group();
	object.renderOrder = mode === "selection" ? 1_000_001 : 1_000_000;
	object.userData.hoverHighlight = true;
	const raycaster = new Raycaster();
	const plane = new Plane();
	const normal = new Vector3(0, 0, 1);
	const point = new Vector3();
	const worldScale = new Vector3();
	const surfaces = entries.map((entry) => {
		const meshes: Mesh[] = [];
		entry.object.traverse((part) => {
			if (
				part instanceof Mesh &&
				(!entry.planar || part.userData.planarPart === "fill")
			)
				meshes.push(part);
		});
		return { entry, meshes };
	});
	let selected: SceneTarget | undefined;
	let overlay: Mesh | undefined;
	let ownsGeometry = false;
	const clear = () => {
		if (overlay) {
			if (ownsGeometry) overlay.geometry.dispose();
			for (const material of materials(overlay)) material.dispose();
			overlay.removeFromParent();
		}
		overlay = undefined;
		selected = undefined;
	};
	const syncMaterial = (source: Material, target: Material) => {
		target.copy(source);
		if (
			"color" in source &&
			source.color instanceof Color &&
			"color" in target &&
			target.color instanceof Color
		) {
			target.color.set(hoverLayerColor(`#${source.color.getHexString()}`));
			// White surfaces cannot brighten further, but still need visible feedback.
			if (target.color.equals(source.color))
				target.color.set(viewerTheme.hover);
			if (mode === "selection") target.color.set(viewerTheme.selection);
		}
		if (mode === "selection") {
			target.opacity = Math.max(source.opacity, 0.9);
			// Keep selected model parts bright even on faces turned away from the light.
			if ("emissive" in target && target.emissive instanceof Color)
				target.emissive.set(viewerTheme.selectionGlow);
		}
		target.depthWrite = false;
		target.polygonOffset = true;
		target.polygonOffsetFactor = -1;
		target.polygonOffsetUnits = -1;
		target.stencilWrite = false;
		// Planar layers are composited by order, so the selected shape sits above
		// their fills. Spatial highlights still obey the model's depth buffer.
		if (selected?.region !== undefined) target.depthTest = false;
	};
	return {
		object,
		getTarget: () => selected,
		update(ray, pixelSize, pinned) {
			let target: SceneTarget | undefined = pinned ?? undefined;
			if (
				target &&
				(!hoverable(target.mesh) ||
					!materials(target.mesh).some(
						(material) => material.visible && material.opacity > 0,
					))
			)
				target = undefined;
			if (ray && pinned === undefined) {
				raycaster.ray.copy(ray);
				for (const { entry, meshes } of surfaces) {
					if (!hoverable(entry.object)) continue;
					entry.object.updateWorldMatrix(true, true);
					if (entry.planar) {
						const mesh = meshes[0];
						if (
							!mesh ||
							!hoverable(mesh) ||
							!materials(mesh).some(
								(material) => material.visible && material.opacity > 0,
							)
						)
							continue;
						plane.set(normal, 0).applyMatrix4(entry.object.matrixWorld);
						if (!ray.intersectPlane(plane, point)) continue;
						const distance = point.distanceTo(ray.origin);
						entry.object.worldToLocal(point);
						if (insideHole(mesh, point.x, point.y)) continue;
						entry.object.getWorldScale(worldScale);
						const tolerance =
							(pixelSize * 3) /
							Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), 1e-12);
						const region = pickPlanarRegion(entry.planar, point, tolerance);
						if (
							region !== undefined &&
							(!target || distance <= target.distance)
						)
							target = { entry, mesh, region, distance };
					} else {
						const hits = raycaster.intersectObjects(
							meshes.filter(hoverable),
							false,
						);
						const hit = hits.find((hit) => {
							const mesh = hit.object as Mesh;
							const material = Array.isArray(mesh.material)
								? mesh.material[hit.face?.materialIndex ?? 0]
								: mesh.material;
							return material?.visible && material.opacity > 0;
						});
						if (hit && (!target || hit.distance <= target.distance))
							target = {
								entry,
								mesh: hit.object as Mesh,
								distance: hit.distance,
							};
					}
				}
			}
			if (
				target?.mesh !== selected?.mesh ||
				target?.region !== selected?.region
			) {
				clear();
				if (target) {
					selected = target;
					let geometry = target.mesh.geometry;
					ownsGeometry = target.region !== undefined;
					if (target.region !== undefined && target.entry.planar) {
						geometry = new BufferGeometry();
						geometry.setAttribute(
							"position",
							new BufferAttribute(
								planarRegionPositions(target.entry.planar, target.region),
								3,
							),
						);
					}
					overlay = new Mesh(
						geometry,
						Array.isArray(target.mesh.material)
							? target.mesh.material.map((material) => material.clone())
							: target.mesh.material.clone(),
					);
					overlay.matrixAutoUpdate = false;
					object.add(overlay);
				}
			}
			if (!selected || !overlay) return 0;
			const originals = materials(selected.mesh);
			materials(overlay).forEach((material, index) => {
				syncMaterial(originals[index], material);
				copyHoleCut(originals[index], material);
			});
			overlay.matrix.copy(
				selected.region !== undefined
					? selected.entry.object.matrixWorld
					: selected.mesh.matrixWorld,
			);
			overlay.matrixWorldNeedsUpdate = true;
			return 1;
		},
		dispose() {
			clear();
			object.removeFromParent();
		},
	};
}
