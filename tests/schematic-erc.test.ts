import assert from "node:assert/strict";
import { test } from "node:test";
import { drawShape } from "@ecad/drawing-core/drawing/shape-geometry.ts";
import {
	pinTerminals,
	routeWire,
} from "@ecad/drawing-core/drawing/terminals.ts";
import { runErc } from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";
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
