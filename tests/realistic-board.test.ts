import assert from "node:assert/strict";
import { test } from "node:test";
import { createPad, createVia } from "@ecad/drawing-core/footprint/shapes.ts";
import type { BufferGeometry, Mesh } from "three";
import { maskOpenings } from "#/board/mask.ts";
import { createHoleMask } from "#/engine/planar-holes.ts";
import {
	boundsPolygon,
	realisticLayerStyle,
	ringGeometry,
} from "#/engine/realistic-board.ts";
import { createRealisticBoard } from "#/engine/realistic-board-mesh.ts";
import {
	BOARD_MASK_TOP,
	boardLayerRole,
} from "#/formats/gerber/board-stack.ts";
import { required } from "./helpers/required.ts";

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

test("the board view's mask openings follow the board's solder mask margin", () => {
	const pad = createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	const width = (margin?: number) => {
		const xs = maskOpenings([pad], margin).top[0].map(([x]) => x);
		return Number((Math.max(...xs) - Math.min(...xs)).toFixed(6));
	};
	assert.equal(width(), Number((pad.width + 0.1).toFixed(6)));
	for (const margin of [0.05, 0, 0.1, -0.05])
		assert.equal(width(margin), Number((pad.width + 2 * margin).toFixed(6)));
	assert.deepEqual(maskOpenings([pad], -pad.width).top, []);
	const through = createPad(2, { x: 0, y: 0 }, "through-hole", "2", "F.Cu");
	const radius = (margin: number) =>
		Math.max(
			...maskOpenings([through], margin).top[0].map(([x, y]) =>
				Math.hypot(x, y),
			),
		);
	assert.ok(Math.abs(radius(-0.05) - (through.width / 2 - 0.05)) < 1e-9);
	assert.deepEqual(maskOpenings([through], -through.width / 2).top, []);
});

test("the realistic board covers its outline with laminate and mask, and leaves holes to its masks", () => {
	const board = createRealisticBoard(
		boundsPolygon({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
	);
	try {
		const meshes = board.object.children as Mesh[];
		const part = (find: (mesh: Mesh) => boolean) =>
			required(meshes.find(find)).geometry;
		const laminate = part((mesh) => mesh.userData.realisticPart === "laminate");
		const top = laminate.boundingBox?.max.z ?? 0;
		assert.ok(Math.abs(faceArea(laminate, top) - 100) < 1e-6);
		for (const [side, z] of [
			["top", BOARD_MASK_TOP],
			["bottom", -BOARD_MASK_TOP],
		] as const)
			assert.ok(
				Math.abs(
					faceArea(
						part((mesh) => mesh.userData.realisticMask === side),
						z,
					) - 100,
				) < 1e-6,
			);
	} finally {
		board.dispose();
	}
});

test("pad openings become a hole mask that cuts the mask sheet only inside them", () => {
	const mask = required(
		createHoleMask([ringGeometry([square(2, 2, 1), square(6, 6, 0.5)])]),
	);
	assert.deepEqual(
		[
			[2, 2],
			[6, 6],
			[4, 4],
			[2, 3.2],
		].map(([x, y]) => mask.contains(x, y)),
		[true, true, false, false],
	);
	mask.dispose();
});
