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
	assert.equal((await readdir(join(saved.directory, ".ecad"))).length, 1);
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

test("a failed manifest write keeps the previous project readable and removes incomplete revisions", async () => temporary(async (parent) => {
	const directory = await createDesktopProjectDirectory(parent);
	let fail = false;
	const repository = new ProjectRepository({ ...directory, write: async (path, bytes) => { if (fail && path === PROJECT_FILE) throw new Error("Disk full"); await directory.write(path, bytes); } });
	await repository.create("Controller");
	await repository.save({ shapes: [shape], symbols: [] });
	const before = await readFile(join(parent, PROJECT_FILE), "utf8");
	fail = true;
	await assert.rejects(repository.save({ shapes: [], symbols: [symbol] }), /Disk full/);
	assert.equal(await readFile(join(parent, PROJECT_FILE), "utf8"), before);
	assert.deepEqual((await new ProjectRepository(directory).load()).shapes, [shape]);
	assert.equal((await readdir(join(parent, ".ecad"))).length, 1);
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
