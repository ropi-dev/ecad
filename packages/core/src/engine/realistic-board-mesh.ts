import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshStandardMaterial,
} from "three";
import { subtractObstacles } from "#/board/fill.ts";
import { triangulate } from "#/engine/geometry.ts";
import {
	type MaskOpenings,
	REALISTIC_COLORS,
	type Ring,
} from "#/engine/realistic-board.ts";
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

export interface RealisticBoardSource {
	outline: MultiPolygon;
	drills: readonly Ring[];
	openings: MaskOpenings;
}

export interface RealisticBoard {
	object: Group;
	dispose: () => void;
}

/**
 * The bare laminate with its drill holes, and a solder mask sheet on each side
 * with its openings cut out. The mask tents holes outside the openings, as it
 * does over vias.
 */
export function createRealisticBoard({
	outline,
	drills,
	openings,
}: RealisticBoardSource): RealisticBoard {
	const group = new Group();
	group.name = "Realistic board";
	group.userData.realisticBoard = true;
	const laminate = subtractObstacles(outline, [...drills]);
	const top = BOARD_SUBSTRATE_TOP;
	const laminateTriangles = triangulate(laminate);
	const facePositions: number[] = [];
	faces(laminateTriangles, top, facePositions);
	faces(laminateTriangles, -top, facePositions);
	const faceMaterial = new MeshStandardMaterial({
		color: REALISTIC_COLORS.substrateFace,
		roughness: 0.85,
		side: DoubleSide,
	});
	const edgeMaterial = new MeshStandardMaterial({
		color: REALISTIC_COLORS.substrateEdge,
		roughness: 0.9,
		side: DoubleSide,
	});
	const laminateFaces = new Mesh(meshGeometry(facePositions), faceMaterial);
	const laminateEdges = new Mesh(
		meshGeometry(walls(laminate, -top, top)),
		edgeMaterial,
	);
	group.add(laminateFaces, laminateEdges);
	const masks = (["top", "bottom"] as const).map((side) => {
		const sheet = subtractObstacles(outline, [...openings[side]]);
		const positions: number[] = [];
		faces(
			triangulate(sheet),
			side === "top" ? BOARD_MASK_TOP : -BOARD_MASK_TOP,
			positions,
		);
		const material = new MeshStandardMaterial({
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
		});
		const mesh = new Mesh(meshGeometry(positions), material);
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
