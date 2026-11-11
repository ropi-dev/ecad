import assert from "node:assert/strict";
import { test } from "node:test";
import { drawShape } from "@ecad/drawing-core/drawing/shape-geometry.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	pinTerminals,
	routeWire,
} from "@ecad/drawing-core/drawing/terminals.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import { runErc } from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";
import { schematicErcInput } from "@ecad/drawing-core/erc/schematic.ts";
import { schematicErcRules } from "@ecad/drawing-core/erc/schematic-rules.ts";
import { schematicCircuit } from "#/circuit/linked-schematic.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const resistor = required(
	symbolDefinitions.find((definition) => definition.id === "resistor"),
);

test("schematic ERC reads wires and no-connect markers from the drawing", () => {
	const r1 = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const r2 = createSymbol(2, resistor, { x: 20, y: 0 }, "R2");
	const [r1a, r1b] = pinTerminals(r1);
	const [r2a] = pinTerminals(r2);
	const shapes = [
		r1,
		r2,
		...routeWire(3, required(r1b), required(r2a)),
		drawShape(10, "no-connect", required(r1a), required(r1a)),
	];
	const checked = schematicCircuit(shapes, symbolDefinitions);
	const diagnostics = runErc(checked.circuit, defaultErcRules);
	assert.deepEqual(
		diagnostics.map((item) => item.ruleId),
		["unconnected-pin"],
	);
	const [finding] = diagnostics;
	assert.match(finding.message, /^R2 pin/);
	assert.deepEqual(checked.shapeIds(required(finding.subjects[0])), [2]);

	// A marker on a wired pin is reported, not silently accepted.
	const clash = runErc(
		schematicCircuit(
			[...shapes, drawShape(11, "no-connect", required(r2a), required(r2a))],
			symbolDefinitions,
		).circuit,
		defaultErcRules,
	);
	assert.ok(clash.some((item) => item.ruleId === "connected-no-connect"));
});

const ground = required(
	symbolDefinitions.find((definition) => definition.id === "ground"),
);
const label = (id: number, point: Point, text = "SIG"): EditorShape => ({
	id,
	kind: "text",
	electrical: "net",
	text,
	x: point.x,
	y: point.y,
	width: 5,
	height: 2,
	fontSize: 1.27,
	rotation: 0,
	lineWidth: 0.2,
});
const wire = (id: number, start: Point, end: Point) =>
	routeWire(id, start, end);
function check(shapes: EditorShape[]) {
	const checked = schematicCircuit(shapes, symbolDefinitions);
	return runErc(checked.circuit, schematicErcRules, {
		schematic: schematicErcInput(shapes),
	});
}
const ruleIds = (shapes: EditorShape[]) =>
	check(shapes).map((item) => item.ruleId);

function parallel() {
	const r1 = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const r2 = createSymbol(2, resistor, { x: 0, y: 10 }, "R2");
	const [a1, b1] = pinTerminals(r1).map(required);
	const [a2, b2] = pinTerminals(r2).map(required);
	return {
		r1,
		r2,
		a1,
		b1,
		shapes: [r1, r2, ...wire(3, a1, a2), ...wire(4, b1, b2)] as EditorShape[],
	};
}

test("schematic ERC passes a fully wired drawing", () => {
	assert.deepEqual(check(parallel().shapes), []);
});

test("schematic ERC reports duplicate references instead of failing", () => {
	const { shapes, r1 } = parallel();
	const copy = { ...r1, id: 9, x: 40 };
	const results = check([...shapes, copy]);
	const duplicate = results.find(
		(item) => item.ruleId === "duplicate-reference",
	);
	assert.ok(duplicate);
	assert.equal(duplicate.severity, "error");
	assert.deepEqual(
		duplicate.subjects.map((subject) => subject.id),
		["1", "9"],
	);
	assert.ok(results.some((item) => item.message.startsWith("R1 (2) pin 1 ")));
});

test("schematic ERC groups KiCad units and compares their values and pins", () => {
	const unit = (id: number, number: number, x: number, value = "10k") => {
		const shape = createSymbol(id, resistor, { x, y: 0 }, "U1");
		return {
			...shape,
			kicad: { libraryId: "Device:R_Pack", unit: number },
			attributes: { ...shape.attributes, value },
		};
	};
	assert.ok(
		!ruleIds([unit(1, 1, 0), unit(2, 2, 20)]).includes("duplicate-reference"),
	);
	assert.ok(
		ruleIds([unit(1, 1, 0), unit(2, 1, 20)]).includes("duplicate-reference"),
	);
	assert.ok(
		ruleIds([unit(1, 1, 0), unit(2, 2, 20, "4k7")]).includes(
			"different-unit-value",
		),
	);
	const first = unit(1, 1, 0);
	const second = unit(2, 2, 0);
	const moved = { ...second, y: 20 };
	const [p1] = pinTerminals(first).map(required);
	const [q1] = pinTerminals(moved).map(required);
	const results = check([
		first,
		moved,
		...wire(3, p1, { x: p1.x - 10, y: p1.y }),
		label(5, { x: p1.x - 10, y: p1.y }, "A"),
		...wire(6, q1, { x: q1.x - 10, y: q1.y }),
		label(8, { x: q1.x - 10, y: q1.y }, "B"),
	]);
	const split = results.find((item) => item.ruleId === "duplicate-pin-nets");
	assert.ok(split);
	assert.match(split.message, /^U1 pin 1 is connected to A and B\./);
});

test("schematic ERC reports unannotated symbols with their circuit reference", () => {
	const { shapes, r2 } = parallel();
	const unannotated = {
		...r2,
		attributes: { ...r2.attributes, reference: "R?" },
	};
	const results = check([shapes[0], unannotated, ...shapes.slice(2)]);
	assert.deepEqual(
		results.map((item) => item.ruleId),
		["unannotated-symbol"],
	);
	assert.match(results[0].message, /The circuit numbers it R\d+\./);
});

test("schematic ERC reports symbols missing from their library", () => {
	const { shapes } = parallel();
	const missing = {
		...createSymbol(9, resistor, { x: 40, y: 0 }, "R9"),
		library: { scope: "user" as const, id: "gone" },
		children: [],
		texts: [],
	};
	assert.deepEqual(ruleIds([...shapes, missing]), ["missing-library-symbol"]);
});

test("schematic ERC reports empty supply and label names", () => {
	const { shapes, b1 } = parallel();
	const supply = createSymbol(9, ground, { x: 40, y: 0 });
	const unnamed = {
		...supply,
		attributes: { ...supply.attributes, name: " " },
	};
	assert.ok(ruleIds([...shapes, unnamed]).includes("empty-supply-name"));
	assert.deepEqual(ruleIds([...shapes, label(9, b1, " ")]), [
		"empty-net-label",
	]);
});

test("schematic ERC reports labels and supplies that reach no pins", () => {
	const { shapes, b1 } = parallel();
	const away = { x: 50, y: 50 };
	const dangling = check([...shapes, label(9, away)]);
	assert.deepEqual(
		dangling.map((item) => item.ruleId),
		["unconnected-label"],
	);
	assert.match(dangling[0].message, /not attached to a wire or pin/);
	assert.deepEqual(ruleIds([...shapes, createSymbol(9, ground, away)]), [
		"unconnected-label",
	]);
	const stub = wire(9, away, { x: 60, y: 50 });
	assert.deepEqual(ruleIds([...shapes, ...stub, label(10, away)]), [
		"unconnected-label",
		"unconnected-wire-end",
	]);
	assert.deepEqual(ruleIds([...shapes, label(9, b1)]), []);
});

test("schematic ERC reports floating wires once and open wire ends", () => {
	const { shapes, b1 } = parallel();
	assert.deepEqual(
		ruleIds([...shapes, ...wire(9, { x: 50, y: 50 }, { x: 60, y: 50 })]),
		["floating-wire"],
	);
	const open = check([...shapes, ...wire(9, b1, { x: b1.x + 10, y: b1.y })]);
	assert.deepEqual(
		open.map((item) => item.ruleId),
		["unconnected-wire-end"],
	);
	assert.deepEqual(open[0].subjects, [{ kind: "shape", id: "9" }]);
	const end = { x: b1.x + 10, y: b1.y };
	assert.deepEqual(
		ruleIds([
			...shapes,
			...wire(9, b1, end),
			drawShape(10, "no-connect", end, end),
		]),
		["stray-no-connect"],
	);
});

test("schematic ERC accepts a no-connect marker at the end of a pin's wire stub", () => {
	const lone = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const [a, b] = pinTerminals(lone).map(required);
	const end = { x: a.x - 5, y: a.y };
	assert.deepEqual(
		ruleIds([
			lone,
			...wire(2, a, end),
			drawShape(3, "no-connect", end, end),
			drawShape(4, "no-connect", b, b),
		]),
		[],
	);
});

test("schematic ERC reports no-connect markers away from pins", () => {
	const { shapes, a1 } = parallel();
	const away = { x: 50, y: 50 };
	const results = check([...shapes, drawShape(9, "no-connect", away, away)]);
	assert.deepEqual(
		results.map((item) => item.ruleId),
		["stray-no-connect"],
	);
	assert.match(results[0].message, /not on a pin or wire/);
	const middle = { x: a1.x, y: a1.y + 5 };
	const connected = check([
		...shapes,
		drawShape(9, "no-connect", middle, middle),
	]);
	assert.match(
		required(connected.find((item) => item.ruleId === "stray-no-connect"))
			.message,
		/connects 2 pins/,
	);
});

test("schematic ERC reports a label that joins crossing wires", () => {
	const { shapes } = parallel();
	const centre = { x: 0, y: 20 };
	const crossing = [
		...wire(
			20,
			{ x: centre.x - 5, y: centre.y },
			{ x: centre.x + 5, y: centre.y },
		),
		...wire(
			21,
			{ x: centre.x, y: centre.y - 5 },
			{ x: centre.x, y: centre.y + 5 },
		),
	];
	const results = check([...shapes, ...crossing, label(22, centre)]);
	assert.deepEqual(
		required(results.find((item) => item.ruleId === "label-multiple-wires"))
			.subjects,
		["22", "20", "21"].map((id) => ({ kind: "shape", id })),
	);
});
