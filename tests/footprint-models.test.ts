import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import { defaultModels } from "@ecad/default-models";
import {
	createBoardFootprint,
	flipBoardFootprint,
} from "@ecad/drawing-core/board/footprints.ts";
import { Group, Mesh, Vector3 } from "three";
import { createModelPlacer, modelMatrix } from "#/engine/footprint-models.ts";
import { footprintFileSchema } from "#/footprint/format.ts";
import { loadBuiltinFootprints } from "#/footprint/library.ts";
import {
	boardModelPlacements,
	footprintModelPlacements,
} from "#/footprint/models.ts";
import { BOARD_COPPER_TOP } from "#/formats/gerber/board-stack.ts";

function modelBounds(url: string) {
	const data = readFileSync(fileURLToPath(url));
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const length = view.getUint32(12, true);
	const json: { accessors: { min?: number[]; max?: number[] }[] } = JSON.parse(
		new TextDecoder().decode(data.subarray(20, 20 + length)),
	);
	const min = [Infinity, Infinity];
	const max = [-Infinity, -Infinity];
	for (const accessor of json.accessors)
		if (accessor.min && accessor.max)
			for (const axis of [0, 1]) {
				min[axis] = Math.min(min[axis], accessor.min[axis]);
				max[axis] = Math.max(max[axis], accessor.max[axis]);
			}
	return { min, max };
}

test("every built-in footprint with pads links a built-in model that sits over them, and a bare mounting hole links none", () => {
	const models = new Map(defaultModels().map((model) => [model.id, model]));
	for (const { file } of generateDefaultFootprints()) {
		if (!file.shapes.some((shape) => "pad" in shape && shape.pad)) {
			assert.equal(file.model, undefined, file.id);
			continue;
		}
		assert.equal(file.model?.library, "builtin", file.id);
		const model = models.get(file.model.id);
		assert.ok(model, `${file.id} names ${file.model.id}`);
		const { min, max } = modelBounds(model.url);
		for (const shape of file.shapes) {
			if (!("pad" in shape) || !shape.pad) continue;
			const pad = `${file.id} pad ${shape.pad.number} at ${shape.x}, ${shape.y}`;
			assert.ok(shape.x >= min[0] - 0.1 && shape.x <= max[0] + 0.1, pad);
			assert.ok(shape.y >= min[1] - 0.1 && shape.y <= max[1] + 0.1, pad);
		}
	}
});

test("a footprint file keeps its model link and accepts only the built-in model library", () => {
	const file = {
		format: "ecad-footprint",
		version: 1,
		units: "mm",
		id: "r-0805",
		name: "R 0805",
		shapes: [],
	};
	assert.equal(footprintFileSchema.parse(file).model, undefined);
	const model = { library: "builtin", id: "r_0805_2012metric" };
	assert.deepEqual(footprintFileSchema.parse({ ...file, model }).model, model);
	assert.equal(
		footprintFileSchema.safeParse({
			...file,
			model: { library: "project", id: "r" },
		}).success,
		false,
	);
	assert.equal(
		footprintFileSchema.safeParse({
			...file,
			model: { ...model, offset: [0, 0, 1] },
		}).success,
		false,
	);
});

test("placed footprints take the model of their built-in or project footprint", async () => {
	const builtin = await loadBuiltinFootprints();
	const source = builtin.byId.get("r_0805_2012metric");
	assert.ok(source);
	const front = createBoardFootprint(
		1,
		{
			reference: { library: "builtin", id: "r_0805_2012metric" },
			name: source.file.name,
			shapes: source.file.shapes,
		},
		{ reference: "R1", value: "10k" },
		{ x: 5, y: -3 },
		{ rotation: Math.PI / 2 },
	);
	const project = flipBoardFootprint(
		createBoardFootprint(
			2,
			{
				reference: { library: "project", id: "custom" },
				name: "Custom",
				shapes: source.file.shapes,
			},
			{ reference: "R2", value: "1k" },
			{ x: -4, y: 2 },
		),
	);
	const unlinked = createBoardFootprint(
		3,
		{
			reference: { library: "project", id: "bare" },
			name: "Bare",
			shapes: source.file.shapes,
		},
		{ reference: "R3", value: "1k" },
		{ x: 0, y: 0 },
	);
	const customModel = { library: "builtin" as const, id: "r_0603_1608metric" };
	assert.deepEqual(
		boardModelPlacements([front, project, unlinked], builtin, [
			{ id: "custom", model: customModel },
			{ id: "bare" },
		]),
		[
			{
				model: { library: "builtin", id: "r_0805_2012metric" },
				x: 5,
				y: -3,
				rotation: Math.PI / 2,
				flipped: false,
			},
			{ model: customModel, x: -4, y: 2, rotation: 0, flipped: true },
		],
	);
	assert.deepEqual(footprintModelPlacements(undefined), []);
	assert.deepEqual(footprintModelPlacements(customModel), [
		{ model: customModel, x: 0, y: 0, rotation: 0, flipped: false },
	]);
});

test("a model turns with its footprint and a flipped one hangs mirrored under the board", () => {
	const model = { library: "builtin" as const, id: "m" };
	const point = (placement: Parameters<typeof modelMatrix>[0]) =>
		new Vector3(1, 0.5, 2).applyMatrix4(modelMatrix(placement));
	const close = (actual: Vector3, expected: [number, number, number]) =>
		assert.deepEqual(
			actual.toArray().map((value) => Math.round(value * 1e6) / 1e6 || 0),
			expected,
		);
	close(point({ model, x: 0, y: 0, rotation: 0, flipped: false }), [
		1,
		0.5,
		2 + BOARD_COPPER_TOP,
	]);
	close(point({ model, x: 10, y: 20, rotation: Math.PI / 2, flipped: false }), [
		9.5,
		21,
		2 + BOARD_COPPER_TOP,
	]);
	close(point({ model, x: 0, y: 0, rotation: 0, flipped: true }), [
		-1,
		0.5,
		-2 - BOARD_COPPER_TOP,
	]);
	const template = new Group().add(new Mesh());
	const place = createModelPlacer();
	const placements = [
		{ model, x: 1, y: 2, rotation: 0, flipped: false },
		{
			model: { ...model, id: "missing" },
			x: 0,
			y: 0,
			rotation: 0,
			flipped: false,
		},
	];
	const templateFor = (placement: (typeof placements)[number]) =>
		placement.model.id === "m" ? template : undefined;
	const placed = place(placements, templateFor);
	const again = place(placements, templateFor);
	assert.notEqual(again, placed);
	assert.equal(placed.object.children.length, 1);
	const placedCopy = placed.object.children[0];
	const copy = placedCopy.children[0] as Mesh;
	assert.equal(copy.geometry, (template.children[0] as Mesh).geometry);
	assert.equal(copy.material, (template.children[0] as Mesh).material);
	const moved = place(
		[{ model, x: 5, y: 2, rotation: 0, flipped: false }],
		() => template,
	);
	assert.deepEqual(moved.object.children, [placedCopy]);
	assert.equal(placedCopy.matrix.elements[12], 5);
	assert.deepEqual(place([], () => template).object.children, []);
});
