import assert from "node:assert/strict";
import test from "node:test";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { boxBorder, editShapeAttribute, fitBoxToBorder, hitShape, intersectsSelection, replaceSymbolChild, resizeHandles, resizeShape, shapeBounds, symbolChildren, symbolChildWorld, type EditorShape, type EditorSymbol } from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { persistDrawingShapes, resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import { symbolFileShapes, symbolFileWithShapes } from "#/drawing/symbol-file.ts";
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";

const definition = symbolDefinitions.find(({ id }) => id === "box")!;
const asSymbol = (shape: EditorShape): EditorSymbol => {
 if (shape.kind !== "symbol") throw new Error("Expected symbol");
 return shape;
};

function assertFits(symbol: EditorSymbol) {
 const border = boxBorder(symbol)!.shape;
 assert.equal(symbol.width, border.width);
 assert.equal(symbol.height, border.height);
 assert.ok(Math.abs(border.x - border.width / 2) < 1e-9);
 assert.ok(Math.abs(border.y + border.height / 2) < 1e-9);
 const world = symbolChildWorld(symbol, border);
 for (const key of ["minX", "maxX", "minY", "maxY"] as const) assert.ok(Math.abs(shapeBounds(symbol)[key] - shapeBounds(world)[key]) < 1e-9);
 const { selections: [selection] } = buildDrawingDisplay([symbol], new Set([symbol.id]));
 assert.equal(selection.width, border.width);
 assert.equal(selection.height, border.height);
 assert.ok(Math.abs(selection.x - world.x) < 1e-9);
 assert.ok(Math.abs(selection.y - world.y) < 1e-9);
}

test("Box size and selection match its border when placed, edited and rotated", () => {
 for (const rotation of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
  let symbol = { ...createSymbol(1, definition, { x: 20, y: 30 }), rotation };
  assert.equal(symbol.width, 20);
  assert.equal(symbol.height, 12);
  assert.deepEqual(symbolChildren(symbol)[1].shape, { ...definition.children[1], locked: false, x: 1, y: -1, horizontalAlign: "left", verticalAlign: "top" });
  assertFits(symbol);
  symbol = asSymbol(editShapeAttribute(symbol, "width", 36));
  symbol = asSymbol(editShapeAttribute(symbol, "height", 24));
  assert.equal(symbol.x, 20);
  assert.equal(symbol.y, 30);
  assertFits(symbol);
  const border = boxBorder(symbol)!;
  symbol = replaceSymbolChild(symbol, border.key, { ...border.shape, width: 42, height: 28, lineStyle: "dashed", lineWidth: 0.7 });
  assertFits(symbol);
  symbol = asSymbol(editShapeAttribute(symbol, "lineWidth", 0.4));
  assert.equal(boxBorder(symbol)!.shape.lineWidth, 0.4);
  assert.equal(boxBorder(symbol)!.shape.lineStyle, "dashed");
  assertFits(symbol);
 }
});

test("all Box resize handles keep default and edited text anchored to the top-left corner", () => {
 for (const rotation of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
  const initial = { ...createSymbol(1, definition, { x: 20, y: 30 }), rotation };
  const originalText = symbolChildren(initial)[1];
  const edited = replaceSymbolChild(initial, originalText.key, { ...originalText.shape, x: 3, y: -2.5 });
  for (const symbol of [initial, edited]) {
   const text = symbolChildren(symbol)[1].shape;
   const worldText = symbolChildWorld(symbol, text);
   for (const handle of resizeHandles(symbol)) {
    const resized = asSymbol(resizeShape(symbol, handle, { x: 3, y: -2 }));
    assertFits(resized);
    const updatedText = symbolChildren(resized)[1].shape;
    assert.deepEqual(updatedText, text);
    const updatedWorld = symbolChildWorld(resized, updatedText);
    assert.ok(Math.abs(updatedWorld.x - worldText.x - (resized.x - symbol.x)) < 1e-9);
    assert.ok(Math.abs(updatedWorld.y - worldText.y - (resized.y - symbol.y)) < 1e-9);
   }
  }
 }
 const symbol = createSymbol(1, definition, { x: 20, y: 30 });
 assert.equal(hitShape(symbol, { x: 19, y: 31 }, 0), false);
 assert.equal(intersectsSelection(symbol, { minX: 18, maxX: 19, minY: 31, maxY: 32 }), false);
});

test("Box dimensions survive drawing and nested symbol persistence", () => {
 let symbol = asSymbol(editShapeAttribute(createSymbol(1, definition, { x: 20, y: 30 }), "width", 36));
 const handle = resizeHandles(symbol).find(handle => handle.id === "-1,1")!;
 symbol = asSymbol(resizeShape(symbol, handle, { x: -4, y: 3 }));
 const saved = persistDrawingShapes([symbol])[0];
 assert.ok(!("children" in saved));
 const references = new Map([[symbolReferenceKey(definition.library!, definition.id), definition]]);
 const restored = asSymbol(resolveDrawingSymbols([drawingShapeSchema.parse(saved)], [definition], references).shapes[0]);
 assert.equal(restored.width, 40);
 assert.equal(restored.height, 15);
 assert.deepEqual(symbolChildren(restored)[1], symbolChildren(symbol)[1]);
 assert.equal(symbolChildren(restored)[1].shape.x, 1);
 assert.equal(symbolChildren(restored)[1].shape.y, -1);
 assertFits(restored);
 const file = parseSymbolFile(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "box-parent", name: "Box parent", description: "", prefix: "U", value: "", shapes: [] }));
 const nested = symbolFileShapes(parseSymbolFile(JSON.stringify(symbolFileWithShapes(file, [symbol]))), () => definition);
 assertFits(asSymbol(nested[0]));
 assert.equal(nested[0].width, 40);
 assert.deepEqual(symbolChildren(asSymbol(nested[0]))[1], symbolChildren(symbol)[1]);
});

test("older Box instances keep their visible border and text when their bounds are repaired", () => {
 const original = { ...createSymbol(1, definition, { x: 20, y: 30 }), width: 40, height: 24, childOverrides: { "shape:1": { x: 0, y: 0, width: 32, height: 18 } } };
 const world = symbolChildren(original).map(child => symbolChildWorld(original, child.shape));
 const fitted = fitBoxToBorder(original, { preserveChildWorldPositions: true });
 assertFits(fitted);
 assert.deepEqual(symbolChildren(fitted).map(child => symbolChildWorld(fitted, child.shape)), world);
 assert.strictEqual(fitBoxToBorder(fitted), fitted);
});

test("the Box border cannot be selected, moved or resized as a child", async () => {
 const { moveSymbolChild, moveShapes, resizeSymbolChild, canSelectSymbolChild } = await import("#/drawing/shapes.ts");
 for (const rotation of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
  const symbol = { ...createSymbol(1, definition, { x: 20, y: 30 }), rotation };
  const border = boxBorder(symbol)!;
  const before = symbolChildren(symbol);
  const item = symbolChildren(symbol)[0];
  assert.equal(canSelectSymbolChild(symbol, item), false);
  assert.equal(canSelectSymbolChild(symbol, item, true), false);
  const unlocked = { ...symbol, childOverrides: { [border.key]: { locked: false } } };
  assert.equal(canSelectSymbolChild(unlocked, symbolChildren(unlocked)[0], true), false);
  assert.strictEqual(moveSymbolChild(symbol, border.key, { x: 3, y: -4 }, 0, true), symbol);
  assert.strictEqual(resizeSymbolChild(symbol, border.key, resizeHandles(symbol)[0], { x: 3, y: -4 }, 0, true), symbol);
  const moved = asSymbol(moveShapes([symbol], { x: 3, y: -4 }, 0, symbol, [symbol])[0]);
  assert.equal(moved.x, symbol.x + 3);
  assert.equal(moved.y, symbol.y - 4);
  assert.deepEqual(symbolChildren(moved), before);
  const text = symbolChildWorld(symbol, before[1].shape);
  const movedText = symbolChildWorld(moved, symbolChildren(moved)[1].shape);
  assert.ok(Math.abs(movedText.x - text.x - 3) < 1e-9);
  assert.ok(Math.abs(movedText.y - text.y + 4) < 1e-9);
  assertFits(moved);
  const edited = replaceSymbolChild(symbol, border.key, { ...border.shape, x: border.shape.x + 3, y: border.shape.y + 4 });
  assert.ok(Math.abs(edited.x - symbol.x - 3 * Math.cos(rotation) + 4 * Math.sin(rotation)) < 1e-9);
  assert.ok(Math.abs(edited.y - symbol.y - 3 * Math.sin(rotation) - 4 * Math.cos(rotation)) < 1e-9);
  assert.deepEqual(symbolChildren(edited), before);
  assertFits(edited);
 }
 const symbol = createSymbol(1, definition, { x: 20, y: 30 });
 const snapped = asSymbol(moveShapes([symbol], { x: 3, y: 4 }, 5, symbol, [symbol])[0]);
 assert.equal(snapped.x, 25);
 assert.equal(snapped.y, 35);
 assert.deepEqual(symbolChildren(snapped), symbolChildren(symbol));
 const textMoved = moveSymbolChild(symbol, "shape:2", { x: 3, y: 4 });
 assert.equal(textMoved.x, symbol.x);
 assert.equal(textMoved.y, symbol.y);
 assert.deepEqual(boxBorder(textMoved), boxBorder(symbol));
 assert.notDeepEqual(symbolChildren(textMoved)[1], symbolChildren(symbol)[1]);
});

test("Box clicks select text and the outline but pass through the empty interior", () => {
 for (const rotation of [0, Math.PI / 6, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
  let symbol = { ...createSymbol(1, definition, { x: 20, y: 30 }), rotation };
  symbol = asSymbol(editShapeAttribute(symbol, "width", 36));
  symbol = asSymbol(editShapeAttribute(symbol, "height", 24));
  const border = symbolChildWorld(symbol, boxBorder(symbol)!.shape);
  const point = (x: number, y: number) => ({
   x: border.x + x * Math.cos(rotation) - y * Math.sin(rotation),
   y: border.y + x * Math.sin(rotation) + y * Math.cos(rotation),
  });
  assert.equal(hitShape(symbol, point(0, 0), 0.5), false);
  assert.equal(hitShape(symbol, point(8, -6), 0.5), false);
  for (const [x, y] of [[-18, 0], [18, 0], [0, -12], [0, 12], [18, 12]]) {
   assert.equal(hitShape(symbol, point(x, y), 0), true);
  }
  assert.equal(hitShape(symbol, point(18.4, 0), 0.5), true);
  assert.equal(hitShape(symbol, point(17.6, 0), 0.5), true);
  assert.equal(hitShape(symbol, point(18.6, 0), 0.5), false);
  assert.equal(hitShape(symbol, point(17.4, 0), 0.5), false);
  const text = symbolChildWorld(symbol, symbolChildren(symbol)[1].shape);
  const bounds = shapeBounds(text);
  assert.equal(hitShape(symbol, { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, 0), true);
 }
});
