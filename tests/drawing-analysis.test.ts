import assert from "node:assert/strict";
import test from "node:test";
import {
	drawShape,
	type EditorShape,
	openPins,
	openWireEnds,
	pinTerminals,
	wireJunctions,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { updateAnalysis } from "#/drawing/drawing-analysis.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { buildWireCrossings } from "#/drawing/wire-crossings.ts";
import { required } from "./helpers/required.ts";

const full = (shapes: EditorShape[]) => {
	const junctions = wireJunctions(shapes);
	return {
		junctions,
		crossings: buildWireCrossings(
			shapes,
			junctions.map(({ point }) => point),
		),
		openEnds: openWireEnds(shapes),
		openPins: openPins(shapes),
	};
};

const normalized = (analysis: ReturnType<typeof full>) => ({
	junctions: analysis.junctions
		.map(({ point, shapes }) =>
			JSON.stringify([point, shapes.map((shape) => shape.id).sort()]),
		)
		.sort(),
	crossings: [...analysis.crossings]
		.map((entry) => JSON.stringify(entry))
		.sort(),
	openEnds: analysis.openEnds
		.map(({ shape, point }) => JSON.stringify([shape.id, point]))
		.sort(),
	openPins: analysis.openPins
		.map(({ shape, point }) => JSON.stringify([shape.id, point]))
		.sort(),
});

function sheet() {
	const resistor = required(
		symbolDefinitions.find((definition) => definition.id === "resistor"),
	);
	const shapes: EditorShape[] = [];
	let id = 1;
	for (let row = 0; row < 8; row++) {
		let previous: EditorShape | undefined;
		for (let column = 0; column < 8; column++) {
			const part = createSymbol(id++, resistor, {
				x: column * 12.7,
				y: row * 7.62,
			});
			shapes.push(part);
			if (previous) {
				const [start] = pinTerminals(previous).slice(1);
				const [end] = pinTerminals(part);
				shapes.push(drawShape(id++, "wire", start, end));
			}
			previous = part;
		}
	}
	for (let column = 0; column < 8; column++) {
		const x = column * 12.7 + 6.35;
		shapes.push(
			drawShape(id++, "wire", { x, y: -3.81 }, { x, y: 7 * 7.62 + 3.81 }),
		);
	}
	shapes.push(
		drawShape(id++, "wire", { x: 6.35, y: 3.81 }, { x: 19.05, y: 3.81 }),
	);
	for (let index = 0; index < 24; index++) {
		const x = 30 + index * 0.635;
		shapes.push(drawShape(id++, "wire", { x, y: 20 }, { x, y: 35 }));
	}
	shapes.push(
		drawShape(id++, "wire", { x: 25, y: 27.94 }, { x: 50, y: 27.94 }),
	);
	return { shapes, next: id };
}

test("an incremental analysis matches a full one after random edits", () => {
	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const { shapes: initial, next } = sheet();
	let nextId = next;
	let shapes = initial;
	let analysis = full(shapes);
	let incremental = 0;
	for (let step = 0; step < 120; step++) {
		const edited = [...shapes];
		const edits = 1 + Math.floor(random() * 6);
		for (let edit = 0; edit < edits; edit++) {
			const index = Math.floor(random() * edited.length);
			const choice = random();
			const dx = Math.round((random() - 0.5) * 8) * 1.27;
			const dy = Math.round((random() - 0.5) * 8) * 1.27;
			if (choice < 0.6)
				edited[index] = {
					...edited[index],
					x: edited[index].x + dx,
					y: edited[index].y + dy,
				};
			else if (choice < 0.8) edited.splice(index, 1);
			else {
				const start = {
					x: Math.round(random() * 80) * 1.27,
					y: Math.round(random() * 40) * 1.27,
				};
				const end =
					random() < 0.5
						? { x: start.x + dx * 4, y: start.y }
						: { x: start.x, y: start.y + dy * 4 };
				if (start.x !== end.x || start.y !== end.y)
					edited.splice(index, 0, drawShape(nextId++, "wire", start, end));
			}
		}
		const updated = updateAnalysis(shapes, analysis, edited);
		const expected = full(edited);
		if (updated) {
			incremental++;
			assert.deepEqual(
				normalized(updated),
				normalized(expected),
				`step ${step}`,
			);
		}
		shapes = edited;
		analysis = updated ?? expected;
	}
	assert.ok(incremental > 100, `${incremental} incremental updates`);
});

test("an incremental analysis sees a pin moved past its symbol's outline", () => {
	const resistor = required(
		symbolDefinitions.find((definition) => definition.id === "resistor"),
	);
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 });
	const pin = required(
		symbol.kind === "symbol"
			? symbol.children.find((child) => child.kind === "pin")
			: undefined,
	);
	const wire = drawShape(2, "wire", { x: 100, y: 0 }, { x: 110, y: 0 });
	const before = [symbol, wire];
	const after = [
		{
			...symbol,
			childOverrides: { [`shape:${pin.id}`]: { x: 100, y: 0 } },
		} as EditorShape,
		wire,
	];
	const updated = required(updateAnalysis(before, full(before), after));
	assert.deepEqual(normalized(updated), normalized(full(after)));
});

test("a group move updates incrementally and matches a full analysis", () => {
	const { shapes } = sheet();
	let analysis = full(shapes);
	let previous = shapes;
	for (let step = 1; step <= 5; step++) {
		const moved = shapes.map((shape, index) =>
			index >= 10 && index < 30
				? { ...shape, x: shape.x + step * 1.27, y: shape.y + step * 1.27 }
				: shape,
		);
		const updated = required(updateAnalysis(previous, analysis, moved));
		assert.deepEqual(
			normalized(updated),
			normalized(full(moved)),
			`step ${step}`,
		);
		previous = moved;
		analysis = updated;
	}
});

test("a new array of the same shapes reuses the analysis", () => {
	const { shapes } = sheet();
	const analysis = full(shapes);
	assert.equal(updateAnalysis(shapes, analysis, [...shapes]), analysis);
	assert.equal(
		updateAnalysis(shapes, analysis, [...shapes].reverse()),
		undefined,
	);
});
