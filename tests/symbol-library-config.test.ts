import { memoryDirectory } from "./helpers/project-directory.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { ProjectRepository } from "#/projects/repository.ts";
import { type ConfiguredSymbolLibrary, defaultSymbolConfig, parseSymbolConfig, resolveSymbolLibraries, serializeSymbolConfig, unavailableSymbols } from "#/symbol-library/config.ts";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { MissingSymbolLibraryError, synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";

const symbol = parseSymbolFile(readFileSync(new URL("../packages/core/src/symbol-library/examples/test-point.ecadsym", import.meta.url), "utf8"));
const library = (id: string, name = "Test point"): ConfiguredSymbolLibrary => ({ id, name: id, enabled: true, source: { kind: "embedded", symbols: [{ ...symbol, name }] } });

test("library configuration validates sources, names, IDs, and symbol contents", () => {
 const config = { version: 1 as const, symbolLibraries: [...defaultSymbolConfig().symbolLibraries, library("test")] };
 assert.deepEqual(parseSymbolConfig(serializeSymbolConfig(config)), config);
 for (const invalid of [
  { ...config, version: 2 },
  { ...config, symbolLibraries: [library("test"), library("test")] },
  { ...config, symbolLibraries: [{ ...library("test"), name: " " }] },
  { ...config, symbolLibraries: [{ ...library("test"), source: { kind: "url", url: "x" } }] },
  { ...config, symbolLibraries: [{ ...library("test"), source: { kind: "directory", path: " " } }] },
  { ...config, symbolLibraries: [{ ...library("test"), source: { kind: "embedded", symbols: [symbol, symbol] } }] },
  { ...config, symbolLibraries: [{ ...library("test"), source: { kind: "embedded", symbols: [{ ...symbol, id: "resistor" }] } }] },
 ]) assert.throws(() => parseSymbolConfig(JSON.stringify(invalid)));
});

test("enabled libraries resolve in order and project definitions take precedence", async () => {
 const global = [library("first", "First"), library("last", "User")];
 const project = [library("project", "Project")];
 const resolved = await resolveSymbolLibraries(global, project);
 assert.equal(resolved.definitions.length, 1);
 assert.equal(resolved.definitions[0].name, "Project");
 const disabled = await resolveSymbolLibraries(global, [{ ...project[0], enabled: false }]);
 assert.equal(disabled.definitions[0].name, "User");
 assert.deepEqual((await resolveSymbolLibraries(defaultSymbolConfig().symbolLibraries.map(entry => ({ ...entry, enabled: false })), [])).definitions, []);
 const broken = await resolveSymbolLibraries([
  ...defaultSymbolConfig().symbolLibraries,
  { id: "broken", name: "Broken", enabled: true, source: { kind: "directory", path: "missing" } },
  library("working"),
 ], []);
 assert.equal(broken.definitions.length, symbolDefinitions.length + 1);
 assert.match(broken.errors[0], /Broken:.*desktop/);
 assert.deepEqual(broken.unavailable, [{ scope: "user", id: "broken" }]);
 const failing = await resolveSymbolLibraries([], [{ id: "parts", name: "Parts", enabled: true, source: { kind: "directory", path: "parts" } }], async () => { throw new Error("Directory is unreadable."); });
 assert.deepEqual(failing.unavailable, [{ scope: "project", id: "parts" }]);
 assert.deepEqual(failing.errors, ["Parts: Directory is unreadable."]);
});

for (const layout of ["files", "revisions"] as const) test(`project libraries survive saves, reopening and source imports in the ${layout} layout`, async () => {
 const { directory } = memoryDirectory("Project");
 const repository = new ProjectRepository(directory, { layout });
 await repository.create("Project");
 const libraries = [library("project", "Project point"), { id: "folder", name: "Local", enabled: false, source: { kind: "directory" as const, path: "libraries/local" } }];
 const saved = await repository.save({ shapes: [], symbols: [symbol], symbolLibraries: libraries });
 const imported = await repository.importAssets([{ name: "model.step", kind: "step", bytes: new Uint8Array([1, 2, 3]) }]);
 assert.deepEqual(imported.symbolLibraries, libraries);
 assert.deepEqual((await new ProjectRepository(directory, { layout }).load()).symbolLibraries, libraries);
 assert.deepEqual(saved.symbols, [symbol]);
 assert.deepEqual(repository.getSymbolLibraries(), libraries);
 await assert.rejects(repository.save({ shapes: [], symbols: [], symbolLibraries: [library("same"), library("same")] }));
 assert.deepEqual((await new ProjectRepository(directory, { layout }).load()).symbolLibraries, libraries);
});

test("memory configuration keeps symbols seeded through the existing storage API", async () => {
 const { createMemorySymbolLibraryStorage } = await import("#/symbol-library/storage.tsx");
 const storage = createMemorySymbolLibraryStorage();
 await storage.save([symbol], [symbol]);
 const config = await storage.loadConfiguration!();
 assert.equal((await resolveSymbolLibraries(config.symbolLibraries, [])).definitions.length, symbolDefinitions.length + 1);
 await storage.saveConfiguration!({ version: 1, symbolLibraries: [] });
 assert.deepEqual((await storage.load()).symbols, []);
});

test("a symbol that depends on a library that failed to load is unavailable and never becomes a placeholder", async () => {
 const bench = { scope: "user" as const, id: "bench" };
 const kit = { scope: "project" as const, id: "kit" };
 const divider = parseSymbolFile(JSON.stringify({ ...symbol, id: "divider", name: "Divider", shapes: [...symbol.shapes, { kind: "symbol", library: bench, definitionId: "core", x: 0, y: 0 }] }));
 const standalone = parseSymbolFile(JSON.stringify({ ...symbol, id: "standalone", name: "Standalone" }));
 const resolved = await resolveSymbolLibraries(
  [{ id: bench.id, name: "Bench", enabled: true, source: { kind: "directory", path: "bench" } }],
  [{ id: kit.id, name: "Kit", enabled: true, source: { kind: "embedded", symbols: [divider, standalone] } }],
  async () => { throw new Error("Directory is unreadable."); },
 );
 assert.deepEqual(resolved.unavailable, [bench]);
 assert.deepEqual(resolved.unavailableSymbols, [symbolReferenceKey(kit, "divider")]);
 assert.ok(resolved.byReference.has(symbolReferenceKey(kit, "standalone")));
 assert.ok(resolved.errors.some((error) => /Bench: Directory is unreadable/.test(error)));
 const isSymbolUnavailable = unavailableSymbols(resolved);
 assert.equal(isSymbolUnavailable(kit, "divider"), true);
 assert.equal(isSymbolUnavailable(bench, "core"), true);
 assert.equal(isSymbolUnavailable(kit, "standalone"), false);

 const definitions = [...symbolDefinitions, ...resolved.byReference.values()];
 const standaloneDefinition = resolved.byReference.get(symbolReferenceKey(kit, "standalone"))!;
 const original = createCircuit("Board", "pcb-main");
 const place = (part: { id: string; name: string }) => {
  const file = structuredClone(original);
  const component = componentFromSymbol(standaloneDefinition, []);
  file.circuit.components = [{ ...component, part: { ...component.part, ...part, library: kit } }];
  return synchronizePcb(file, [], original, definitions, { isSymbolUnavailable });
 };
 assert.throws(() => place({ id: "divider", name: "Divider" }), MissingSymbolLibraryError);
 const partial = [...definitions, { ...standaloneDefinition, id: "divider", library: kit }];
 const file = structuredClone(original);
 const component = componentFromSymbol(standaloneDefinition, []);
 file.circuit.components = [{ ...component, part: { ...component.part, id: "divider", library: kit } }];
 assert.throws(() => synchronizePcb(file, [], original, partial, { isSymbolUnavailable }), MissingSymbolLibraryError);
 const placed = place({ id: "standalone", name: "Standalone" }).shapes.find((shape) => shape.kind === "symbol");
 assert.equal(placed?.kind === "symbol" && placed.definitionId, "standalone");
 const missing = place({ id: "removed", name: "Removed" }).shapes.find((shape) => shape.kind === "symbol");
 assert.match(missing?.kind === "symbol" ? missing.definitionId : "", /^circuit-fallback\./);
});

test("every symbol that fails to resolve is unavailable, whatever fails first", async () => {
 const bench = { scope: "user" as const, id: "bench" };
 const kit = { scope: "project" as const, id: "kit" };
 const file = (id: string, nested: { library: typeof bench | typeof kit; definitionId: string }[]) =>
  parseSymbolFile(JSON.stringify({ ...symbol, id, name: id, shapes: [...symbol.shapes, ...nested.map((reference) => ({ kind: "symbol", ...reference, x: 0, y: 0 }))] }));
 const resolved = await resolveSymbolLibraries(
  [{ id: bench.id, name: "Bench", enabled: true, source: { kind: "directory", path: "bench" } }],
  [{ id: kit.id, name: "Kit", enabled: true, source: { kind: "embedded", symbols: [
   file("divider", [{ library: kit, definitionId: "deleted" }, { library: bench, definitionId: "core" }]),
   file("assembly", [{ library: kit, definitionId: "divider" }]),
   file("loop-a", [{ library: kit, definitionId: "loop-b" }]),
   file("loop-b", [{ library: kit, definitionId: "loop-a" }, { library: bench, definitionId: "core" }]),
   file("broken", [{ library: kit, definitionId: "deleted" }]),
   file("plain", []),
  ] } }],
  async () => { throw new Error("Directory is unreadable."); },
 );
 assert.deepEqual(new Set(resolved.unavailableSymbols), new Set(["divider", "assembly", "loop-a", "loop-b", "broken"].map((id) => symbolReferenceKey(kit, id))));
 const isSymbolUnavailable = unavailableSymbols(resolved);
 assert.equal(isSymbolUnavailable(kit, "plain"), false);
 assert.deepEqual((await resolveSymbolLibraries([], [{ id: kit.id, name: "Kit", enabled: true, source: { kind: "embedded", symbols: [file("divider", [{ library: bench, definitionId: "core" }])] } }])).unavailableSymbols, [symbolReferenceKey(kit, "divider")]);
 const nested = await resolveSymbolLibraries([], [{ id: kit.id, name: "Kit", enabled: true, source: { kind: "embedded", symbols: [file("plain", []), file("wrapper", [{ library: kit, definitionId: "plain" }])] } }]);
 assert.deepEqual(nested.unavailableSymbols, []);
});
