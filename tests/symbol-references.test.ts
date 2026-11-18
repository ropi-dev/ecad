import assert from "node:assert/strict";
import { test } from "node:test";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type EditorSymbol,
	editShapeAttribute,
	pinTerminals,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolReferenceKey } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import {
	parseSymbolFile,
	type SymbolFile,
} from "#/components/editor/symbolFormat.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import {
	builtinSymbolFiles,
	createSymbol,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { ProjectRepository } from "#/projects/repository.ts";
import {
	type ConfiguredSymbolLibrary,
	resolveSymbolLibraries,
} from "#/symbol-library/config.ts";
import { memoryDirectory } from "./helpers/project-directory.ts";
import { required } from "./helpers/required.ts";

const reference = { scope: "user", id: "parts" } as const;
const pin: SymbolFile = {
	format: "ecad-symbol",
	version: 1,
	units: "mm",
	id: "point",
	name: "Point",
	description: "",
	prefix: "TP",
	value: "Signal",
	shapes: [{ kind: "pin", name: "Signal", x: -2, y: 0 }],
};
const library = (
	symbols: readonly SymbolFile[],
	id = "parts",
): ConfiguredSymbolLibrary => ({
	id,
	name: id,
	enabled: true,
	source: { kind: "embedded", symbols },
});
const nested: SymbolFile = {
	...pin,
	id: "nested",
	name: "Nested point",
	shapes: [
		{
			kind: "symbol",
			library: reference,
			definitionId: pin.id,
			x: 10,
			y: 5,
			rotation: 90,
		},
	],
};

test("qualified instances resolve the original library after precedence changes", async () => {
	const initial = await resolveSymbolLibraries([library([pin])], []);
	const instance = createSymbol(1, initial.definitions[0], { x: 10, y: 20 });
	const saved = persistDrawingShapes([instance])[0];
	assert.ok(!("children" in saved));
	assert.ok(!("texts" in saved));
	assert.deepEqual((saved as EditorSymbol).library, reference);
	const collision = {
		...pin,
		shapes: [{ kind: "pin" as const, name: "Other", x: 100, y: 100 }],
	};
	const updated = await resolveSymbolLibraries(
		[library([pin]), library([collision], "other")],
		[library([collision])],
	);
	const restored = drawingShapeSchema.parse(saved);
	const result = resolveDrawingSymbols(
		[restored],
		updated.definitions,
		updated.byReference,
	);
	assert.deepEqual(result.errors, []);
	assert.deepEqual(pinTerminals(result.shapes[0]), [{ x: 8, y: 20 }]);
	assert.deepEqual(
		(result.shapes[0] as EditorSymbol).attributes,
		instance.attributes,
	);
});

test("definition edits refresh geometry while preserving instance attributes and stroke overrides", async () => {
	const initial = await resolveSymbolLibraries([library([pin])], []);
	const instance = createSymbol(1, initial.definitions[0], { x: 10, y: 20 });
	instance.attributes.name = "Instance name";
	instance.rotation = Math.PI / 2;
	const overridden = editShapeAttribute(instance, "lineWidth", 0.6);
	const updated = await resolveSymbolLibraries(
		[
			library([
				{ ...pin, shapes: [{ kind: "pin", name: "Updated", x: -4, y: 0 }] },
			]),
		],
		[],
	);
	const result = resolveDrawingSymbols(
		[drawingShapeSchema.parse(persistDrawingShapes([overridden])[0])],
		updated.definitions,
		updated.byReference,
	);
	const restored = result.shapes[0] as EditorSymbol;
	assert.deepEqual(restored.attributes, instance.attributes);
	assert.equal(restored.rotation, instance.rotation);
	assert.equal(restored.children[0].x, -4);
	assert.equal(restored.children[0].lineWidth, 0.6);
	assert.deepEqual(pinTerminals(restored), [{ x: 10, y: 16 }]);
});

test("a built-in placement copied to a project library keeps its labels", async () => {
	const builtin = required(builtinSymbolFiles.get("resistor"));
	const copy = parseSymbolFile(
		JSON.stringify({ ...builtin, id: "resistor-copy" }),
	);
	const instance = createSymbol(
		1,
		required(symbolDefinitions.find((symbol) => symbol.id === "resistor")),
		{ x: 10, y: 20 },
	);
	assert.notDeepEqual(instance.texts, []);
	const resolved = await resolveSymbolLibraries(
		[],
		[
			{
				id: "project-symbols",
				name: "Project symbols",
				enabled: true,
				source: { kind: "embedded", symbols: [copy] },
			},
		],
	);
	const result = resolveDrawingSymbols(
		[
			drawingShapeSchema.parse(
				persistDrawingShapes([
					{
						...instance,
						definitionId: copy.id,
						library: { scope: "project", id: "project-symbols" },
					},
				])[0],
			),
		],
		resolved.definitions,
		resolved.byReference,
	);
	assert.deepEqual(result.errors, []);
	assert.deepEqual((result.shapes[0] as EditorSymbol).texts, instance.texts);
});

test("nested symbol files save references and resolve transforms and terminals recursively", async () => {
	const parsed = parseSymbolFile(JSON.stringify(nested));
	const resolved = await resolveSymbolLibraries([library([pin, parsed])], []);
	assert.deepEqual(resolved.errors, []);
	const definition = required(
		resolved.byReference.get(symbolReferenceKey(reference, nested.id)),
	);
	const instance = createSymbol(1, definition, { x: 20, y: 30 });
	assert.deepEqual(pinTerminals(instance), [{ x: 30, y: 33 }]);
	const editorShapes = symbolFileShapes(parsed, (library, id) =>
		resolved.byReference.get(symbolReferenceKey(library, id)),
	);
	const saved = parseSymbolFile(
		JSON.stringify(symbolFileWithShapes(parsed, editorShapes)),
	);
	assert.equal(saved.shapes[0].kind, "symbol");
	assert.ok(!("children" in saved.shapes[0]));
	assert.ok(!("texts" in saved.shapes[0]));
	assert.ok(!("width" in saved.shapes[0]));
	assert.deepEqual(
		(saved.shapes[0] as (typeof nested.shapes)[0] & { library: unknown })
			.library,
		reference,
	);
	const reopened = await resolveSymbolLibraries([library([pin, saved])], []);
	assert.deepEqual(reopened.errors, []);
	assert.deepEqual(
		required(reopened.byReference.get(symbolReferenceKey(reference, nested.id)))
			.children,
		definition.children,
	);
});

test("missing or disabled libraries retain references without falling back to copied or competing geometry", async () => {
	const initial = await resolveSymbolLibraries([library([pin])], []);
	const instance = createSymbol(1, initial.definitions[0], { x: 10, y: 20 });
	for (const entries of [
		[],
		[{ ...library([pin]), enabled: false }, library([pin], "other")],
	]) {
		const resolved = await resolveSymbolLibraries(entries, []);
		const result = resolveDrawingSymbols(
			[instance],
			resolved.definitions,
			resolved.byReference,
		);
		assert.match(result.errors[0], /point.*parts/);
		const missing = result.shapes[0] as EditorSymbol;
		assert.deepEqual(missing.children, []);
		assert.deepEqual(missing.library, reference);
		assert.ok(!("children" in persistDrawingShapes([missing])[0]));
		const geometry = createShapeGeometry(missing);
		geometry.dispose();
	}
});

test("cyclic and missing nested references report errors without discarding valid definitions", async () => {
	const cycle: SymbolFile = {
		...nested,
		shapes: [
			{
				kind: "symbol",
				library: reference,
				definitionId: "nested",
				x: 0,
				y: 0,
			},
		],
	};
	const cyclic = await resolveSymbolLibraries([library([pin, cycle])], []);
	assert.match(cyclic.errors[0], /"nested"/);
	assert.deepEqual(
		cyclic.definitions.map((definition) => definition.id),
		[pin.id],
	);
	const missing = await resolveSymbolLibraries([library([nested])], []);
	assert.match(missing.errors[0], /point.*parts/);
	assert.deepEqual(missing.definitions, []);
	assert.throws(() =>
		parseSymbolFile(
			JSON.stringify({
				...nested,
				shapes: [{ ...nested.shapes[0], children: pin.shapes }],
			}),
		),
	);
});

for (const layout of ["files", "revisions"] as const)
	test(`project ${layout} storage writes references and reopens them`, async () => {
		const { directory, files: entries } = memoryDirectory("References");
		const resolved = await resolveSymbolLibraries([library([pin, nested])], []);
		const repository = new ProjectRepository(directory, { layout });
		await repository.create("References");
		const symbol = createSymbol(1, resolved.definitions[1], { x: 10, y: 20 });
		const snapshot = await repository.save({
			shapes: [symbol],
			symbols: [nested],
		});
		const drawing = JSON.parse(
			new TextDecoder().decode(
				entries.get(required(snapshot.manifest.drawing)),
			),
		);
		assert.ok(!("children" in drawing.shapes[0]));
		assert.ok(!("texts" in drawing.shapes[0]));
		assert.equal(drawing.shapes[0].definitionId, nested.id);
		const reopened = await new ProjectRepository(directory, { layout }).load();
		assert.deepEqual((reopened.shapes[0] as EditorSymbol).children, []);
		const hydrated = resolveDrawingSymbols(
			reopened.shapes,
			resolved.definitions,
			resolved.byReference,
		);
		assert.deepEqual(pinTerminals(hydrated.shapes[0]), pinTerminals(symbol));
		assert.equal(reopened.symbols[0].shapes[0].kind, "symbol");
	});
