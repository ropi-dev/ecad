import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { CircuitCommandError } from "@ecad/drawing-core/circuit/store.ts";
import {
	MissingSymbolLibraryError,
	synchronizePcb,
} from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import type { SymbolLibraryReference } from "#/drawing/symbol-reference.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

const resistor = symbolDefinitions.find(
	(definition) => definition.id === "resistor",
)!;

const invalidCircuit = (message: string) => (error: unknown) => {
	assert.ok(error instanceof CircuitCommandError);
	assert.ok(error instanceof Error);
	assert.equal(error.reason, "invalid-circuit");
	assert.equal(error.message, message);
	return true;
};

test("duplicate schematic references report the circuit rule instead of raw schema issues", () => {
	const original = createCircuit("Board");
	const shapes = [
		createSymbol(1, resistor, { x: 0, y: 0 }, "R1"),
		createSymbol(2, resistor, { x: 40, y: 0 }, "R1"),
	];
	assert.throws(
		() => synchronizePcb(original, shapes, original, symbolDefinitions),
		invalidCircuit("Duplicate component reference: R1"),
	);
});

test("an oversized schematic value reports the field limit instead of raw schema issues", () => {
	const original = createCircuit("Board");
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const oversized = {
		...symbol,
		attributes: { ...symbol.attributes, value: "x".repeat(201) },
	};
	assert.throws(
		() => synchronizePcb(original, [oversized], original, symbolDefinitions),
		invalidCircuit("Too big: expected string to have <=200 characters"),
	);
});

test("a linked symbol without its library asks for the library", () => {
	const original = createCircuit("Board");
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const linked = synchronizePcb(
		original,
		[symbol],
		original,
		symbolDefinitions,
	);
	assert.throws(
		() =>
			synchronizePcb(
				linked.file,
				[{ ...symbol, children: [] }],
				linked.file,
				symbolDefinitions,
			),
		(error) => {
			assert.ok(error instanceof MissingSymbolLibraryError);
			assert.equal(
				error.message,
				"Load the missing symbol library before saving the linked PCB.",
			);
			return true;
		},
	);
});

test("a part from a library that failed to load is not replaced by a placeholder symbol", () => {
	const original = createCircuit("Board");
	const library = { scope: "project" as const, id: "parts" };
	const component = componentFromSymbol({ ...resistor, library }, []);
	const file = structuredClone(original);
	file.circuit.components = [component];
	assert.equal(component.part.library?.id, "parts");
	const isSymbolUnavailable = (reference: SymbolLibraryReference) =>
		reference.scope === library.scope && reference.id === library.id;
	assert.throws(
		() =>
			synchronizePcb(file, [], original, symbolDefinitions, {
				isSymbolUnavailable,
			}),
		MissingSymbolLibraryError,
	);
	const placed = synchronizePcb(
		file,
		[],
		original,
		[...symbolDefinitions, { ...resistor, library }],
		{ isSymbolUnavailable: () => false },
	);
	const symbol = placed.shapes.find((shape) => shape.kind === "symbol");
	assert.equal(symbol?.kind === "symbol" && symbol.definitionId, "resistor");
	const fallback = synchronizePcb(file, [], original, symbolDefinitions);
	const box = fallback.shapes.find((shape) => shape.kind === "symbol");
	assert.match(
		box?.kind === "symbol" ? box.definitionId : "",
		/^circuit-fallback\./,
	);
});
