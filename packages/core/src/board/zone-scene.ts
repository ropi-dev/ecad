import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	BufferAttribute,
	BufferGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
} from "three";
import type { ZoneFill } from "#/board/fill.ts";
import { triangulate } from "#/engine/geometry.ts";

const fillOpacity = 0.6;

/** Zone fills for the flat view, drawn under the items of their layer. */
export function createZoneScene() {
	const group = new Group();
	group.name = "zone fills";
	let shown: readonly ZoneFill[] = [];
	const meshes = new Map<ZoneFill, Mesh<BufferGeometry, MeshBasicMaterial>>();
	const build = (fill: ZoneFill, color: string) => {
		const geometry = new BufferGeometry();
		const triangles = triangulate(fill.polygons);
		const positions = new Float32Array((triangles.length / 2) * 3);
		for (let index = 0; index < triangles.length / 2; index++) {
			positions[index * 3] = triangles[index * 2];
			positions[index * 3 + 1] = triangles[index * 2 + 1];
		}
		geometry.setAttribute("position", new BufferAttribute(positions, 3));
		const material = new MeshBasicMaterial({
			color,
			transparent: true,
			opacity: fillOpacity,
			depthTest: false,
			depthWrite: false,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = `zone fill ${fill.zone.shapeId}`;
		mesh.matrixAutoUpdate = false;
		return mesh;
	};
	return {
		update(
			root: Object3D,
			fills: readonly ZoneFill[],
			colors: Readonly<Record<FootprintLayer, string>>,
			order: (layer: FootprintLayer) => number,
			hidden: ReadonlySet<FootprintLayer>,
		) {
			if (fills !== shown) {
				const kept = new Set(fills);
				for (const [fill, mesh] of meshes)
					if (!kept.has(fill)) {
						mesh.geometry.dispose();
						mesh.material.dispose();
						meshes.delete(fill);
					}
				for (const fill of fills)
					if (!meshes.has(fill))
						meshes.set(fill, build(fill, colors[fill.layer]));
				group.clear();
				for (const fill of fills) {
					const mesh = meshes.get(fill);
					if (mesh) group.add(mesh);
				}
				shown = fills;
			}
			for (const [fill, mesh] of meshes) {
				mesh.visible = !hidden.has(fill.layer);
				mesh.material.color.set(colors[fill.layer]);
				mesh.renderOrder = order(fill.layer);
			}
			if (group.parent !== root) root.add(group);
		},
		dispose() {
			for (const mesh of meshes.values()) {
				mesh.geometry.dispose();
				mesh.material.dispose();
			}
			meshes.clear();
			group.removeFromParent();
		},
	};
}
