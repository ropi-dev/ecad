import assert from "node:assert/strict";
import { test } from "node:test";
import {
	InvalidProjectDocument,
	InvalidProjectFile,
	InvalidProjectName,
	ProjectConflict,
	type ProjectError,
	ProjectExists,
} from "#/projects/errors.ts";
import {
	PROJECT_FILE,
	parseProjectManifest,
	validateProjectDocument,
} from "#/projects/format.ts";
import {
	type ProjectDirectory,
	ProjectRepository,
} from "#/projects/repository.ts";
import { required } from "./helpers/required.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function memoryDirectory() {
	const files = new Map<string, Uint8Array>();
	const directory: ProjectDirectory = {
		name: "Project",
		async read(path) {
			const bytes = files.get(path);
			if (!bytes) throw new DOMException("Missing", "NotFoundError");
			return bytes;
		},
		async write(path, bytes) {
			files.set(path, bytes);
		},
		async remove(path) {
			for (const key of files.keys())
				if (key === path || key.startsWith(`${path}/`)) files.delete(key);
		},
	};
	const text = (path: string) => decoder.decode(files.get(path));
	const edit = (path: string, change: (content: string) => string) =>
		files.set(path, encoder.encode(change(text(path))));
	return { files, directory, text, edit };
}

async function rejection<T extends ProjectError>(
	promise: Promise<unknown>,
	type: abstract new (...args: never[]) => T,
): Promise<T> {
	try {
		await promise;
	} catch (cause) {
		assert.ok(cause instanceof type, `expected ${type.name}, got ${cause}`);
		assert.ok(cause instanceof Error);
		return cause;
	}
	assert.fail(`expected ${type.name}`);
}

const rectangle = (id: number) => ({
	id,
	kind: "rectangle" as const,
	x: 0,
	y: 0,
	width: 10,
	height: 10,
	rotation: 0,
	lineWidth: 1,
});

for (const layout of ["files", "revisions"] as const)
	test(`a manifest changed on disk rejects saves with ProjectConflict in the ${layout} layout`, async () => {
		const { directory, edit } = memoryDirectory();
		const repository = new ProjectRepository(directory, { layout });
		await repository.create("Project");
		edit(PROJECT_FILE, (content) => `${content}\n# edited elsewhere\n`);
		const conflict = await rejection(
			repository.save({ shapes: [], symbols: [] }),
			ProjectConflict,
		);
		assert.equal(conflict._tag, "ProjectConflict");
		assert.equal(conflict.path, PROJECT_FILE);
		await rejection(
			repository.save({ shapes: [], symbols: [] }),
			ProjectConflict,
		);
		await rejection(
			repository.importAssets([
				{ name: "board.step", kind: "step", bytes: new Uint8Array([1]) },
			]),
			ProjectConflict,
		);
		await repository.load();
		await repository.save({ shapes: [rectangle(1)], symbols: [] });
	});

for (const layout of ["files", "revisions"] as const)
	test(`concurrent saves from two repositories keep the first edit and reject the second in the ${layout} layout`, async () => {
		const { directory } = memoryDirectory();
		await new ProjectRepository(directory, { layout }).create("Project");
		const first = new ProjectRepository(directory, { layout });
		const second = new ProjectRepository(directory, { layout });
		await Promise.all([first.load(), second.load()]);
		const [kept, lost] = await Promise.allSettled([
			first.save({ shapes: [rectangle(1)], symbols: [] }),
			second.save({ shapes: [rectangle(2)], symbols: [] }),
		]);
		assert.equal(kept.status, "fulfilled");
		await rejection(
			lost.status === "rejected"
				? Promise.reject(lost.reason)
				: Promise.resolve(),
			ProjectConflict,
		);
		const reopened = await new ProjectRepository(directory, { layout }).load();
		assert.deepEqual(
			reopened.shapes.map((shape) => shape.id),
			[1],
		);
		await second.load();
		await second.save({ shapes: [rectangle(1), rectangle(2)], symbols: [] });
		assert.deepEqual(
			(await new ProjectRepository(directory, { layout }).load()).shapes.map(
				(shape) => shape.id,
			),
			[1, 2],
		);
	});

test("a changed or deleted project file names that file in ProjectConflict", async () => {
	const { directory, files, edit } = memoryDirectory();
	const repository = new ProjectRepository(directory, { layout: "files" });
	await repository.create("Project");
	const saved = await repository.save({ shapes: [rectangle(1)], symbols: [] });
	const drawing = required(saved.manifest.drawing);
	edit(drawing, (content) => content.replace('"x":0', '"x":5'));
	assert.equal(
		(
			await rejection(
				repository.save({ shapes: [], symbols: [] }),
				ProjectConflict,
			)
		).path,
		drawing,
	);
	await repository.load();
	files.delete(drawing);
	assert.equal(
		(
			await rejection(
				repository.save({ shapes: [], symbols: [] }),
				ProjectConflict,
			)
		).path,
		drawing,
	);
});

test("creating a project over an existing one rejects with ProjectExists", async () => {
	const { directory } = memoryDirectory();
	await new ProjectRepository(directory).create("Project");
	await rejection(
		new ProjectRepository(directory).create("Other"),
		ProjectExists,
	);
	await rejection(
		new ProjectRepository(memoryDirectory().directory).create("a/b"),
		InvalidProjectName,
	);
});

test("invalid project files reject with InvalidProjectFile naming the file", async () => {
	const load = async (
		change: (
			project: ReturnType<typeof memoryDirectory>,
			drawing: string,
		) => void,
	) => {
		const project = memoryDirectory();
		const repository = new ProjectRepository(project.directory, {
			layout: "files",
		});
		await repository.create("Project");
		const saved = await repository.save({
			shapes: [rectangle(1)],
			symbols: [],
		});
		change(project, required(saved.manifest.drawing));
		return rejection(
			new ProjectRepository(project.directory, { layout: "files" }).load(),
			InvalidProjectFile,
		);
	};
	const toml = await load(({ files }) =>
		files.set(PROJECT_FILE, encoder.encode("format = [")),
	);
	assert.equal(toml.path, PROJECT_FILE);

	const version = await load(({ edit }) =>
		edit(PROJECT_FILE, (content) =>
			content.replace("version = 1", "version = 2"),
		),
	);
	assert.equal(version.path, PROJECT_FILE);
	assert.match(version.reason, /^version: /);

	const json = await load(({ files }, drawing) =>
		files.set(drawing, encoder.encode("{ not json")),
	);
	assert.equal(json.path, "Project.ecaddraw");

	const shape = await load(({ edit }, drawing) =>
		edit(drawing, (content) => content.replace('"width":10', '"width":"wide"')),
	);
	assert.equal(shape.path, "Project.ecaddraw");
	assert.match(shape.reason, /^shapes\.0\b/);

	const missing = await load(({ files }, drawing) => files.delete(drawing));
	assert.equal(missing.path, "Project.ecaddraw");

	const notObject = await load(({ files }, drawing) =>
		files.set(drawing, encoder.encode("[]")),
	);
	assert.equal(notObject.path, "Project.ecaddraw");
});

test("saving an invalid document rejects with InvalidProjectDocument and writes nothing", async () => {
	const { directory, files } = memoryDirectory();
	const repository = new ProjectRepository(directory, { layout: "files" });
	await repository.create("Project");
	const before = new Map(files);
	await rejection(
		repository.save({ shapes: [rectangle(1), rectangle(1)], symbols: [] }),
		InvalidProjectDocument,
	);
	const shape = await rejection(
		repository.save({
			shapes: [{ ...rectangle(1), width: "wide" } as never],
			symbols: [],
		}),
		InvalidProjectDocument,
	);
	assert.match(shape.reason, /^shapes\.0\.width: /);
	const libraries = await rejection(
		repository.save({
			shapes: [],
			symbols: [],
			symbolLibraries: [
				{
					id: "parts",
					name: "Parts",
					enabled: true,
					source: { kind: "directory", path: 5 },
				},
			] as never,
		}),
		InvalidProjectDocument,
	);
	assert.match(libraries.reason, /^symbolLibraries\.0\.source\.path\b/);
	assert.deepEqual(files, before);
	assert.throws(
		() =>
			validateProjectDocument({
				shapes: [],
				drawings: [
					{ id: "a", name: "A", shapes: [] },
					{ id: "a", name: "B", shapes: [] },
				],
				symbols: [],
			}),
		InvalidProjectDocument,
	);
	assert.throws(
		() => parseProjectManifest("version = 1"),
		(error) =>
			error instanceof InvalidProjectFile && error.path === PROJECT_FILE,
	);
});
