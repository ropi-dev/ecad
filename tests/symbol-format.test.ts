import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importSymbolFile, importSymbolFiles, libraryDefinitions, mergeSymbolLibraries, parseSavedSymbolLibrary, parseSymbolFile, SYMBOL_FILE_LIMIT } from "#/components/editor/symbolFormat.ts";
import { createSymbol } from "#/components/editor/symbols.ts";
import { createShapeGeometry } from "#/components/editor/shapeGeometry.ts";
import { hitShape, symbolShapes } from "#/components/editor/shapes.ts";
import { runEffect } from "#/lib/effect.ts";
import { createEmptySymbolFile, symbolFileFromSymbol } from "#/components/editor/symbolFormat.ts";

const example = readFileSync(new URL("../packages/web/public/examples/symbols/test-point.ecadsym", import.meta.url), "utf8");
const source = () => JSON.parse(example);

test("example library imports at its authored size and all geometry remains finite", () => {
 const symbol = parseSymbolFile(example);
 const definitions = libraryDefinitions([symbol, parseSymbolFile(readFileSync(new URL("../packages/web/public/examples/symbols/buffer.ecadsym", import.meta.url), "utf8"))]);
 const testPoint = createSymbol(1, definitions[0], { x: 10, y: 20 });
 assert.equal(testPoint.width, 2);
 assert.equal(testPoint.height, 4.508);
 assert.equal(testPoint.attributes.reference, "TP1");
 assert.equal(testPoint.attributes.value, "Test");
 assert.ok(hitShape(testPoint, { x: 10, y: 18 }, 0.01));
 assert.equal(symbolShapes(testPoint).filter(child => child.kind === "pin").length, 1);
 for (const definition of definitions) {
  const geometry = createShapeGeometry(createSymbol(1, definition, { x: 0, y: 0 }));
  try {
   assert.ok(geometry.getAttribute("position").count > 0);
   assert.ok([...geometry.getAttribute("position").array].every(Number.isFinite));
  } finally { geometry.dispose(); }
 }
});

test("converts every primitive, degrees, and diagonal wires without axis constraints", () => {
 const data = source();
 data.shapes = [
  { kind: "wire", x1: -3, y1: -4, x2: 3, y2: 4 },
  { kind: "rectangle", x: 2, y: 3, width: 4, height: 5, rotation: 90 },
  { kind: "triangle", x: 0, y: 0, width: 2, height: 3 },
  { kind: "circle", x: 0, y: 0, radius: 2 },
  { kind: "pin", x: 3, y: 4 },
 ];
 const definition = libraryDefinitions([parseSymbolFile(JSON.stringify(data))])[0];
 assert.equal(definition.children[0].width, 10);
 assert.equal(definition.children[0].rotation, Math.atan2(8, 6));
 assert.equal(definition.children[1].rotation, Math.PI / 2);
 assert.equal(definition.children[2].rotation, 0);
 assert.equal(definition.children[3].height, 4);
 assert.equal(definition.children[4].width, 0.508);
 const instance = createSymbol(1, definition, { x: 0, y: 0 });
 instance.children[0].width = 99;
 assert.equal(definition.children[0].width, 10);
});

for (const [name, mutate] of [
 ["version", (data: any) => { data.version = 2; }],
 ["units", (data: any) => { data.units = "in"; }],
 ["unsupported primitive", (data: any) => { data.shapes[0].kind = "svg"; }],
 ["negative radius", (data: any) => { data.shapes[0].radius = -1; }],
 ["coordinate overflow", (data: any) => { data.shapes[0].x = 1001; }],
 ["nonfinite coordinate", (data: any) => { data.shapes[0].x = Infinity; }],
 ["numeric string", (data: any) => { data.shapes[0].x = "0"; }],
 ["zero length wire", (data: any) => { data.shapes = [{ kind: "wire", x1: 0, y1: 0, x2: 0, y2: 0 }]; }],
 ["reserved ID", (data: any) => { data.id = "resistor"; }],
 ["missing name", (data: any) => { delete data.name; }],
 ["blank name", (data: any) => { data.name = "   "; }],
 ["invalid ID", (data: any) => { data.id = "../bad"; }],
 ["unknown property", (data: any) => { data.shapes[0].raduis = 1; }],
 ["too many shapes", (data: any) => { data.shapes = Array(257).fill(data.shapes[0]); }],
 ["multi-symbol container", (data: any) => { data.symbols = [{ ...data }]; }],
] as const) {
 test(`rejects ${name}`, () => {
  const data = source();
  mutate(data);
  assert.throws(() => parseSymbolFile(JSON.stringify(data)));
 });
}

test("merges atomically, rejects existing IDs, and restores serialized libraries", () => {
 const original = [parseSymbolFile(example)];
 const next = { ...source(), id: "another-symbol" };
 const merged = mergeSymbolLibraries(original, [parseSymbolFile(JSON.stringify(next))]);
 assert.equal(merged.length, 2);
 assert.deepEqual(parseSavedSymbolLibrary(JSON.stringify(merged)), merged);
 assert.throws(() => mergeSymbolLibraries(original, original), /duplicated/);
 assert.equal(original.length, 1);
 assert.deepEqual(mergeSymbolLibraries([], original), original);
});

test("rejects invalid JSON and oversized files before reading", async () => {
 assert.throws(() => parseSymbolFile("{"), /Invalid JSON/);
 assert.throws(() => parseSymbolFile(" ".repeat(SYMBOL_FILE_LIMIT + 1)), /1 MB/);
 await assert.rejects(runEffect(importSymbolFile(new File([example], "wrong.svg"))), /Choose a/);
 const oversized = new File([" ".repeat(SYMBOL_FILE_LIMIT + 1)], "large.ecadsym");
 oversized.text = async () => { assert.fail("must not read an oversized file"); };
 await assert.rejects(runEffect(importSymbolFile(oversized)), /1 MB/);
 const unreadable = new File([], "broken.ecadsym");
 unreadable.text = async () => { throw new Error("Cannot read file"); };
 await assert.rejects(runEffect(importSymbolFile(unreadable)), /Cannot read file/);
 for (const name of ["library.ecadsym", "library.JSON"]) {
  assert.deepEqual(await runEffect(importSymbolFile(new File([example], name))), parseSymbolFile(example));
 }
});

const symbolFile = (id: string, name = `${id}.ecadsym`) => new File([JSON.stringify({ ...source(), id })], name);

test("imports one symbol per file, includes subdirectories, and ignores non-symbol directory files", async () => {
 const files = [symbolFile("one"), symbolFile("two", "two.JSON"), new File(["Readme"], "README.md")];
 Object.defineProperty(files[1], "webkitRelativePath", { value: "library/nested/two.JSON" });
 const symbols = await runEffect(importSymbolFiles(files, true));
 assert.deepEqual(symbols.map(symbol => symbol.id), ["one", "two"]);
 await assert.rejects(runEffect(importSymbolFiles(files)), /README.md/);
 await assert.rejects(runEffect(importSymbolFiles([files[2]], true)), /No .*symbol files/);
});

test("batch import rejects invalid neighbors and duplicates before exposing results", async () => {
 const bad = new File(["{"], "bad.ecadsym");
 Object.defineProperty(bad, "webkitRelativePath", { value: "library/nested/bad.ecadsym" });
 await assert.rejects(runEffect(importSymbolFiles([symbolFile("one"), bad], true)), /library\/nested\/bad.ecadsym: Invalid JSON/);
 await assert.rejects(runEffect(importSymbolFiles([symbolFile("same"), symbolFile("same", "other.ecadsym")])), /duplicated/);
 await assert.rejects(runEffect(importSymbolFiles(Array.from({ length: 101 }, (_, i) => symbolFile(`test-${i}`)))), /100 symbol files/);
 const tooBig = new File([" ".repeat(SYMBOL_FILE_LIMIT)], "large.ecadsym");
 tooBig.text = async () => { assert.fail("batch limits must be checked before reading"); };
 await assert.rejects(runEffect(importSymbolFiles([symbolFile("one"), tooBig])), /total 1 MB/);
});

test("portable files reject multi-symbol containers while old browser caches migrate", () => {
 const { format: _format, version: _version, units: _units, ...symbol } = source();
 const old = JSON.stringify({ format: "ecad-symbols", version: 1, units: "mm", symbols: [symbol] });
 assert.throws(() => parseSymbolFile(old), /Invalid symbol file/);
 assert.deepEqual(parseSavedSymbolLibrary(old), [parseSymbolFile(example)]);
 assert.throws(() => parseSavedSymbolLibrary(JSON.stringify({ format: "ecad-symbols", version: 2, units: "mm", symbols: [symbol] })));
});


test("pin files keep a fixed size and cached pin radii migrate", () => {
 const data = source();
 const pin = data.shapes.find((shape: { kind: string }) => shape.kind === "pin");
 pin.radius = 5;
 assert.throws(() => parseSymbolFile(JSON.stringify(data)), /radius/);
 const restored = parseSavedSymbolLibrary(JSON.stringify([data]));
 const restoredPin = libraryDefinitions(restored)[0].children.find(child => child.kind === "pin")!;
 assert.equal(restoredPin.width, 0.508);
 assert.equal(restoredPin.height, 0.508);
 assert.equal("radius" in restored[0].shapes[2], false);
});

test("pin names survive symbol file and library round trips, with unnamed legacy pins", () => {
 const data = source();
 const pin = data.shapes.find((shape: { kind: string }) => shape.kind === "pin");
 delete pin.name;
 const legacy = libraryDefinitions([parseSymbolFile(JSON.stringify(data))])[0];
 assert.equal(legacy.children.find(child => child.kind === "pin")?.name, "");
 pin.name = "VCC";
 const file = parseSymbolFile(JSON.stringify(data));
 const library = parseSavedSymbolLibrary(JSON.stringify([file]));
 const symbol = createSymbol(1, libraryDefinitions(library)[0], { x: 10, y: 20 });
 assert.equal(symbol.children.find(child => child.kind === "pin")?.name, "VCC");
 const saved = symbolFileFromSymbol(symbol);
 assert.equal(saved.shapes.find(shape => shape.kind === "pin")?.name, "VCC");
 assert.equal(libraryDefinitions([parseSymbolFile(JSON.stringify(saved))])[0].children.find(child => child.kind === "pin")?.name, "VCC");
 pin.name = 42;
 assert.throws(() => parseSymbolFile(JSON.stringify(data)), /name/);
});


test("new symbol files keep names, start empty, and avoid existing and built-in IDs", () => {
 const first = createEmptySymbolFile("  Power stage  ", []);
 assert.equal(first.name, "Power stage");
 assert.equal(first.id, "power-stage");
 assert.deepEqual(first.shapes, []);
 assert.deepEqual(parseSymbolFile(JSON.stringify(first)), first);
 assert.deepEqual(parseSavedSymbolLibrary(JSON.stringify([first])), [first]);
 assert.deepEqual(libraryDefinitions([first])[0].children, []);
 const second = createEmptySymbolFile("Power stage", [first]);
 assert.equal(second.id, "power-stage-2");
 assert.equal(createEmptySymbolFile("Resistor", []).id, "resistor-2");
 assert.equal(createEmptySymbolFile("電源", []).id, "symbol");
 assert.throws(() => createEmptySymbolFile("   ", []));
 assert.throws(() => createEmptySymbolFile("x".repeat(101), []));
});
