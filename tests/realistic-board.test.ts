import assert from "node:assert/strict";
import { test } from "node:test";
import { createPad, createVia } from "@ecad/drawing-core/footprint/shapes.ts";
import type { BufferGeometry, Mesh } from "three";
import { maskOpenings } from "#/board/gerber.ts";
import {
	boundsPolygon,
	realisticLayerStyle,
} from "#/engine/realistic-board.ts";
import { createRealisticBoard } from "#/engine/realistic-board-mesh.ts";
import {
	BOARD_MASK_TOP,
	boardLayerRole,
} from "#/formats/gerber/board-stack.ts";

const layer = (name: string, fileFunction: string) => ({
	name,
	metadata: { ".FileFunction": fileFunction.split(",") },
});

const square = (x: number, y: number, half: number): [number, number][] => [
	[x - half, y - half],
	[x + half, y - half],
	[x + half, y + half],
	[x - half, y + half],
];

function faceArea(geometry: BufferGeometry, z: number) {
	const positions = geometry.getAttribute("position").array;
	let area = 0;
	for (let index = 0; index < positions.length; index += 9) {
		if (
			[2, 5, 8].some((offset) => Math.abs(positions[index + offset] - z) > 1e-6)
		)
			continue;
		const [ax, ay, , bx, by, , cx, cy] = positions.slice(index, index + 9);
		area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
	}
	return area;
}

test("the realistic view keeps copper, silkscreen and drills, and hides drawing aids and the mask layer's own fill", () => {
	const shown = (name: string, fileFunction: string) =>
		realisticLayerStyle(boardLayerRole(layer(name, fileFunction)).role).visible;
	assert.deepEqual(
		[
			shown("F.Cu", "Copper,L1,Top"),
			shown("B.SilkS", "Legend,Bot"),
			shown("Drills", "Plated,1,2,PTH"),
			shown("F.Mask", "Soldermask,Top"),
			shown("F.Paste", "Paste,Top"),
			shown("F.Fab", "AssemblyDrawing,Top"),
			shown("F.CrtYd", "Other,Courtyard,Top"),
			shown("F.Cu pad numbers", "Other,PadNumbers,Top"),
			shown("Board edge", "Profile,NP"),
		],
		[true, true, true, false, false, false, false, false, false],
	);
	assert.deepEqual(boardLayerRole(layer("B.Mask", "Soldermask,Bot")), {
		role: "mask",
		side: -1,
	});
});

test("the solder mask opens over pads on its side and tents vias", () => {
	const pad = createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	const through = createPad(2, { x: 5, y: 0 }, "through-hole", "2", "F.Cu");
	const via = createVia(3, { x: 10, y: 0 });
	const openings = maskOpenings([pad, through, via]);
	assert.equal(openings.top.length, 2);
	assert.equal(openings.bottom.length, 1);
	const [x, y] = openings.top[0][0];
	assert.ok(Math.abs(x) <= pad.width / 2 + 0.06);
	assert.ok(Math.abs(y) <= pad.height / 2 + 0.06);
});

test("the realistic board cuts drills through the laminate and openings through each side's mask", () => {
	const board = createRealisticBoard({
		outline: boundsPolygon({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
		drills: [square(5, 5, 0.5)],
		openings: { top: [square(2, 2, 1)], bottom: [] },
	});
	try {
		const meshes = board.object.children as Mesh[];
		const mask = (side: string) =>
			meshes.find((mesh) => mesh.userData.realisticMask === side)?.geometry;
		const [laminate] = meshes;
		const top = laminate.geometry.boundingBox?.max.z ?? 0;
		assert.ok(Math.abs(faceArea(laminate.geometry, top) - 99) < 1e-6);
		assert.ok(
			Math.abs(faceArea(mask("top") as BufferGeometry, BOARD_MASK_TOP) - 96) <
				1e-6,
		);
		assert.ok(
			Math.abs(
				faceArea(mask("bottom") as BufferGeometry, -BOARD_MASK_TOP) - 100,
			) < 1e-6,
		);
	} finally {
		board.dispose();
	}
});
