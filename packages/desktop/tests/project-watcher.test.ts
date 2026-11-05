import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	InvalidProjectFile,
	ProjectConflict,
} from "@ecad/core/projects/errors.ts";
import { PROJECT_FILE } from "@ecad/core/projects/format.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { createProjectWatcher } from "#/main/project-watcher.ts";
import { DesktopProjects } from "#/main/projects.ts";

const shape: EditorShape = {
	id: 7,
	kind: "rectangle",
	x: 0,
	y: 0,
	width: 5,
	height: 8,
	rotation: 0,
	lineWidth: 0.2,
};
// Wide margins keep these real-filesystem tests stable on a busy machine.
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
const watcher = { delay: 100, maxDelay: 2000 };

async function fixture(t: { after(done: () => Promise<void>): void }) {
	const parent = await mkdtemp(join(tmpdir(), "ecad-watch-"));
	const changes: string[] = [];
	const projects = new DesktopProjects(undefined, {
		onExternalChange: (directory) => changes.push(directory),
		watcher,
	});
	t.after(async () => {
		projects.close();
		await rm(parent, { recursive: true, force: true });
	});
	const created = await projects.create("Board", parent);
	const saved = await projects.save(created.directory, {
		shapes: [shape],
		symbols: [],
	});
	await settle();
	changes.length = 0;
	const drawing = join(saved.directory, ...saved.manifest.drawing.split("/"));
	return { projects, changes, saved, drawing };
}

async function editExternally(path: string, shapes: EditorShape[]) {
	const file = JSON.parse(await readFile(path, "utf8"));
	await writeFile(path, JSON.stringify({ ...file, shapes }));
}

test("external edits are reported once per burst, and this window's saves never are", async (t) => {
	const { projects, changes, saved, drawing } = await fixture(t);
	await projects.save(saved.directory, {
		shapes: [shape, { ...shape, id: 8 }],
		symbols: [],
	});
	await settle();
	assert.deepEqual(changes, []);

	for (const x of [1, 2, 3]) await editExternally(drawing, [{ ...shape, x }]);
	await settle();
	assert.deepEqual(changes, [saved.directory]);
});

test("temporary, lock, history and unrelated files are ignored", async (t) => {
	const { changes, saved, drawing } = await fixture(t);
	await writeFile(join(saved.directory, ".ecad-temporary.tmp"), "x");
	await writeFile(`${drawing}.history.json`, "{}");
	await writeFile(join(saved.directory, "notes.txt"), "x");
	await mkdir(join(saved.directory, "assets"));
	await writeFile(join(saved.directory, "assets", "board.step"), "x");
	await settle();
	assert.deepEqual(changes, []);
});

test("refresh adopts the files on disk once, so later saves do not conflict", async (t) => {
	const { projects, saved, drawing } = await fixture(t);
	await editExternally(drawing, [{ ...shape, x: 4 }]);
	const refreshed = await projects.refresh(saved.directory);
	assert.deepEqual(refreshed?.changed, [saved.manifest.drawing]);
	assert.equal(refreshed?.snapshot.shapes[0].x, 4);
	assert.equal(await projects.refresh(saved.directory), null);
	const next = await projects.save(saved.directory, {
		shapes: [{ ...shape, x: 5 }],
		symbols: [],
	});
	assert.equal(next.shapes[0].x, 5);
});

test("an unreadable change keeps the saved state, so the next save still conflicts", async (t) => {
	const { projects, saved, drawing } = await fixture(t);
	await writeFile(drawing, "{");
	await assert.rejects(projects.refresh(saved.directory), InvalidProjectFile);
	await assert.rejects(
		projects.save(saved.directory, { shapes: [], symbols: [] }),
		ProjectConflict,
	);
});

test("an external manifest change is reported, and switching to an untitled project stops watching", async (t) => {
	const { projects, changes, saved, drawing } = await fixture(t);
	const manifest = join(saved.directory, PROJECT_FILE);
	await writeFile(manifest, `${await readFile(manifest, "utf8")}\n`);
	await settle();
	assert.deepEqual(changes, [saved.directory]);

	await projects.createUntitled();
	changes.length = 0;
	await editExternally(drawing, []);
	await settle();
	assert.deepEqual(changes, []);
	await projects.checkExternalChanges();
	assert.deepEqual(changes, []);
});

test("the watcher follows files into directories created after it started", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "ecad-watch-"));
	let changes = 0;
	const project = createProjectWatcher({
		...watcher,
		directory,
		paths: () => ["parts/a/part.ecadsym"],
		onChange: () => changes++,
	});
	t.after(async () => {
		project.close();
		await rm(directory, { recursive: true, force: true });
	});
	await mkdir(join(directory, "parts"));
	await settle();
	await mkdir(join(directory, "parts", "a"));
	await settle();
	// Creating the directories is itself reported, possibly more than once,
	// so the file write is counted from here.
	const before = changes;
	assert.ok(before >= 1);
	await writeFile(join(directory, "parts", "a", "part.ecadsym"), "{}");
	await settle();
	assert.equal(changes, before + 1);
	project.close();
	await writeFile(join(directory, "parts", "a", "part.ecadsym"), "{ }");
	await settle();
	assert.equal(changes, before + 1);
});

test("a directory whose watcher fails waits for the next sync instead of looping", async () => {
	const created: string[] = [];
	const failing = new Set<EventEmitter>();
	let changes = 0;
	const project = createProjectWatcher({
		directory: "/project",
		paths: () => ["symbols/part.ecadsym"],
		onChange: () => changes++,
		delay: 5,
		watch: ((path: string) => {
			created.push(path);
			const watcher = Object.assign(new EventEmitter(), { close() {} });
			if (path.endsWith("symbols")) failing.add(watcher);
			return watcher as unknown as FSWatcher;
		}) as never,
	});
	for (const watcher of failing) watcher.emit("error", new Error("EPERM"));
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(changes, 1);
	assert.deepEqual(created, ["/project", "/project/symbols"]);
	project.sync();
	assert.deepEqual(created, [
		"/project",
		"/project/symbols",
		"/project/symbols",
	]);
	project.close();
});
