import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDrawingStore } from "@ecad/core/commands/drawing-store.ts";
import { parseSymbolFile } from "@ecad/core/components/editor/symbolFormat.ts";
import type { EditorShape } from "@ecad/core/drawing/shapes.ts";
import {
	InvalidProjectFile,
	InvalidProjectName,
	InvalidProjectPath,
	ProjectClosed,
	ProjectConflict,
	SymbolLibraryAccessDenied,
} from "@ecad/core/projects/errors.ts";
import {
	PROJECT_FILE,
	parseProjectManifest,
	projectNameSchema,
	projectPathSchema,
	serializeProjectManifest,
} from "@ecad/core/projects/format.ts";
import { ProjectRepository } from "@ecad/core/projects/repository.ts";
import type { ExternalLibraryRequest } from "#/main/library-approvals.ts";
import {
	createDesktopProjectDirectory,
	DesktopProjects,
} from "#/main/projects.ts";
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
const symbol = parseSymbolFile(
	JSON.stringify({
		format: "ecad-symbol",
		version: 1,
		units: "mm",
		id: "test-point",
		name: "Test point",
		description: "",
		prefix: "TP",
		value: "",
		shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
	}),
);

test("additional drawing files preserve paths, reject external edits and roll back failed saves", async () =>
	temporary(async (parent) => {
		const directory = await createDesktopProjectDirectory(parent);
		let fail = false;
		const repository = new ProjectRepository(
			{
				...directory,
				write: async (path, bytes) => {
					if (fail && path === PROJECT_FILE) throw new Error("Disk full");
					await directory.write(path, bytes);
				},
			},
			{ layout: "files" },
		);
		await repository.create("Drawings");
		const drawings = [
			{ id: "power", circuitId: "pcb-power", name: "Power", shapes: [shape] },
		];
		const saved = await repository.save({ shapes: [], symbols: [], drawings });
		assert.deepEqual(saved.manifest.drawings, ["Power/Power.ecaddraw"]);
		assert.deepEqual(
			(await new ProjectRepository(directory).load()).drawings,
			drawings,
		);
		fail = true;
		await assert.rejects(
			repository.save({
				shapes: [shape],
				symbols: [],
				drawings: [
					{ ...drawings[0], shapes: [] },
					{ id: "control", name: "Control", shapes: [] },
				],
			}),
			/Disk full/,
		);
		assert.deepEqual(
			(await new ProjectRepository(directory).load()).drawings,
			drawings,
		);
		assert.deepEqual(await readdir(join(parent, "Power")), ["Power.ecaddraw"]);
		fail = false;
		const next = await repository.save({ shapes: [shape], symbols: [] });
		assert.deepEqual(next.manifest.drawings, saved.manifest.drawings);
		await writeFile(
			join(parent, "Power/Power.ecaddraw"),
			JSON.stringify({ ...drawings[0], shapes: [] }),
		);
		await assert.rejects(
			repository.save({ shapes: [], symbols: [] }),
			/changed on disk/,
		);
	}));

async function temporary(run: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "ecad-project-"));
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("desktop projects round trip TOML, drawing IDs, standalone symbols and binary source files", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		assert.equal(await projects.load(), null);
		const created = await projects.create("Motor controller", parent);
		assert.equal(created.directory, join(parent, "Motor controller"));
		const saved = await projects.save(created.directory, {
			shapes: [shape],
			symbols: [symbol],
		});
		const bytes = new Uint8Array([0, 255, 10, 13, 128]);
		const imported = await projects.importAssets(saved.directory, [
			{ name: "board.zip", kind: "gerber", bytes },
		]);
		const content = await readFile(join(saved.directory, PROJECT_FILE), "utf8");
		assert.match(content, /format = "ecad-project"/);
		assert.match(content, /name = "Motor controller"/);
		assert.deepEqual(parseProjectManifest(content), imported.manifest);
		assert.deepEqual(
			JSON.parse(
				await readFile(
					join(saved.directory, imported.manifest.symbols[0]),
					"utf8",
				),
			),
			symbol,
		);
		const reopened = await new DesktopProjects(
			join(saved.directory, PROJECT_FILE),
		).load();
		assert.deepEqual(reopened, imported);
		assert.deepEqual(
			await projects.readAsset(
				saved.directory,
				imported.manifest.assets[0].path,
			),
			bytes,
		);
		assert.equal(
			createDrawingStore(reopened?.shapes).getSnapshot().nextShapeId,
			8,
		);
		assert.equal(
			created.manifest.drawing,
			"Motor controller/Motor controller.ecaddraw",
		);
		assert.equal(saved.manifest.drawing, created.manifest.drawing);
		assert.deepEqual(saved.manifest.symbols, ["symbols/test-point.ecadsym"]);
		assert.equal(imported.manifest.assets[0].path, "assets/board.zip");
		assert.deepEqual((await readdir(saved.directory)).sort(), [
			PROJECT_FILE,
			"Motor controller",
			"assets",
			"symbols",
		]);
	}));

test("project directories are isolated and stale renderer requests cannot access a previous project", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		const first = await projects.create("First", parent);
		await projects.save(first.directory, {
			shapes: [shape],
			symbols: [symbol],
		});
		const second = await projects.create("Second", parent);
		assert.deepEqual(second.shapes, []);
		assert.deepEqual(second.symbols, []);
		await assert.rejects(
			projects.save(first.directory, { shapes: [], symbols: [] }),
			ProjectClosed,
		);
		await assert.rejects(
			projects.readAsset(first.directory, "assets/test.step"),
			ProjectClosed,
		);
		const opened = await projects.openDirectory(first.directory);
		assert.deepEqual(opened.shapes, [shape]);
		assert.deepEqual(opened.symbols, [symbol]);
		await assert.rejects(projects.create("First", parent));
		await assert.rejects(projects.create("a/b", parent), InvalidProjectName);
		assert.deepEqual((await projects.load())?.shapes, [shape]);
	}));

test("a failed desktop manifest write restores the previous drawing and symbols", async () =>
	temporary(async (parent) => {
		const directory = await createDesktopProjectDirectory(parent);
		let fail = false;
		const repository = new ProjectRepository(
			{
				...directory,
				write: async (path, bytes) => {
					if (fail && path === PROJECT_FILE) throw new Error("Disk full");
					await directory.write(path, bytes);
				},
			},
			{ layout: "files" },
		);
		await repository.create("Controller");
		await repository.save({ shapes: [shape], symbols: [symbol] });
		const before = await readFile(join(parent, PROJECT_FILE), "utf8");
		fail = true;
		await assert.rejects(
			repository.save({
				shapes: [],
				symbols: [
					{ ...symbol, name: "Changed" },
					{ ...symbol, id: "new-symbol" },
				],
			}),
			/Disk full/,
		);
		assert.equal(await readFile(join(parent, PROJECT_FILE), "utf8"), before);
		const restored = await new ProjectRepository(directory).load();
		assert.deepEqual(restored.shapes, [shape]);
		assert.deepEqual(restored.symbols, [symbol]);
		assert.deepEqual(await readdir(join(parent, "symbols")), [
			"test-point.ecadsym",
		]);
		assert.deepEqual((await readdir(parent)).sort(), [
			PROJECT_FILE,
			"Controller",
			"symbols",
		]);
		await assert.rejects(
			repository.importAssets([
				{ name: "model.step", kind: "step", bytes: new Uint8Array([1]) },
			]),
			/Disk full/,
		);
		assert.deepEqual(await readdir(join(parent, "assets")), []);
		fail = false;
		assert.deepEqual(
			(await repository.save({ shapes: [], symbols: [symbol] })).symbols,
			[symbol],
		);
	}));

test("invalid documents and externally edited manifests do not replace the saved project", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		const created = await projects.create("Controller", parent);
		const original = await readFile(
			join(created.directory, PROJECT_FILE),
			"utf8",
		);
		await assert.rejects(
			projects.save(created.directory, { shapes: [shape, shape], symbols: [] }),
			/duplicate shape IDs/,
		);
		assert.equal(
			await readFile(join(created.directory, PROJECT_FILE), "utf8"),
			original,
		);
		await writeFile(
			join(created.directory, PROJECT_FILE),
			`${original}\n# external change\n`,
		);
		await assert.rejects(
			projects.save(created.directory, { shapes: [], symbols: [] }),
			/changed on disk/,
		);
		await projects.openDirectory(created.directory);
		await projects.save(created.directory, { shapes: [shape], symbols: [] });
	}));

test("project names, manifests and asset paths reject traversal and unsupported versions", () => {
	for (const name of [
		"",
		"../Other",
		"a/b",
		"a\\b",
		".",
		"..",
		"CON",
		"NUL.txt",
		"bad\0name",
	])
		assert.equal(projectNameSchema.safeParse(name).success, false);
	for (const path of [
		"../other",
		"/absolute",
		"C:/absolute",
		"assets/../../secret",
		"assets\\secret",
		"a//b",
		"a\0b",
	])
		assert.equal(projectPathSchema.safeParse(path).success, false);
	const manifest = {
		format: "ecad-project" as const,
		version: 1 as const,
		name: "Controller",
		drawing: "drawing.ecaddraw",
		symbols: [],
		assets: [],
	};
	assert.deepEqual(
		parseProjectManifest(serializeProjectManifest(manifest)),
		manifest,
	);
	assert.throws(() =>
		parseProjectManifest(
			serializeProjectManifest(manifest).replace("version = 1", "version = 2"),
		),
	);
});

test("desktop storage refuses symbolic link assets and nested symbolic link directories", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		const created = await projects.create("Controller", parent);
		const outside = join(parent, "outside.ecaddraw");
		await writeFile(outside, JSON.stringify({ shapes: [shape] }));
		const manifestPath = join(created.directory, PROJECT_FILE);
		const manifest = created.manifest;
		await symlink(outside, join(created.directory, "linked.ecaddraw"));
		await writeFile(
			manifestPath,
			serializeProjectManifest({ ...manifest, drawing: "linked.ecaddraw" }),
		);
		await assert.rejects(projects.openDirectory(created.directory));
		await mkdir(join(parent, "outside"));
		await symlink(join(parent, "outside"), join(created.directory, "linked"));
		const directory = await createDesktopProjectDirectory(created.directory);
		await assert.rejects(
			directory.write("linked/secret", new Uint8Array([1])),
			(error) =>
				error instanceof InvalidProjectPath &&
				/symbolic links/.test(error.message),
		);
		await assert.rejects(
			directory.read("../outside.ecaddraw"),
			InvalidProjectPath,
		);
		assert.deepEqual(JSON.parse(await readFile(outside, "utf8")), {
			shapes: [shape],
		});
	}));

test("directories without a project load as empty without creating project files", async () =>
	temporary(async (parent) => {
		assert.equal(await new DesktopProjects(parent).load(), null);
		assert.deepEqual(await readdir(parent), []);
		await writeFile(join(parent, PROJECT_FILE), "broken TOML [");
		await assert.rejects(
			new DesktopProjects(parent).load(),
			(error) =>
				error instanceof InvalidProjectFile && error.path === PROJECT_FILE,
		);
	}));

test("desktop imports preserve source filenames and never overwrite existing files", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		const created = await projects.create("Controller", parent);
		await mkdir(join(created.directory, "assets"));
		await writeFile(
			join(created.directory, "assets", "board.step"),
			"external model",
		);
		const bytes = new Uint8Array([0, 128, 255]);
		const inputs = ["board.step", "board.step", "layers.zip", "top.gbr"].map(
			(name) => ({
				name,
				kind: name.endsWith("step") ? ("step" as const) : ("gerber" as const),
				bytes,
			}),
		);
		const imported = await projects.importAssets(created.directory, inputs);
		assert.deepEqual(
			imported.manifest.assets.map((asset) => asset.path),
			[
				"assets/board-2.step",
				"assets/board-3.step",
				"assets/layers.zip",
				"assets/top.gbr",
			],
		);
		assert.equal(
			await readFile(join(created.directory, "assets", "board.step"), "utf8"),
			"external model",
		);
		for (const asset of imported.manifest.assets)
			assert.deepEqual(
				await projects.readAsset(created.directory, asset.path),
				bytes,
			);
		await mkdir(join(created.directory, "assets", "board-4.step"));
		const again = await projects.importAssets(created.directory, [
			{ name: "board.step", kind: "step", bytes },
		]);
		assert.equal(again.manifest.assets.at(-1)?.path, "assets/board-5.step");
		assert.deepEqual(
			await readdir(join(created.directory, "assets", "board-4.step")),
			[],
		);
		assert.equal((await readdir(created.directory)).includes(".ecad"), false);
	}));

test("direct drawing and symbol edits reject stale desktop saves and imports", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		const created = await projects.create("Controller", parent);
		const saved = await projects.save(created.directory, {
			shapes: [shape],
			symbols: [symbol],
		});
		const drawingPath = join(saved.directory, saved.manifest.drawing);
		const symbolPath = join(saved.directory, saved.manifest.symbols[0]);
		await writeFile(
			drawingPath,
			JSON.stringify({
				...JSON.parse(await readFile(drawingPath, "utf8")),
				shapes: [],
			}),
		);
		await assert.rejects(
			projects.save(saved.directory, { shapes: [shape], symbols: [symbol] }),
			(error) =>
				error instanceof ProjectConflict &&
				error.path === saved.manifest.drawing,
		);
		await assert.rejects(
			projects.importAssets(saved.directory, [
				{ name: "model.step", kind: "step", bytes: new Uint8Array([1]) },
			]),
			ProjectConflict,
		);
		await projects.openDirectory(saved.directory);
		await writeFile(
			symbolPath,
			JSON.stringify({ ...symbol, name: "External edit" }),
		);
		await assert.rejects(
			projects.save(saved.directory, { shapes: [], symbols: [] }),
			/changed on disk/,
		);
		assert.equal(
			JSON.parse(await readFile(symbolPath, "utf8")).name,
			"External edit",
		);
		const reopened = await projects.openDirectory(saved.directory);
		assert.equal(reopened.symbols[0].name, "External edit");
		await projects.save(saved.directory, {
			shapes: [shape],
			symbols: reopened.symbols,
		});
	}));

test("desktop saves retain drawing and symbol paths in user subdirectories", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		const created = await projects.create("Controller", parent);
		await projects.save(created.directory, {
			shapes: [shape],
			symbols: [symbol],
		});
		const directory = await createDesktopProjectDirectory(created.directory);
		await directory.write(
			"drawings/controller.ecaddraw",
			new TextEncoder().encode(JSON.stringify({ shapes: [shape] })),
		);
		await directory.write(
			"library/points.ecadsym",
			new TextEncoder().encode(JSON.stringify(symbol)),
		);
		const manifestPath = join(created.directory, PROJECT_FILE);
		const manifest = parseProjectManifest(await readFile(manifestPath, "utf8"));
		await writeFile(
			manifestPath,
			serializeProjectManifest({
				...manifest,
				drawing: "drawings/controller.ecaddraw",
				symbols: ["library/points.ecadsym"],
			}),
		);
		await projects.openDirectory(created.directory);
		const saved = await projects.save(created.directory, {
			shapes: [],
			symbols: [symbol],
		});
		assert.equal(saved.manifest.drawing, "drawings/controller.ecaddraw");
		assert.deepEqual(saved.manifest.symbols, ["library/points.ecadsym"]);
		assert.deepEqual(await new DesktopProjects(saved.directory).load(), saved);
	}));

test("desktop project directory libraries resolve within their project and survive reopening", async (t) => {
	const parent = await mkdtemp(join(tmpdir(), "ecad-project-libraries-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	// Libraries inside the project never need approval.
	const projects = new DesktopProjects(undefined, {
		approveExternalLibrary: async () =>
			assert.fail("An in-project library needs no approval."),
	});
	const project = await projects.create("Library project", parent);
	const libraryPath = join(project.directory, "libraries");
	await mkdir(libraryPath);
	await writeFile(
		join(libraryPath, "test-point.ecadsym"),
		JSON.stringify(symbol),
	);
	const symbolLibraries = [
		{
			id: "local",
			name: "Local parts",
			enabled: true,
			source: { kind: "directory" as const, path: "libraries" },
		},
	];
	await projects.save(project.directory, {
		shapes: [],
		symbols: [],
		symbolLibraries,
	});
	assert.deepEqual(
		await projects.readSymbolLibrary(project.directory, "libraries"),
		[symbol],
	);
	await assert.rejects(
		projects.readSymbolLibrary(project.directory, "../"),
		/not configured/,
	);
	const reopened = new DesktopProjects(project.directory);
	assert.deepEqual((await reopened.load())?.symbolLibraries, symbolLibraries);
	assert.deepEqual(
		await reopened.readSymbolLibrary(project.directory, "libraries"),
		[symbol],
	);
	assert.deepEqual(
		await reopened.inspectLibrarySymbol(
			project.directory,
			"libraries",
			symbol.id,
		),
		{ file: symbol, writable: true },
	);
	const next = { ...symbol, name: "Edited test point" };
	await reopened.saveLibrarySymbol(
		project.directory,
		"libraries",
		symbol,
		next,
	);
	assert.deepEqual(
		parseSymbolFile(
			await readFile(join(libraryPath, "test-point.ecadsym"), "utf8"),
		),
		next,
	);
});

/** A downloaded project whose manifest names directory libraries. */
async function downloadedProject(parent: string, paths: string[]) {
	const writer = new DesktopProjects();
	const created = await writer.create("Downloaded", parent);
	const symbolLibraries = paths.map((path, index) => ({
		id: `library-${index}`,
		name: `Library ${index}`,
		enabled: true,
		source: { kind: "directory" as const, path },
	}));
	await writer.save(created.directory, {
		shapes: [],
		symbols: [],
		symbolLibraries,
	});
	return created.directory;
}

test("project manifests cannot read or overwrite libraries outside the project without approval", async () =>
	temporary(async (parent) => {
		const home = join(parent, "home");
		const outside = join(home, "outside");
		await mkdir(outside, { recursive: true });
		const filename = join(outside, "secret.ecadsym");
		await writeFile(filename, JSON.stringify(symbol));
		const paths = ["../home/outside", outside, "~/outside"];
		const directory = await downloadedProject(parent, paths);
		const next = { ...symbol, shapes: [] };

		const unapproved = new DesktopProjects(undefined, { homeDirectory: home });
		await unapproved.openDirectory(directory);
		for (const path of paths) {
			await assert.rejects(
				unapproved.readSymbolLibrary(directory, path),
				/outside the project directory/,
			);
			await assert.rejects(
				unapproved.inspectLibrarySymbol(directory, path, symbol.id),
				/outside the project directory/,
			);
			await assert.rejects(
				unapproved.saveLibrarySymbol(directory, path, symbol, next),
				/outside the project directory/,
			);
		}
		assert.deepEqual(JSON.parse(await readFile(filename, "utf8")), symbol);

		const asked: ExternalLibraryRequest[] = [];
		const refusing = new DesktopProjects(undefined, {
			homeDirectory: home,
			approveExternalLibrary: async (request, { prompt }) => {
				if (prompt) asked.push(request);
				return false;
			},
		});
		await refusing.openDirectory(directory);
		for (const path of paths)
			await assert.rejects(
				refusing.readSymbolLibrary(directory, path),
				/not allowed/,
			);
		await assert.rejects(
			refusing.saveLibrarySymbol(directory, paths[0], symbol, next),
			/not allowed/,
		);
		// All three paths name one real directory. A refusal holds until the project reopens.
		assert.deepEqual(asked, [
			{ project: directory, directory: await realpath(outside) },
		]);
		await refusing.openDirectory(directory);
		await assert.rejects(
			refusing.readSymbolLibrary(directory, paths[1]),
			/not allowed/,
		);
		assert.equal(asked.length, 2);
		assert.deepEqual(JSON.parse(await readFile(filename, "utf8")), symbol);

		const approving = new DesktopProjects(undefined, {
			homeDirectory: home,
			approveExternalLibrary: async () => true,
		});
		await approving.openDirectory(directory);
		for (const path of paths)
			assert.deepEqual(await approving.readSymbolLibrary(directory, path), [
				symbol,
			]);
		await approving.saveLibrarySymbol(directory, "~/outside", symbol, next);
		assert.deepEqual(JSON.parse(await readFile(filename, "utf8")), next);
		// The approval was never written into the project.
		assert.equal(
			(await readFile(join(directory, PROJECT_FILE), "utf8")).includes(
				"approved",
			),
			false,
		);
	}));

test("choosing a refused directory with Add library directory approves it without asking again", async () =>
	temporary(async (parent) => {
		const { ExternalLibraryApprovals } = await import(
			"#/main/library-approvals.ts"
		);
		const { DesktopSymbolLibrary } = await import("#/main/symbol-library.ts");
		const home = join(parent, "home");
		const outside = join(parent, "outside");
		await mkdir(home);
		await mkdir(outside);
		await writeFile(join(outside, "point.ecadsym"), JSON.stringify(symbol));
		const directory = await downloadedProject(parent, ["../outside"]);
		// These are wired as in main.ts.
		const library = new DesktopSymbolLibrary(undefined, home);
		let prompts = 0;
		const approvals = new ExternalLibraryApprovals({
			homeDirectory: home,
			chosen: (path) => library.isChosenDirectory(path),
			confirm: async () => {
				prompts++;
				return false;
			},
		});
		const projects = new DesktopProjects(undefined, {
			homeDirectory: home,
			approveExternalLibrary: (request, options) =>
				approvals.approve(request, options),
		});
		await projects.openDirectory(directory);
		await assert.rejects(
			projects.readSymbolLibrary(directory, "../outside"),
			/not allowed/,
		);
		await assert.rejects(
			projects.readSymbolLibrary(directory, "../outside"),
			/not allowed/,
		);
		assert.equal(prompts, 1);
		await library.openLibraryDirectory(outside, "Outside");
		assert.deepEqual(
			await projects.readSymbolLibrary(directory, "../outside"),
			[symbol],
		);
		assert.equal(prompts, 1);
		// The picker approval is remembered for this project after a restart.
		const restarted = new DesktopProjects(undefined, {
			homeDirectory: home,
			approveExternalLibrary: (request, options) =>
				new ExternalLibraryApprovals({ homeDirectory: home }).approve(
					request,
					options,
				),
		});
		await restarted.openDirectory(directory);
		assert.deepEqual(
			await restarted.readSymbolLibrary(directory, "../outside"),
			[symbol],
		);
	}));

test("symbolic links cannot move a project library outside the project", async () =>
	temporary(async (parent) => {
		const outside = join(parent, "outside");
		await mkdir(outside);
		await writeFile(join(outside, "secret.ecadsym"), JSON.stringify(symbol));
		const directory = await downloadedProject(parent, ["linked", "parts"]);
		await symlink(outside, join(directory, "linked"), "dir");
		await mkdir(join(directory, "parts"));
		await symlink(outside, join(directory, "parts", "nested"), "dir");
		const local = parseSymbolFile(
			JSON.stringify({ ...symbol, id: "local-point" }),
		);
		await writeFile(
			join(directory, "parts", "local.ecadsym"),
			JSON.stringify(local),
		);
		const asked: ExternalLibraryRequest[] = [];
		const projects = new DesktopProjects(undefined, {
			approveExternalLibrary: async (request, { prompt }) => {
				if (prompt) asked.push(request);
				return false;
			},
		});
		await projects.openDirectory(directory);
		await assert.rejects(
			projects.readSymbolLibrary(directory, "linked"),
			(error) =>
				error instanceof SymbolLibraryAccessDenied &&
				/outside the project directory/.test(error.message),
		);
		await assert.rejects(
			projects.saveLibrarySymbol(directory, "linked", symbol, {
				...symbol,
				shapes: [],
			}),
			/outside the project directory/,
		);
		// Approval names the real target, so the user sees where the link leads.
		assert.deepEqual(asked, [
			{ project: directory, directory: await realpath(outside) },
		]);
		// Nested links inside an in-project library are not followed.
		assert.deepEqual(await projects.readSymbolLibrary(directory, "parts"), [
			local,
		]);
		assert.equal(asked.length, 1);
		assert.deepEqual(
			JSON.parse(await readFile(join(outside, "secret.ecadsym"), "utf8")),
			symbol,
		);
	}));

test("untitled projects ask before using directory libraries and reject relative paths", async () =>
	temporary(async (parent) => {
		await writeFile(join(parent, "point.ecadsym"), JSON.stringify(symbol));
		const asked: ExternalLibraryRequest[] = [];
		const projects = new DesktopProjects(undefined, {
			approveExternalLibrary: async (request) => {
				asked.push(request);
				return true;
			},
		});
		const created = await projects.createUntitled();
		await projects.save(created.directory, {
			shapes: [],
			symbols: [],
			symbolLibraries: [
				{
					id: "relative",
					name: "Relative",
					enabled: true,
					source: { kind: "directory", path: "parts" },
				},
				{
					id: "chosen",
					name: "Chosen",
					enabled: true,
					source: { kind: "directory", path: parent },
				},
			],
		});
		await assert.rejects(
			projects.readSymbolLibrary(created.directory, "parts"),
			/Save the project/,
		);
		assert.deepEqual(
			await projects.readSymbolLibrary(created.directory, parent),
			[symbol],
		);
		assert.deepEqual(asked, [
			{ project: created.directory, directory: await realpath(parent) },
		]);
	}));

test("edits writable relative project directory symbols and checks project file permissions", async () =>
	temporary(async (parent) => {
		const { chmod } = await import("node:fs/promises");
		const approved: ExternalLibraryRequest[] = [];
		const projects = new DesktopProjects(undefined, {
			approveExternalLibrary: async (request) => {
				approved.push(request);
				return true;
			},
		});
		const project = await projects.create("Editing", parent);
		await projects.save(project.directory, {
			shapes: [],
			symbols: [symbol],
			symbolLibraries: [
				{
					id: "outside",
					name: "Outside",
					enabled: true,
					source: { kind: "directory", path: "../parts" },
				},
			],
		});
		const path = join(parent, "parts");
		await mkdir(path);
		await writeFile(join(path, "other-name.json"), JSON.stringify(symbol));
		assert.deepEqual(
			await projects.inspectLibrarySymbol(
				project.directory,
				"../parts",
				symbol.id,
			),
			{ file: symbol, writable: true },
		);
		const next = { ...symbol, shapes: [] };
		await projects.saveLibrarySymbol(
			project.directory,
			"../parts",
			symbol,
			next,
		);
		assert.deepEqual(
			await projects.readSymbolLibrary(project.directory, "../parts"),
			[next],
		);
		await assert.rejects(
			projects.saveLibrarySymbol(project.directory, "..", symbol, next),
			/not configured/,
		);
		assert.deepEqual(
			approved,
			Array.from({ length: 3 }, () => ({
				project: project.directory,
				directory: path,
			})),
		);
		const snapshot = required(await projects.load());
		const symbolPath = snapshot.manifest.symbols[0];
		assert.equal(
			await projects.canWriteFile(project.directory, symbolPath),
			true,
		);
		await chmod(join(project.directory, symbolPath), 0o444);
		assert.equal(
			await projects.canWriteFile(project.directory, symbolPath),
			false,
		);
		assert.equal(
			await projects.canWriteFile(project.directory, snapshot.manifest.drawing),
			true,
		);
		await chmod(join(project.directory, symbolPath), 0o644);
		await assert.rejects(
			projects.canWriteFile(parent, symbolPath),
			/no longer open/,
		);
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
	assert.equal(
		await projects.canWriteFile(second.directory, second.manifest.drawing),
		true,
	);
	assert.equal(await new DesktopProjects().load(), null);
	await assert.rejects(
		projects.save(first.directory, { shapes: [], symbols: [] }),
		/no longer open/,
	);
});

test("saving an in-memory project preserves drawings, circuits, libraries and binary sources", async () =>
	temporary(async (parent) => {
		const { createCircuit } = await import(
			"@ecad/drawing-core/circuit/model.ts"
		);
		const projects = new DesktopProjects();
		const created = await projects.createUntitled();
		const edited = await projects.save(created.directory, {
			shapes: [shape],
			symbols: [symbol],
			drawings: [
				{ id: "power", circuitId: "pcb-power", name: "Power", shapes: [shape] },
			],
			circuits: [createCircuit("Power supply")],
			symbolLibraries: [
				{
					id: "project-symbols",
					name: "Project symbols",
					enabled: true,
					source: { kind: "embedded", symbols: [symbol] },
				},
			],
		});
		assert.equal(edited.inMemory, true);
		assert.deepEqual(await readdir(parent), []);
		const bytes = new Uint8Array([0, 255, 13, 128]);
		const imported = await projects.importAssets(created.directory, [
			{ name: "model.step", kind: "step", bytes },
		]);
		bytes.fill(42);
		const asset = imported.manifest.assets[0];
		assert.deepEqual(
			await projects.readAsset(created.directory, asset.path),
			new Uint8Array([0, 255, 13, 128]),
		);
		const saved = await projects.saveToDirectory(created.directory, parent);
		assert.equal(saved.inMemory, undefined);
		assert.equal(saved.directory, join(parent, "Untitled"));
		const { directory, inMemory, ...expected } = imported;
		const { directory: savedDirectory, ...actual } = saved;
		assert.deepEqual(actual, expected);
		assert.deepEqual(await new DesktopProjects(saved.directory).load(), saved);
		assert.deepEqual(
			await projects.readAsset(saved.directory, asset.path),
			new Uint8Array([0, 255, 13, 128]),
		);
		await assert.rejects(
			projects.readAsset(created.directory, asset.path),
			/no longer open/,
		);
		const next = await projects.save(saved.directory, { ...saved, shapes: [] });
		assert.deepEqual(
			(await new DesktopProjects(saved.directory).load())?.shapes,
			next.shapes,
		);
	}));

test("failed memory export preserves the project and does not overwrite an existing folder", async () =>
	temporary(async (parent) => {
		const projects = new DesktopProjects();
		const created = await projects.createUntitled();
		await projects.save(created.directory, {
			shapes: [shape],
			symbols: [symbol],
		});
		await mkdir(join(parent, "Untitled"));
		await writeFile(join(parent, "Untitled", "keep.txt"), "Keep this file");
		await assert.rejects(
			projects.saveToDirectory(created.directory, join(parent, "missing")),
			{ code: "ENOENT" },
		);
		assert.equal(
			await readFile(join(parent, "Untitled", "keep.txt"), "utf8"),
			"Keep this file",
		);
		assert.equal((await projects.load())?.inMemory, true);
		assert.deepEqual((await projects.load())?.shapes, [shape]);
		const saved = await projects.saveToDirectory(created.directory, parent);
		assert.equal(saved.directory, join(parent, "Untitled 2"));
		assert.equal(saved.inMemory, undefined);
		assert.equal(
			await readFile(join(parent, "Untitled", "keep.txt"), "utf8"),
			"Keep this file",
		);
		const next = await projects.createUntitled();
		assert.equal(
			(await projects.saveToDirectory(next.directory, parent)).directory,
			join(parent, "Untitled 3"),
		);
	}));
