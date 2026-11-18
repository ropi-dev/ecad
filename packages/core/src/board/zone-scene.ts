import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	BufferAttribute,
	BufferGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
} from "three";
import type { BoardFill } from "#/board/fill.ts";

const focusedFillOpacity = 0.6;

/** Zone fills for the flat view, drawn under the items of their layer. */
export function createZoneScene() {
	const group = new Group();
	group.name = "zone fills";
	let shown: readonly BoardFill[] = [];
	const meshes = new Map<BoardFill, Mesh<BufferGeometry, MeshBasicMaterial>>();
	const build = (fill: BoardFill, color: string) => {
		const geometry = new BufferGeometry();
		const { triangles } = fill;
		const positions = new Float32Array((triangles.length / 2) * 3);
		for (let index = 0; index < triangles.length / 2; index++) {
			positions[index * 3] = triangles[index * 2];
			positions[index * 3 + 1] = triangles[index * 2 + 1];
		}
		geometry.setAttribute("position", new BufferAttribute(positions, 3));
		const material = new MeshBasicMaterial({
			color,
			depthTest: false,
			depthWrite: false,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = `zone fill ${fill.shapeId}`;
		mesh.matrixAutoUpdate = false;
		return mesh;
	};
	return {
		update(
			root: Object3D,
			fills: readonly BoardFill[],
			colors: Readonly<Record<FootprintLayer, string>>,
			order: (layer: FootprintLayer) => number,
			hidden: ReadonlySet<FootprintLayer>,
			focused: boolean,
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
				const { material } = mesh;
				if (material.transparent !== focused) {
					material.transparent = focused;
					material.opacity = focused ? focusedFillOpacity : 1;
					material.needsUpdate = true;
				}
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
