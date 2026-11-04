import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import {
	type ConfiguredSymbolLibrary,
	defaultSymbolConfig,
	resolveSymbolLibraries,
} from "#/symbol-library/config.ts";
import { prepareSymbolEdit } from "#/symbol-library/editing.ts";
import { createMemorySymbolLibraryStorage } from "#/symbol-library/storage.tsx";
import { required } from "./helpers/required.ts";

const file = parseSymbolFile(
	JSON.stringify({
		format: "ecad-symbol",
		version: 1,
		units: "mm",
		id: "editable-part",
		name: "Part",
		description: "Keep metadata",
		prefix: "TP",
		value: "Signal",
		shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
	}),
);
const library = (id: string, name = "Part"): ConfiguredSymbolLibrary => ({
	id,
	name: id,
	enabled: true,
	source: { kind: "embedded", symbols: [{ ...file, name }] },
});

test("editing uses the winning source and preserves other libraries and metadata", async () => {
	const user = createMemorySymbolLibraryStorage();
	const project = createMemorySymbolLibraryStorage();
	const userLibraries = [library("first", "Earlier"), library("last", "User")];
	const projectLibraries = [library("custom-project", "Project")];
	await required(user.saveConfiguration)({
		version: 1,
		symbolLibraries: userLibraries,
	});
	await required(project.saveConfiguration)({
		version: 1,
		symbolLibraries: projectLibraries,
	});
	const resolved = await resolveSymbolLibraries(
		userLibraries,
		projectLibraries,
	);
	const source = required(resolved.sources.get(file.id));
	assert.equal(source.scope, "project");
	assert.equal(source.library.id, "custom-project");
	const target = await prepareSymbolEdit(source, user, project);
	assert.ok(target);
	await target.save({
		...target.file,
		shapes: [...target.file.shapes, { kind: "circle", x: 1, y: 2, radius: 3 }],
	});
	const saved = await required(project.loadConfiguration)();
	assert.deepEqual(await required(user.loadConfiguration)(), {
		version: 1,
		symbolLibraries: userLibraries,
	});
	const current = saved.symbolLibraries[0].source;
	assert.equal(current.kind, "embedded");
	if (current.kind !== "embedded") return;
	assert.deepEqual(current.symbols[0], {
		...file,
		name: "Project",
		shapes: [...file.shapes, { kind: "circle", x: 1, y: 2, radius: 3 }],
	});
	await target.save({ ...target.file, shapes: [] });
	assert.equal(
		(await required(project.loadConfiguration)()).symbolLibraries.length,
		1,
	);
});

test("user definitions are editable without an open project and stale writes are rejected", async () => {
	const user = createMemorySymbolLibraryStorage();
	const entry = library("user");
	await required(user.saveConfiguration)({
		version: 1,
		symbolLibraries: [entry],
	});
	const source = required(
		(await resolveSymbolLibraries([entry], [])).sources.get(file.id),
	);
	const target = await prepareSymbolEdit(source, user);
	assert.ok(target);
	await required(user.saveConfiguration)({
		version: 1,
		symbolLibraries: [library("user", "External change")],
	});
	await assert.rejects(target.save(file), /definition changed/);
	await assert.rejects(
		target.save({ ...file, id: "different" }),
		/cannot change/,
	);
});

test("read-only sources and bundled definitions have no editing target", async () => {
	const user = createMemorySymbolLibraryStorage();
	const entry = library("user");
	const source = required(
		(await resolveSymbolLibraries([entry], [])).sources.get(file.id),
	);
	assert.equal(
		await prepareSymbolEdit(source, {
			...user,
			canWriteConfiguration: async () => false,
		}),
		null,
	);
	const builtin = required(
		(
			await resolveSymbolLibraries(defaultSymbolConfig().symbolLibraries, [])
		).sources.get("resistor"),
	);
	assert.equal(await prepareSymbolEdit(builtin, user), null);
	const project = { ...user, canEditSymbol: async () => false };
	assert.equal(
		await prepareSymbolEdit(
			{ ...source, scope: "project", library: library("project-symbols") },
			user,
			project,
		),
		null,
	);
});

test("project files depend on their own permissions rather than the drawing's permissions", async () => {
	const user = createMemorySymbolLibraryStorage();
	const entry = library("project-symbols");
	const source = required(
		(await resolveSymbolLibraries([], [entry])).sources.get(file.id),
	);
	const project = {
		...user,
		canEditSymbol: async () => true,
		canWriteConfiguration: async () => false,
	};
	assert.ok(await prepareSymbolEdit(source, user, project));
});

test("directory edits pass the original source and project directory to host persistence", async () => {
	const user = createMemorySymbolLibraryStorage();
	const entry: ConfiguredSymbolLibrary = {
		id: "external",
		name: "External",
		enabled: true,
		source: { kind: "directory", path: "../parts" },
	};
	const source = required(
		(await resolveSymbolLibraries([], [entry], async () => [file])).sources.get(
			file.id,
		),
	);
	const calls: unknown[] = [];
	const request = {
		id: file.id,
		path: "../parts",
		scope: "project",
		projectDirectory: "/project",
	};
	const storage = {
		...user,
		async inspectDirectorySymbol(input: unknown) {
			calls.push(input);
			return { file, writable: true };
		},
		async saveDirectorySymbol(
			input: unknown,
			original: unknown,
			next: unknown,
		) {
			calls.push([input, original, next]);
		},
	};
	const project = {
		...user,
		load: async () => ({ symbols: [], directory: "/project" }),
	};
	const target = await prepareSymbolEdit(source, storage, project);
	assert.ok(target);
	const next = { ...file, shapes: [] };
	await target.save(next);
	await target.save(file);
	assert.deepEqual(calls, [
		request,
		[request, file, next],
		[request, next, file],
	]);
	assert.equal(
		await prepareSymbolEdit(
			source,
			{
				...storage,
				inspectDirectorySymbol: async () => ({ file, writable: false }),
			},
			project,
		),
		null,
	);
});
