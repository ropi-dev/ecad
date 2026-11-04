import assert from "node:assert/strict";
import { test } from "node:test";
import { Predicate } from "effect";
import {
	InvalidProjectDocument,
	InvalidProjectFile,
	InvalidProjectName,
	InvalidProjectPath,
	ProjectAssetNotFound,
	ProjectClosed,
	ProjectConflict,
	type ProjectError,
	ProjectExists,
	ProjectRollbackFailed,
	ProjectStorageUnavailable,
	projectErrorData,
	reviveProjectError,
	SymbolLibraryAccessDenied,
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
		assert.match(conflict.message, /changed on disk/);
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

test("a changed or deleted project file names that file in ProjectConflict", async () => {
	const { directory, files, edit } = memoryDirectory();
	const repository = new ProjectRepository(directory, { layout: "files" });
	await repository.create("Project");
	const saved = await repository.save({ shapes: [rectangle(1)], symbols: [] });
	edit(saved.manifest.drawing, (content) => content.replace('"x":0', '"x":5'));
	assert.equal(
		(
			await rejection(
				repository.save({ shapes: [], symbols: [] }),
				ProjectConflict,
			)
		).path,
		saved.manifest.drawing,
	);
	await repository.load();
	files.delete(saved.manifest.drawing);
	assert.equal(
		(
			await rejection(
				repository.save({ shapes: [], symbols: [] }),
				ProjectConflict,
			)
		).path,
		saved.manifest.drawing,
	);
});

test("saving before a project is loaded rejects with ProjectClosed", async () => {
	const { directory } = memoryDirectory();
	const closed = await rejection(
		new ProjectRepository(directory).save({ shapes: [], symbols: [] }),
		ProjectClosed,
	);
	assert.equal(closed._tag, "ProjectClosed");
	assert.match(closed.message, /no longer open/);
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

test("invalid project files reject with InvalidProjectFile naming the file and a readable reason", async () => {
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
		change(project, saved.manifest.drawing);
		return rejection(
			new ProjectRepository(project.directory, { layout: "files" }).load(),
			InvalidProjectFile,
		);
	};
	const toml = await load(({ files }) =>
		files.set(PROJECT_FILE, encoder.encode("format = [")),
	);
	assert.equal(toml.path, PROJECT_FILE);
	assert.equal(toml.reason, "The file is not valid TOML.");

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
	assert.equal(json.path, "Project/Project.ecaddraw");
	assert.equal(json.reason, "The file is not valid JSON.");

	const shape = await load(({ edit }, drawing) =>
		edit(drawing, (content) => content.replace('"width":10', '"width":"wide"')),
	);
	assert.equal(shape.path, "Project/Project.ecaddraw");
	assert.match(shape.reason, /^shapes\.0\b/);
	assert.doesNotMatch(shape.message, /[[{]\s*"/);
	assert.match(
		shape.message,
		/^The project file "Project\/Project\.ecaddraw" is invalid\. shapes\.0/,
	);

	const missing = await load(({ files }, drawing) => files.delete(drawing));
	assert.equal(missing.path, "Project/Project.ecaddraw");
	assert.match(missing.reason, /missing/);

	const notObject = await load(({ files }, drawing) =>
		files.set(drawing, encoder.encode("[]")),
	);
	assert.match(notObject.reason, /JSON object/);
});

test("an invalid symbol, drawing or circuit file is reported against that file", async () => {
	const project = memoryDirectory();
	const repository = new ProjectRepository(project.directory, {
		layout: "files",
	});
	await repository.create("Project");
	const saved = await repository.save({
		shapes: [],
		drawings: [{ id: "control", name: "Control", shapes: [rectangle(1)] }],
		symbols: [],
	});
	const reload = () =>
		rejection(
			new ProjectRepository(project.directory, { layout: "files" }).load(),
			InvalidProjectFile,
		);
	const drawing = required(saved.manifest.drawings)[0];
	const original = project.text(drawing);
	project.edit(drawing, (content) =>
		content.replace('"id":"control"', '"id":"Bad ID"'),
	);
	const invalidDrawing = await reload();
	assert.equal(invalidDrawing.path, drawing);
	assert.match(invalidDrawing.reason, /^id: /);
	project.files.set(drawing, encoder.encode(original));

	const circuit = required(
		required(saved.manifest.circuits).find(
			(paths) => paths.circuit === drawing,
		),
	).circuit;
	project.edit(circuit, (content) =>
		content.replace('"circuitId":"', '"circuitId":"other-'),
	);
	const identity = await reload();
	assert.equal(identity.path, circuit);
	assert.match(identity.reason, /circuit identity/);
	project.files.set(drawing, encoder.encode(original));

	project.edit(drawing, (content) =>
		content.replace('"format":"ecad-circuit"', '"format":"other"'),
	);
	const invalidCircuit = await reload();
	assert.equal(invalidCircuit.path, drawing);
	assert.match(invalidCircuit.reason, /^circuit\.format: /);
	project.files.set(drawing, encoder.encode(original));

	project.edit(PROJECT_FILE, (content) =>
		content.replace("symbols = []", 'symbols = [ "symbols/broken.ecadsym" ]'),
	);
	project.files.set("symbols/broken.ecadsym", encoder.encode("{}"));
	const symbol = await reload();
	assert.equal(symbol.path, "symbols/broken.ecadsym");
});

test("saving an invalid document rejects with InvalidProjectDocument and writes nothing", async () => {
	const { directory, files } = memoryDirectory();
	const repository = new ProjectRepository(directory, { layout: "files" });
	await repository.create("Project");
	const before = new Map(files);
	const duplicate = await rejection(
		repository.save({ shapes: [rectangle(1), rectangle(1)], symbols: [] }),
		InvalidProjectDocument,
	);
	assert.match(duplicate.message, /duplicate shape IDs/);
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
	assert.equal(
		libraries.reason,
		"symbolLibraries.0.source.path: Expected string, actual 5.",
	);
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
		(error) =>
			error instanceof InvalidProjectDocument &&
			/duplicate drawing IDs/.test(error.message),
	);
	assert.throws(
		() => parseProjectManifest("version = 1"),
		(error) =>
			error instanceof InvalidProjectFile && error.path === PROJECT_FILE,
	);
});

test("readAsset returns a rejected promise instead of throwing", async () => {
	const { directory } = memoryDirectory();
	const repository = new ProjectRepository(directory);
	await repository.create("Project");
	const imported = await repository.importAssets([
		{ name: "board.step", kind: "step", bytes: new Uint8Array([7]) },
	]);
	let outside: Promise<Uint8Array> | undefined;
	let unknown: Promise<Uint8Array> | undefined;
	assert.doesNotThrow(() => {
		outside = repository.readAsset("../secret");
		unknown = repository.readAsset("assets/other.step");
	});
	const path = await rejection(required(outside), InvalidProjectPath);
	assert.equal(path.path, "../secret");
	assert.equal(
		(await rejection(required(unknown), ProjectAssetNotFound)).path,
		"assets/other.step",
	);
	assert.deepEqual(
		await repository.readAsset(imported.manifest.assets[0].path),
		new Uint8Array([7]),
	);
});

test("project errors keep their tag and fields when rebuilt from transported data", () => {
	const errors: ProjectError[] = [
		new ProjectConflict({ path: PROJECT_FILE }),
		new ProjectClosed(),
		new ProjectExists(),
		new ProjectExists({ projectName: "Board" }),
		new InvalidProjectFile({
			path: "board.ecaddraw",
			reason: "The file is not valid JSON.",
			cause: new SyntaxError("x"),
		}),
		new InvalidProjectDocument({ reason: "Duplicate circuit identity." }),
		new InvalidProjectPath({ path: "../x", reason: "Outside." }),
		new InvalidProjectName({ projectName: "a/b", reason: "Invalid name." }),
		new ProjectAssetNotFound({ path: "assets/x" }),
		new ProjectStorageUnavailable(),
		new ProjectRollbackFailed({ cause: new AggregateError([]) }),
		new SymbolLibraryAccessDenied({ path: "/parts", reason: "Not allowed." }),
	];
	for (const error of errors) {
		const data = projectErrorData(error);
		assert.ok(data);
		assert.ok(!("cause" in data) && !("stack" in data));
		const revived = reviveProjectError(JSON.parse(JSON.stringify(data)));
		assert.ok(revived);
		assert.equal(revived.constructor, error.constructor);
		assert.equal(revived.message, error.message);
		assert.equal(revived.name, error.name);
		for (const key of ["path", "reason", "projectName"] as const)
			assert.equal(
				Predicate.hasProperty(revived, key) ? revived[key] : undefined,
				Predicate.hasProperty(error, key) ? error[key] : undefined,
			);
	}
	assert.equal(projectErrorData(new Error("plain")), undefined);
	assert.equal(reviveProjectError({ _tag: "SomethingElse" }), undefined);
});
