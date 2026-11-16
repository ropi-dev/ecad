import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshStandardMaterial,
} from "three";
import { triangulate } from "#/engine/geometry.ts";
import { REALISTIC_COLORS } from "#/engine/realistic-board.ts";
import type { MultiPolygon } from "#/engine/types.ts";
import {
	BOARD_MASK_TOP,
	BOARD_SUBSTRATE_TOP,
} from "#/formats/gerber/board-stack.ts";

const MASK_OPACITY = 0.86;

function faces(triangles: Float32Array, z: number, positions: number[]) {
	for (let index = 0; index < triangles.length; index += 2)
		positions.push(triangles[index], triangles[index + 1], z);
}

function walls(polygons: MultiPolygon, bottom: number, top: number) {
	const positions: number[] = [];
	for (const polygon of polygons)
		for (const ring of polygon)
			ring.forEach(([ax, ay], index) => {
				const [bx, by] = ring[(index + 1) % ring.length];
				positions.push(
					ax,
					ay,
					bottom,
					bx,
					by,
					bottom,
					bx,
					by,
					top,
					ax,
					ay,
					bottom,
					bx,
					by,
					top,
					ax,
					ay,
					top,
				);
			});
	return positions;
}

function meshGeometry(positions: number[]) {
	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new BufferAttribute(new Float32Array(positions), 3),
	);
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}

export interface RealisticBoard {
	object: Group;
	dispose: () => void;
}

/**
 * The bare laminate and a solder mask sheet on each side, covering the whole
 * outline. Drill holes and mask openings are cut when drawing, with hole masks.
 */
export function createRealisticBoard(outline: MultiPolygon): RealisticBoard {
	const group = new Group();
	group.name = "Realistic board";
	group.userData.realisticBoard = true;
	const top = BOARD_SUBSTRATE_TOP;
	const triangles = triangulate(outline);
	const facePositions: number[] = [];
	faces(triangles, top, facePositions);
	faces(triangles, -top, facePositions);
	const laminateFaces = new Mesh(
		meshGeometry(facePositions),
		new MeshStandardMaterial({
			color: REALISTIC_COLORS.substrateFace,
			roughness: 0.85,
			side: DoubleSide,
		}),
	);
	laminateFaces.userData.realisticPart = "laminate";
	const laminateEdges = new Mesh(
		meshGeometry(walls(outline, -top, top)),
		new MeshStandardMaterial({
			color: REALISTIC_COLORS.substrateEdge,
			roughness: 0.9,
			side: DoubleSide,
		}),
	);
	group.add(laminateFaces, laminateEdges);
	const masks = (["top", "bottom"] as const).map((side) => {
		const positions: number[] = [];
		faces(
			triangles,
			side === "top" ? BOARD_MASK_TOP : -BOARD_MASK_TOP,
			positions,
		);
		const mesh = new Mesh(
			meshGeometry(positions),
			new MeshStandardMaterial({
				color: REALISTIC_COLORS.mask,
				roughness: 0.35,
				metalness: 0.05,
				transparent: true,
				opacity: MASK_OPACITY,
				depthWrite: false,
				side: DoubleSide,
				polygonOffset: true,
				polygonOffsetFactor: -1,
				polygonOffsetUnits: -1,
			}),
		);
		mesh.name = `${side} solder mask`;
		mesh.userData.realisticMask = side;
		return mesh;
	});
	group.add(...masks);
	return {
		object: group,
		dispose: () => {
			for (const mesh of [laminateFaces, laminateEdges, ...masks]) {
				mesh.geometry.dispose();
				mesh.material.dispose();
			}
		},
	};
}
