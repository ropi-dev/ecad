import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { ProjectRepository, type ProjectDirectory } from "#/projects/repository.ts";
import { type ConfiguredSymbolLibrary, defaultSymbolConfig, parseSymbolConfig, resolveSymbolLibraries, serializeSymbolConfig } from "#/symbol-library/config.ts";

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
});

for (const layout of ["files", "revisions"] as const) test(`project libraries survive saves, reopening and source imports in the ${layout} layout`, async () => {
 const entries = new Map<string, Uint8Array>();
 const directory: ProjectDirectory = {
  name: "Project",
  async read(path) { const value = entries.get(path); if (!value) throw new DOMException("Missing", "NotFoundError"); return value; },
  async write(path, bytes) { entries.set(path, bytes); },
  async remove(path) { for (const key of entries.keys()) if (key === path || key.startsWith(`${path}/`)) entries.delete(key); },
 };
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
