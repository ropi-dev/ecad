import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDrawingStore } from "@ecad/core/commands/drawing-store.ts";
import { parseSymbolFile } from "@ecad/core/components/editor/symbolFormat.ts";
import type { EditorShape } from "@ecad/core/drawing/shapes.ts";
import { parseProjectManifest, PROJECT_FILE, projectNameSchema, projectPathSchema, serializeProjectManifest } from "@ecad/core/projects/format.ts";
import { ProjectRepository } from "@ecad/core/projects/repository.ts";
import { createDesktopProjectDirectory, DesktopProjects } from "#/main/projects.ts";

const shape: EditorShape = { id: 7, kind: "rectangle", x: 0, y: 0, width: 5, height: 8, rotation: 0, lineWidth: 0.2 };
const symbol = parseSymbolFile(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "test-point", name: "Test point", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] }));

test("additional drawing files preserve paths, reject external edits and roll back failed saves", async () => temporary(async (parent) => {
	const directory = await createDesktopProjectDirectory(parent);
	let fail = false;
	const repository = new ProjectRepository({ ...directory, write: async (path, bytes) => { if (fail && path === PROJECT_FILE) throw new Error("Disk full"); await directory.write(path, bytes); } }, { layout: "files" });
	await repository.create("Drawings");
	const drawings = [{ id: "power", name: "Power", shapes: [shape] }];
	const saved = await repository.save({ shapes: [], symbols: [], drawings });
	assert.deepEqual(saved.manifest.drawings, ["drawings/power.ecaddraw"]);
	assert.deepEqual((await new ProjectRepository(directory).load()).drawings, drawings);
	fail = true;
	await assert.rejects(repository.save({ shapes: [shape], symbols: [], drawings: [{ ...drawings[0], shapes: [] }, { id: "control", name: "Control", shapes: [] }] }), /Disk full/);
	assert.deepEqual((await new ProjectRepository(directory).load()).drawings, drawings);
	assert.deepEqual(await readdir(join(parent, "drawings")), ["power.ecaddraw"]);
	fail = false;
	const next = await repository.save({ shapes: [shape], symbols: [] });
	assert.deepEqual(next.manifest.drawings, saved.manifest.drawings);
	await writeFile(join(parent, "drawings/power.ecaddraw"), JSON.stringify({ ...drawings[0], shapes: [] }));
	await assert.rejects(repository.save({ shapes: [], symbols: [] }), /changed on disk/);
}));

async function temporary(run: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "ecad-project-"));
	try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("desktop projects round trip TOML, drawing IDs, standalone symbols and binary source files", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	assert.equal(await projects.load(), null);
	const created = await projects.create("Motor controller", parent);
	assert.equal(created.directory, join(parent, "Motor controller"));
	const saved = await projects.save(created.directory, { shapes: [shape], symbols: [symbol] });
	const bytes = new Uint8Array([0, 255, 10, 13, 128]);
	const imported = await projects.importAssets(saved.directory, [{ name: "board.zip", kind: "gerber", bytes }]);
	const content = await readFile(join(saved.directory, PROJECT_FILE), "utf8");
	assert.match(content, /format = "ecad-project"/);
	assert.match(content, /name = "Motor controller"/);
	assert.deepEqual(parseProjectManifest(content), imported.manifest);
	assert.deepEqual(JSON.parse(await readFile(join(saved.directory, imported.manifest.symbols[0]), "utf8")), symbol);
	const reopened = await new DesktopProjects(join(saved.directory, PROJECT_FILE)).load();
	assert.deepEqual(reopened, imported);
	assert.deepEqual(await projects.readAsset(saved.directory, imported.manifest.assets[0].path), bytes);
	assert.equal(createDrawingStore(reopened?.shapes).getSnapshot().nextShapeId, 8);
	assert.equal(created.manifest.drawing, "drawing.ecaddraw");
	assert.equal(saved.manifest.drawing, created.manifest.drawing);
	assert.deepEqual(saved.manifest.symbols, ["symbols/test-point.ecadsym"]);
	assert.equal(imported.manifest.assets[0].path, "assets/board.zip");
	assert.deepEqual((await readdir(saved.directory)).sort(), [PROJECT_FILE, "assets", "drawing.ecaddraw", "symbols"]);
}));

test("project directories are isolated and stale renderer requests cannot access a previous project", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	const first = await projects.create("First", parent);
	await projects.save(first.directory, { shapes: [shape], symbols: [symbol] });
	const second = await projects.create("Second", parent);
	assert.deepEqual(second.shapes, []);
	assert.deepEqual(second.symbols, []);
	await assert.rejects(projects.save(first.directory, { shapes: [], symbols: [] }), /no longer open/);
	await assert.rejects(projects.readAsset(first.directory, "assets/test.step"), /no longer open/);
	const opened = await projects.openDirectory(first.directory);
	assert.deepEqual(opened.shapes, [shape]);
	assert.deepEqual(opened.symbols, [symbol]);
	await assert.rejects(projects.create("First", parent));
	assert.deepEqual((await projects.load())?.shapes, [shape]);
}));

test("a failed desktop manifest write restores the previous drawing and symbols", async () => temporary(async (parent) => {
	const directory = await createDesktopProjectDirectory(parent);
	let fail = false;
	const repository = new ProjectRepository({ ...directory, write: async (path, bytes) => { if (fail && path === PROJECT_FILE) throw new Error("Disk full"); await directory.write(path, bytes); } }, { layout: "files" });
	await repository.create("Controller");
	await repository.save({ shapes: [shape], symbols: [symbol] });
	const before = await readFile(join(parent, PROJECT_FILE), "utf8");
	fail = true;
	await assert.rejects(repository.save({ shapes: [], symbols: [{ ...symbol, name: "Changed" }, { ...symbol, id: "new-symbol" }] }), /Disk full/);
	assert.equal(await readFile(join(parent, PROJECT_FILE), "utf8"), before);
	const restored = await new ProjectRepository(directory).load();
	assert.deepEqual(restored.shapes, [shape]);
	assert.deepEqual(restored.symbols, [symbol]);
	assert.deepEqual(await readdir(join(parent, "symbols")), ["test-point.ecadsym"]);
	assert.deepEqual((await readdir(parent)).sort(), [PROJECT_FILE, "drawing.ecaddraw", "symbols"]);
	await assert.rejects(repository.importAssets([{ name: "model.step", kind: "step", bytes: new Uint8Array([1]) }]), /Disk full/);
	assert.deepEqual(await readdir(join(parent, "assets")), []);
	fail = false;
	assert.deepEqual((await repository.save({ shapes: [], symbols: [symbol] })).symbols, [symbol]);
}));

test("invalid documents and externally edited manifests do not replace the saved project", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	const created = await projects.create("Controller", parent);
	const original = await readFile(join(created.directory, PROJECT_FILE), "utf8");
	await assert.rejects(projects.save(created.directory, { shapes: [shape, shape], symbols: [] }), /duplicate shape IDs/);
	assert.equal(await readFile(join(created.directory, PROJECT_FILE), "utf8"), original);
	await writeFile(join(created.directory, PROJECT_FILE), `${original}\n# external change\n`);
	await assert.rejects(projects.save(created.directory, { shapes: [], symbols: [] }), /changed on disk/);
	await projects.openDirectory(created.directory);
	await projects.save(created.directory, { shapes: [shape], symbols: [] });
}));

test("project names, manifests and asset paths reject traversal and unsupported versions", () => {
	for (const name of ["", "../Other", "a/b", "a\\b", ".", "..", "CON", "NUL.txt", "bad\0name"]) assert.equal(projectNameSchema.safeParse(name).success, false);
	for (const path of ["../other", "/absolute", "C:/absolute", "assets/../../secret", "assets\\secret", "a//b", "a\0b"]) assert.equal(projectPathSchema.safeParse(path).success, false);
	const manifest = { format: "ecad-project" as const, version: 1 as const, name: "Controller", drawing: "drawing.ecaddraw", symbols: [], assets: [] };
	assert.deepEqual(parseProjectManifest(serializeProjectManifest(manifest)), manifest);
	assert.throws(() => parseProjectManifest(serializeProjectManifest(manifest).replace("version = 1", "version = 2")));
});

test("desktop storage refuses symbolic link assets and nested symbolic link directories", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	const created = await projects.create("Controller", parent);
	const outside = join(parent, "outside.ecaddraw");
	await writeFile(outside, JSON.stringify({ shapes: [shape] }));
	const manifestPath = join(created.directory, PROJECT_FILE);
	const manifest = created.manifest;
	await symlink(outside, join(created.directory, "linked.ecaddraw"));
	await writeFile(manifestPath, serializeProjectManifest({ ...manifest, drawing: "linked.ecaddraw" }));
	await assert.rejects(projects.openDirectory(created.directory));
	await mkdir(join(parent, "outside"));
	await symlink(join(parent, "outside"), join(created.directory, "linked"));
	const directory = await createDesktopProjectDirectory(created.directory);
	await assert.rejects(directory.write("linked/secret", new Uint8Array([1])), /symbolic links/);
	await assert.rejects(directory.read("../outside.ecaddraw"));
	assert.deepEqual(JSON.parse(await readFile(outside, "utf8")), { shapes: [shape] });
}));

test("legacy symbol directories still load without silently creating project files", async () => temporary(async (parent) => {
	assert.equal(await new DesktopProjects(parent).load(), null);
	assert.deepEqual(await readdir(parent), []);
	await writeFile(join(parent, PROJECT_FILE), "broken TOML [");
	await assert.rejects(new DesktopProjects(parent).load());
}));

test("saving a legacy desktop project migrates its referenced files and removes empty hidden folders", async () => temporary(async (parent) => {
	const directory = await createDesktopProjectDirectory(parent);
	const legacy = new ProjectRepository(directory);
	await legacy.create("Legacy");
	await legacy.save({ shapes: [shape], symbols: [symbol] });
	const bytes = new Uint8Array([0, 255, 42]);
	const imported = await legacy.importAssets([{ name: "model.step", kind: "step", bytes }]);
	const projects = new DesktopProjects(parent);
	const opened = await projects.load();
	assert.deepEqual(opened, imported);
	const saved = await projects.save(parent, { shapes: opened!.shapes, symbols: opened!.symbols });
	assert.equal(saved.manifest.drawing, "drawing.ecaddraw");
	assert.deepEqual(saved.manifest.symbols, ["symbols/test-point.ecadsym"]);
	assert.deepEqual(saved.manifest.assets, imported.manifest.assets);
	assert.deepEqual(await projects.readAsset(parent, saved.manifest.assets[0].path), bytes);
	assert.deepEqual((await readdir(parent)).sort(), [PROJECT_FILE, "assets", "drawing.ecaddraw", "symbols"]);
	assert.deepEqual(await new DesktopProjects(parent).load(), saved);
	const again = await projects.save(parent, { shapes: [], symbols: [symbol] });
	assert.equal(again.manifest.drawing, saved.manifest.drawing);
	assert.deepEqual(again.manifest.symbols, saved.manifest.symbols);
}));

test("legacy migration preserves unrelated files and chooses free visible filenames", async () => temporary(async (parent) => {
	const directory = await createDesktopProjectDirectory(parent);
	const legacy = new ProjectRepository(directory);
	await legacy.create("Legacy");
	const original = await legacy.save({ shapes: [shape], symbols: [symbol] });
	await writeFile(join(parent, "drawing.ecaddraw"), "unrelated drawing");
	await mkdir(join(parent, "symbols"));
	await writeFile(join(parent, "symbols", "test-point.ecadsym"), "unrelated symbol");
	const revision = original.manifest.drawing.slice(0, original.manifest.drawing.lastIndexOf("/"));
	await writeFile(join(parent, revision, "notes.txt"), "keep these notes");
	const projects = new DesktopProjects(parent);
	await projects.load();
	const saved = await projects.save(parent, { shapes: [shape], symbols: [symbol] });
	assert.equal(saved.manifest.drawing, "drawing-2.ecaddraw");
	assert.deepEqual(saved.manifest.symbols, ["symbols/test-point-2.ecadsym"]);
	assert.equal(await readFile(join(parent, "drawing.ecaddraw"), "utf8"), "unrelated drawing");
	assert.equal(await readFile(join(parent, "symbols", "test-point.ecadsym"), "utf8"), "unrelated symbol");
	assert.deepEqual(await readdir(join(parent, revision)), ["notes.txt"]);
	await projects.save(parent, { shapes: [], symbols: [] });
	assert.deepEqual(await readdir(join(parent, "symbols")), ["test-point.ecadsym"]);
}));

test("failed legacy migration leaves the old project readable and allows retrying", async () => temporary(async (parent) => {
	const directory = await createDesktopProjectDirectory(parent);
	const legacy = new ProjectRepository(directory);
	await legacy.create("Legacy");
	const original = await legacy.save({ shapes: [shape], symbols: [symbol] });
	let fail = true;
	const repository = new ProjectRepository({ ...directory, write: async (path, bytes) => {
		if (fail && path === PROJECT_FILE) throw new Error("Disk full");
		await directory.write(path, bytes);
	} }, { layout: "files" });
	await repository.load();
	await assert.rejects(repository.save({ shapes: [], symbols: [symbol] }), /Disk full/);
	assert.deepEqual(await new ProjectRepository(directory).load(), original);
	await assert.rejects(readFile(join(parent, "drawing.ecaddraw")), { code: "ENOENT" });
	assert.deepEqual(await readdir(join(parent, "symbols")), []);
	fail = false;
	const saved = await repository.save({ shapes: [], symbols: [symbol] });
	assert.equal(saved.manifest.drawing, "drawing.ecaddraw");
	assert.equal((await readdir(parent)).includes(".ecad"), false);
}));

test("desktop imports preserve source filenames and never overwrite existing files", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	const created = await projects.create("Controller", parent);
	await mkdir(join(created.directory, "assets"));
	await writeFile(join(created.directory, "assets", "board.step"), "external model");
	const bytes = new Uint8Array([0, 128, 255]);
	const inputs = ["board.step", "board.step", "layers.zip", "top.gbr"].map((name) => ({ name, kind: name.endsWith("step") ? "step" as const : "gerber" as const, bytes }));
	const imported = await projects.importAssets(created.directory, inputs);
	assert.deepEqual(imported.manifest.assets.map((asset) => asset.path), ["assets/board-2.step", "assets/board-3.step", "assets/layers.zip", "assets/top.gbr"]);
	assert.equal(await readFile(join(created.directory, "assets", "board.step"), "utf8"), "external model");
	for (const asset of imported.manifest.assets) assert.deepEqual(await projects.readAsset(created.directory, asset.path), bytes);
	await mkdir(join(created.directory, "assets", "board-4.step"));
	const again = await projects.importAssets(created.directory, [{ name: "board.step", kind: "step", bytes }]);
	assert.equal(again.manifest.assets.at(-1)?.path, "assets/board-5.step");
	assert.deepEqual(await readdir(join(created.directory, "assets", "board-4.step")), []);
	assert.equal((await readdir(created.directory)).includes(".ecad"), false);
}));

test("direct drawing and symbol edits reject stale desktop saves and imports", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	const created = await projects.create("Controller", parent);
	const saved = await projects.save(created.directory, { shapes: [shape], symbols: [symbol] });
	const drawingPath = join(saved.directory, saved.manifest.drawing);
	const symbolPath = join(saved.directory, saved.manifest.symbols[0]);
	await writeFile(drawingPath, JSON.stringify({ shapes: [] }));
	await assert.rejects(projects.save(saved.directory, { shapes: [shape], symbols: [symbol] }), /changed on disk/);
	await assert.rejects(projects.importAssets(saved.directory, [{ name: "model.step", kind: "step", bytes: new Uint8Array([1]) }]), /changed on disk/);
	await projects.openDirectory(saved.directory);
	await writeFile(symbolPath, JSON.stringify({ ...symbol, name: "External edit" }));
	await assert.rejects(projects.save(saved.directory, { shapes: [], symbols: [] }), /changed on disk/);
	assert.equal(JSON.parse(await readFile(symbolPath, "utf8")).name, "External edit");
	const reopened = await projects.openDirectory(saved.directory);
	assert.equal(reopened.symbols[0].name, "External edit");
	await projects.save(saved.directory, { shapes: [shape], symbols: reopened.symbols });
}));

test("desktop saves retain drawing and symbol paths in user subdirectories", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	const created = await projects.create("Controller", parent);
	await projects.save(created.directory, { shapes: [shape], symbols: [symbol] });
	const directory = await createDesktopProjectDirectory(created.directory);
	await directory.write("drawings/controller.ecaddraw", new TextEncoder().encode(JSON.stringify({ shapes: [shape] })));
	await directory.write("library/points.ecadsym", new TextEncoder().encode(JSON.stringify(symbol)));
	const manifestPath = join(created.directory, PROJECT_FILE);
	const manifest = parseProjectManifest(await readFile(manifestPath, "utf8"));
	await writeFile(manifestPath, serializeProjectManifest({ ...manifest, drawing: "drawings/controller.ecaddraw", symbols: ["library/points.ecadsym"] }));
	await projects.openDirectory(created.directory);
	const saved = await projects.save(created.directory, { shapes: [], symbols: [symbol] });
	assert.equal(saved.manifest.drawing, "drawings/controller.ecaddraw");
	assert.deepEqual(saved.manifest.symbols, ["library/points.ecadsym"]);
	assert.deepEqual(await new DesktopProjects(saved.directory).load(), saved);
}));

test("desktop project directory libraries resolve within their project and survive reopening", async t => {
 const parent = await mkdtemp(join(tmpdir(), "ecad-project-libraries-"));
 t.after(() => rm(parent, { recursive: true, force: true }));
 const projects = new DesktopProjects();
 const project = await projects.create("Library project", parent);
 const libraryPath = join(project.directory, "libraries");
 await mkdir(libraryPath);
 await writeFile(join(libraryPath, "test-point.ecadsym"), JSON.stringify(symbol));
 const symbolLibraries = [{ id: "local", name: "Local parts", enabled: true, source: { kind: "directory" as const, path: "libraries" } }];
 await projects.save(project.directory, { shapes: [], symbols: [], symbolLibraries });
 assert.deepEqual(await projects.readSymbolLibrary(project.directory, "libraries"), [symbol]);
 await assert.rejects(projects.readSymbolLibrary(project.directory, "../"), /not configured/);
 const reopened = new DesktopProjects(project.directory);
 assert.deepEqual((await reopened.load())?.symbolLibraries, symbolLibraries);
 assert.deepEqual(await reopened.readSymbolLibrary(project.directory, "libraries"), [symbol]);
});

test("edits writable relative project directory symbols and checks project file permissions", async () => temporary(async (parent) => {
 const { chmod } = await import("node:fs/promises");
 const projects = new DesktopProjects();
 const project = await projects.create("Editing", parent);
 await projects.save(project.directory, { shapes: [], symbols: [symbol], symbolLibraries: [{ id: "outside", name: "Outside", enabled: true, source: { kind: "directory", path: "../parts" } }] });
 const path = join(parent, "parts");
 await mkdir(path);
 await writeFile(join(path, "other-name.json"), JSON.stringify(symbol));
 assert.deepEqual(await projects.inspectLibrarySymbol(project.directory, "../parts", symbol.id), { file: symbol, writable: true });
 const next = { ...symbol, shapes: [] };
 await projects.saveLibrarySymbol(project.directory, "../parts", symbol, next);
 assert.deepEqual(await projects.readSymbolLibrary(project.directory, "../parts"), [next]);
 await assert.rejects(projects.saveLibrarySymbol(project.directory, "..", symbol, next), /not configured/);
 const snapshot = (await projects.load())!;
 const symbolPath = snapshot.manifest.symbols[0];
 assert.equal(await projects.canWriteFile(project.directory, symbolPath), true);
 await chmod(join(project.directory, symbolPath), 0o444);
 assert.equal(await projects.canWriteFile(project.directory, symbolPath), false);
 assert.equal(await projects.canWriteFile(project.directory, snapshot.manifest.drawing), true);
 await chmod(join(project.directory, symbolPath), 0o644);
 await assert.rejects(projects.canWriteFile(parent, symbolPath), /no longer open/);
}));


test("untitled desktop projects stay in isolated memory until explicitly saved", async () => {
	const projects = new DesktopProjects();
	const first = await projects.createUntitled();
	const second = await projects.createUntitled();
	assert.equal(first.manifest.name, "Untitled");
	assert.equal(second.inMemory, true);
	assert.match(first.directory, /^memory:/);
	assert.notEqual(first.directory, second.directory);
	assert.deepEqual(await projects.load(), second);
	assert.equal(await projects.canWriteFile(second.directory, second.manifest.drawing), true);
	assert.equal(await new DesktopProjects().load(), null);
	await assert.rejects(projects.save(first.directory, { shapes: [], symbols: [] }), /no longer open/);
});

test("saving an in-memory project preserves drawings, circuits, libraries and binary sources", async () => temporary(async (parent) => {
	const { createCircuit } = await import("@ecad/drawing-core/circuit/model.ts");
	const projects = new DesktopProjects();
	const created = await projects.createUntitled();
	const edited = await projects.save(created.directory, {
		shapes: [shape], symbols: [symbol],
		drawings: [{ id: "power", name: "Power", shapes: [shape] }],
		circuits: [createCircuit("Power supply")],
		symbolLibraries: [{ id: "project-symbols", name: "Project symbols", enabled: true, source: { kind: "embedded", symbols: [symbol] } }],
	});
	assert.equal(edited.inMemory, true);
	assert.deepEqual(await readdir(parent), []);
	const bytes = new Uint8Array([0, 255, 13, 128]);
	const imported = await projects.importAssets(created.directory, [{ name: "model.step", kind: "step", bytes }]);
	bytes.fill(42);
	const asset = imported.manifest.assets[0];
	assert.deepEqual(await projects.readAsset(created.directory, asset.path), new Uint8Array([0, 255, 13, 128]));
	const saved = await projects.saveToDirectory(created.directory, parent);
	assert.equal(saved.inMemory, undefined);
	assert.equal(saved.directory, join(parent, "Untitled"));
	const { directory, inMemory, ...expected } = imported;
	const { directory: savedDirectory, ...actual } = saved;
	assert.deepEqual(actual, expected);
	assert.deepEqual(await new DesktopProjects(saved.directory).load(), saved);
	assert.deepEqual(await projects.readAsset(saved.directory, asset.path), new Uint8Array([0, 255, 13, 128]));
	await assert.rejects(projects.readAsset(created.directory, asset.path), /no longer open/);
	const next = await projects.save(saved.directory, { ...saved, shapes: [] });
	assert.deepEqual((await new DesktopProjects(saved.directory).load())?.shapes, next.shapes);
}));

test("failed memory export preserves the project and does not overwrite an existing folder", async () => temporary(async (parent) => {
	const projects = new DesktopProjects();
	const created = await projects.createUntitled();
	await projects.save(created.directory, { shapes: [shape], symbols: [symbol] });
	await mkdir(join(parent, "Untitled"));
	await writeFile(join(parent, "Untitled", "keep.txt"), "Keep this file");
	await assert.rejects(projects.saveToDirectory(created.directory, parent), { code: "EEXIST" });
	assert.equal(await readFile(join(parent, "Untitled", "keep.txt"), "utf8"), "Keep this file");
	assert.equal((await projects.load())?.inMemory, true);
	assert.deepEqual((await projects.load())?.shapes, [shape]);
	await mkdir(join(parent, "another"));
	assert.equal((await projects.saveToDirectory(created.directory, join(parent, "another"))).inMemory, undefined);
}));
