import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { DesktopProjects } from "#/main/projects.ts";
import { required } from "../../../tests/helpers/required.ts";

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
	const drawing = join(
		saved.directory,
		...required(saved.manifest.drawing).split("/"),
	);
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
