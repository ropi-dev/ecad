import assert from "node:assert/strict";
import { test } from "node:test";
import { moveSymbolChild, replaceSymbolChild, symbolChildren, symbolShapes, symbolTextShapes, pinTerminals } from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { persistDrawingShapes, resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { symbolFileShapes, symbolFileWithShapes } from "#/drawing/symbol-file.ts";

const definition = { ...symbolDefinitions[0], children: symbolDefinitions[0].children.map((child) => ({ ...child, locked: false })) };

test("symbol children use local coordinates and move independently after rotation", () => {
 const symbol = { ...createSymbol(1, definition, { x: 40, y: 60 }), rotation: Math.PI / 2 };
 for (const child of symbolChildren(symbol)) {
  const moved = moveSymbolChild(symbol, child.key, { x: 4, y: 7 });
  const updated = symbolChildren(moved).find((item) => item.key === child.key)!;
  assert.ok(Math.abs(updated.shape.x - child.shape.x - 7) < 1e-9);
  assert.ok(Math.abs(updated.shape.y - child.shape.y + 4) < 1e-9);
  assert.equal(moved.x, symbol.x);
  assert.equal(moved.y, symbol.y);
  assert.deepEqual(symbol.children, moved.children);
  for (const sibling of symbolChildren(symbol).filter((item) => item.key !== child.key)) {
   assert.deepEqual(symbolChildren(moved).find((item) => item.key === sibling.key), sibling);
  }
 }
 const label = symbolChildren(symbol).find((item) => item.key === "attribute:reference")!;
 const centered = replaceSymbolChild(symbol, label.key, { ...label.shape, x: 0, y: 0 });
 assert.equal(symbolTextShapes(centered)[0].x, symbol.x);
 assert.equal(symbolTextShapes(centered)[0].y, symbol.y);
});

test("child customization survives reference-only persistence, nested files, and definition reloads", () => {
 const symbol = createSymbol(1, definition, { x: 10, y: 20 });
 const body = symbolChildren(symbol).find((item) => item.shape.kind === "rectangle")!;
 const edited = replaceSymbolChild(symbol, body.key, { ...body.shape, x: 8, width: 12 });
 const saved = persistDrawingShapes([edited])[0];
 assert.ok(!("children" in saved));
 const parsed = drawingShapeSchema.parse(JSON.parse(JSON.stringify(saved)));
 const restored = resolveDrawingSymbols([parsed], [definition], new Map([[symbolReferenceKey(definition.library!, definition.id), definition]])).shapes[0];
 assert.equal(restored.kind, "symbol");
 if (restored.kind !== "symbol") throw new Error("Expected symbol");
 assert.deepEqual(symbolShapes(restored), symbolShapes(edited));
 assert.deepEqual(pinTerminals(restored), pinTerminals(symbol));
 const file = parseSymbolFile(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "parent", name: "Parent", description: "", prefix: "U", value: "", shapes: [] }));
 const nested = parseSymbolFile(JSON.stringify(symbolFileWithShapes(file, [edited])));
 assert.deepEqual(symbolFileShapes(nested, () => definition)[0], { ...edited, attributes: { ...edited.attributes }, rotation: 0 });
 for (const childOverrides of [{ "shape:1": { x: NaN } }, { "shape:1": { width: -1 } }, { "attribute:reference": { fontSize: 0 } }, { bad: { x: 1 } }]) {
  assert.equal(drawingShapeSchema.safeParse({ ...symbol, childOverrides }).success, false);
 }
});

test("child overrides create undoable commands and invalid edits leave history unchanged", async () => {
 const { Effect, Either } = await import("effect");
 const { createDrawingStore, DrawingStore } = await import("#/commands/drawing-store.ts");
 const { placeShapesEffect, replaceShapesEffect, undoEffect, redoEffect } = await import("#/commands/drawing-commands.ts");
 const symbol = createSymbol(1, definition, { x: 10, y: 20 });
 const store = createDrawingStore();
 const run = <A, E>(program: import("effect").Effect.Effect<A, E, import("#/commands/drawing-store.ts").DrawingStore>) => Effect.runSync(program.pipe(Effect.provideService(DrawingStore, store)));
 run(placeShapesEffect([symbol], "Place symbol"));
 const before = store.getSnapshot();
 const edited = moveSymbolChild(symbol, "shape:2", { x: 10, y: 5 });
 run(replaceShapesEffect([edited], "Move child"));
 assert.equal(store.getSnapshot().history.currentId, before.history.currentId + 1);
 assert.deepEqual(store.getSnapshot().shapes, [edited]);
 run(undoEffect);
 assert.deepEqual(store.getSnapshot().shapes, [symbol]);
 run(redoEffect);
 assert.deepEqual(store.getSnapshot().shapes, [edited]);
 const committed = store.getSnapshot();
 for (const childOverrides of [{ "shape:2": { x: NaN } }, { "shape:2": { height: 0 } }, { bad: { x: 1 } }]) {
  assert.ok(Either.isLeft(run(Effect.either(replaceShapesEffect([{ ...edited, childOverrides: childOverrides as unknown as NonNullable<typeof edited.childOverrides> }], "Invalid child")))));
  assert.strictEqual(store.getSnapshot(), committed);
 }
});
