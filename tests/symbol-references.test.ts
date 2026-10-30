import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSymbolFile, type SymbolFile } from "#/components/editor/symbolFormat.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import { editShapeAttribute, type EditorSymbol, pinTerminals } from "#/drawing/shapes.ts";
import { symbolFileShapes, symbolFileWithShapes } from "#/drawing/symbol-file.ts";
import { persistDrawingShapes, persistProjectDrawingShapes, resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";
import { createSymbol } from "#/drawing/symbols.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { ProjectRepository, type ProjectDirectory } from "#/projects/repository.ts";
import { type ConfiguredSymbolLibrary, resolveSymbolLibraries } from "#/symbol-library/config.ts";

const reference = { scope: "user", id: "parts" } as const;
const pin: SymbolFile = {
	format: "ecad-symbol", version: 1, units: "mm", id: "point", name: "Point",
	description: "", prefix: "TP", value: "Signal", shapes: [{ kind: "pin", name: "Signal", x: -2, y: 0 }],
};
const library = (symbols: readonly SymbolFile[], id = "parts"): ConfiguredSymbolLibrary => ({
	id, name: id, enabled: true, source: { kind: "embedded", symbols },
});
const nested: SymbolFile = {
	...pin, id: "nested", name: "Nested point", shapes: [
		{ kind: "symbol", library: reference, definitionId: pin.id, x: 10, y: 5, rotation: 90 },
	],
};

test("qualified instances resolve the original library after precedence changes", async () => {
	const initial = await resolveSymbolLibraries([library([pin])], []);
	const instance = createSymbol(1, initial.definitions[0], { x: 10, y: 20 });
	const saved = persistDrawingShapes([instance])[0];
	assert.ok(!("children" in saved));
	assert.ok(!("texts" in saved));
	assert.deepEqual((saved as EditorSymbol).library, reference);
	const collision = { ...pin, shapes: [{ kind: "pin" as const, name: "Other", x: 100, y: 100 }] };
	const updated = await resolveSymbolLibraries([library([pin]), library([collision], "other")], [library([collision])]);
	const restored = drawingShapeSchema.parse(saved);
	const result = resolveDrawingSymbols([restored], updated.definitions, updated.byReference);
	assert.deepEqual(result.errors, []);
	assert.deepEqual(pinTerminals(result.shapes[0]), [{ x: 8, y: 20 }]);
	assert.deepEqual((result.shapes[0] as EditorSymbol).attributes, instance.attributes);
});

test("definition edits refresh geometry while preserving instance attributes and stroke overrides", async () => {
	const initial = await resolveSymbolLibraries([library([pin])], []);
	const instance = createSymbol(1, initial.definitions[0], { x: 10, y: 20 });
	instance.attributes.name = "Instance name";
	instance.rotation = Math.PI / 2;
	const overridden = editShapeAttribute(instance, "lineWidth", 0.6);
	const updated = await resolveSymbolLibraries([library([{ ...pin, shapes: [{ kind: "pin", name: "Updated", x: -4, y: 0 }] }])], []);
	const result = resolveDrawingSymbols([drawingShapeSchema.parse(persistDrawingShapes([overridden])[0])], updated.definitions, updated.byReference);
	const restored = result.shapes[0] as EditorSymbol;
	assert.deepEqual(restored.attributes, instance.attributes);
	assert.equal(restored.rotation, instance.rotation);
	assert.equal(restored.children[0].x, -4);
	assert.equal(restored.children[0].lineWidth, 0.6);
	assert.deepEqual(pinTerminals(restored), [{ x: 10, y: 16 }]);
});

test("nested symbol files save references and resolve transforms and terminals recursively", async () => {
	const parsed = parseSymbolFile(JSON.stringify(nested));
	const resolved = await resolveSymbolLibraries([library([pin, parsed])], []);
	assert.deepEqual(resolved.errors, []);
	const definition = resolved.byReference.get(symbolReferenceKey(reference, nested.id))!;
	const instance = createSymbol(1, definition, { x: 20, y: 30 });
	assert.deepEqual(pinTerminals(instance), [{ x: 30, y: 33 }]);
	const editorShapes = symbolFileShapes(parsed, (library, id) => resolved.byReference.get(symbolReferenceKey(library, id)));
	const saved = parseSymbolFile(JSON.stringify(symbolFileWithShapes(parsed, editorShapes)));
	assert.equal(saved.shapes[0].kind, "symbol");
	assert.ok(!("children" in saved.shapes[0]));
	assert.ok(!("texts" in saved.shapes[0]));
	assert.ok(!("width" in saved.shapes[0]));
	assert.deepEqual((saved.shapes[0] as typeof nested.shapes[0] & { library: unknown }).library, reference);
	const reopened = await resolveSymbolLibraries([library([pin, saved])], []);
	assert.deepEqual(reopened.errors, []);
	assert.deepEqual(reopened.byReference.get(symbolReferenceKey(reference, nested.id))!.children, definition.children);
});

test("missing or disabled libraries retain references without falling back to copied or competing geometry", async () => {
	const initial = await resolveSymbolLibraries([library([pin])], []);
	const instance = createSymbol(1, initial.definitions[0], { x: 10, y: 20 });
	for (const entries of [[], [{ ...library([pin]), enabled: false }, library([pin], "other")]]) {
		const resolved = await resolveSymbolLibraries(entries, []);
		const result = resolveDrawingSymbols([instance], resolved.definitions, resolved.byReference);
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
	const cycle: SymbolFile = { ...nested, shapes: [{ kind: "symbol", library: reference, definitionId: "nested", x: 0, y: 0 }] };
	const cyclic = await resolveSymbolLibraries([library([pin, cycle])], []);
	assert.match(cyclic.errors[0], /Circular symbol reference/);
	assert.deepEqual(cyclic.definitions.map(definition => definition.id), [pin.id]);
	const missing = await resolveSymbolLibraries([library([nested])], []);
	assert.match(missing.errors[0], /point.*parts/);
	assert.deepEqual(missing.definitions, []);
	assert.throws(() => parseSymbolFile(JSON.stringify({ ...nested, shapes: [{ ...nested.shapes[0], children: pin.shapes }] })));
});

for (const layout of ["files", "revisions"] as const) test(`project ${layout} storage writes references and reopens them`, async () => {
	const entries = new Map<string, Uint8Array>();
	const directory: ProjectDirectory = {
		name: "References",
		async read(path) { const value = entries.get(path); if (!value) throw new DOMException("Missing", "NotFoundError"); return value; },
		async write(path, bytes) { entries.set(path, bytes); },
		async remove(path) { for (const key of entries.keys()) if (key === path || key.startsWith(`${path}/`)) entries.delete(key); },
	};
	const resolved = await resolveSymbolLibraries([library([pin, nested])], []);
	const repository = new ProjectRepository(directory, { layout });
	await repository.create("References");
	const symbol = createSymbol(1, resolved.definitions[1], { x: 10, y: 20 });
	const snapshot = await repository.save({ shapes: [symbol], symbols: [nested] });
	const drawing = JSON.parse(new TextDecoder().decode(entries.get(snapshot.manifest.drawing)));
	assert.ok(!("children" in drawing.shapes[0]));
	assert.ok(!("texts" in drawing.shapes[0]));
	assert.equal(drawing.shapes[0].definitionId, nested.id);
	const reopened = await new ProjectRepository(directory, { layout }).load();
	assert.deepEqual((reopened.shapes[0] as EditorSymbol).children, []);
	const hydrated = resolveDrawingSymbols(reopened.shapes, resolved.definitions, resolved.byReference);
	assert.deepEqual(pinTerminals(hydrated.shapes[0]), pinTerminals(symbol));
	assert.equal(reopened.symbols[0].shapes[0].kind, "symbol");
});

test("legacy inline symbols stay readable when their original library is unavailable", async () => {
	const resolved = await resolveSymbolLibraries([library([pin])], []);
	const instance = createSymbol(1, { ...resolved.definitions[0], library: undefined }, { x: 10, y: 20 });
	const legacy = drawingShapeSchema.parse(instance);
	assert.deepEqual(resolveDrawingSymbols([legacy], [], new Map()).shapes, [instance]);
	assert.deepEqual(persistDrawingShapes([instance]), [instance]);
});

test("saving legacy project instances removes geometry and preserves a uniform stroke edit", async () => {
 const resolved = await resolveSymbolLibraries([library([pin])], []);
 const instance = createSymbol(1, { ...resolved.definitions[0], library: undefined }, { x: 10, y: 20 });
 instance.lineWidth = 0.6;
 instance.children = instance.children.map(child => ({ ...child, lineWidth: 0.6 }));
 const saved = persistProjectDrawingShapes({ shapes: [instance], symbols: [pin] })[0];
 assert.ok(!("children" in saved));
 assert.deepEqual((saved as EditorSymbol).library, { scope: "project", id: "project-symbols" });
 assert.equal((saved as EditorSymbol).strokeOverride, 0.6);
});

test("reference depth stays bounded when child definitions are already cached", async () => {
 const chain: SymbolFile[] = [pin];
 for (let index = 1; index <= 33; index++) chain.push({ ...pin, id: `level-${index}`, shapes: [{ kind: "symbol", library: reference, definitionId: chain[index - 1].id, x: 0, y: 0 }] });
 const result = await resolveSymbolLibraries([library(chain)], []);
 assert.match(result.errors.join("\n"), /at most 32 levels/);
 assert.equal(result.byReference.has(symbolReferenceKey(reference, "level-33")), false);
});

test("legacy net-symbol label edits survive reference-only save, migration, and resolution", async () => {
 const { symbolDefinitions } = await import("#/drawing/symbols.ts");
 const { symbolTextShapes, normalizeNetSymbol } = await import("#/drawing/shapes.ts");
 const definition = symbolDefinitions.find(definition => definition.id === "vdd")!;
 const legacy = {
  ...createSymbol(1, { ...definition, netSymbol: false }, { x: 0, y: 0 }),
  netSymbol: true,
  textPositions: { value: { x: 12, y: 34 } },
  textAlignments: { value: { horizontalAlign: "right" as const, verticalAlign: "bottom" as const } },
  childOverrides: { "attribute:value": { fontSize: 3, rotation: 0.5 } },
 };
 for (const value of ["VDD", ""]) {
  const saved = persistDrawingShapes([{ ...legacy, attributes: { name: "VDD", reference: "PWR1", value } }])[0];
  assert.ok(!("texts" in saved));
  const parsed = drawingShapeSchema.parse(JSON.parse(JSON.stringify(saved)));
  assert.equal(parsed.kind, "symbol");
  if (parsed.kind !== "symbol") continue;
  const resolved = resolveDrawingSymbols([parsed], [definition], new Map([[symbolReferenceKey(definition.library!, definition.id), definition]]));
  assert.deepEqual(resolved.errors, []);
  const symbol = resolved.shapes[0] as EditorSymbol;
  const [label] = symbolTextShapes(symbol);
  assert.equal(label.text, "VDD");
  assert.equal(label.x, 12);
  assert.equal(label.y, 34);
  assert.equal(label.fontSize, 3);
  assert.equal(label.rotation, 0.5);
  assert.equal(label.horizontalAlign, "right");
  assert.equal(label.verticalAlign, "bottom");
  assert.deepEqual(normalizeNetSymbol(symbol), symbol);
 }
});

test("legacy supply instances retain their value labels until explicitly converted", async () => {
 const { symbolDefinitions } = await import("#/drawing/symbols.ts");
 const { symbolTextShapes } = await import("#/drawing/shapes.ts");
 const definition = symbolDefinitions.find(definition => definition.id === "power-3v3")!;
 const legacy = createSymbol(1, { ...definition, netSymbol: false }, { x: 0, y: 0 });
 delete legacy.netSymbol;
 legacy.attributes.value = "+1V8";
 legacy.textPositions = { value: { x: 12, y: 34 } };
 const parsed = drawingShapeSchema.parse(JSON.parse(JSON.stringify(persistDrawingShapes([legacy])[0])));
 const result = resolveDrawingSymbols([parsed], [definition], new Map([[symbolReferenceKey(definition.library!, definition.id), definition]]));
 assert.deepEqual(result.errors, []);
 const restored = result.shapes[0] as EditorSymbol;
 assert.equal(restored.netSymbol, undefined);
 assert.deepEqual(restored.attributes, legacy.attributes);
 assert.deepEqual(symbolTextShapes(restored).map(label => label.text), [legacy.attributes.reference, "+1V8"]);
 assert.equal(symbolTextShapes(restored)[1].x, 12);
 assert.equal(symbolTextShapes(restored)[1].y, 34);
});
