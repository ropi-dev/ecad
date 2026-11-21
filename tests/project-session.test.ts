import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { trackSegment } from "@ecad/drawing-core/board/geometry.ts";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import {
	redoEffect,
	removeShapesEffect,
	setPagesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { createEmptySymbolFile } from "#/components/editor/symbolFormat.ts";
import { InvalidFile } from "#/formats/import-effects.ts";
import {
	MAX_GERBER_ARCHIVE_BYTES,
	MAX_KICAD_FILE_BYTES,
	MAX_STEP_FILE_BYTES,
} from "#/formats/import-limits.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { ProjectAssetTooLarge, ProjectConflict } from "#/projects/errors.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { createProjectSession } from "#/projects/ProjectSession.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import { projectIndex } from "#/projects/project-index.ts";
import { assembleProjectSave } from "#/projects/save-assembly.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.ts";
import { installKiCadWorker } from "./helpers/kicad-worker.ts";
import { required } from "./helpers/required.ts";

const rectangle = {
	id: 1,
	kind: "rectangle" as const,
	x: 0,
	y: 0,
	width: 10,
	height: 6,
	rotation: 0,
	lineWidth: 0.3,
};
function snapshot(): ProjectSnapshot {
	return {
		directory: "test",
		manifest: {
			format: "ecad-project",
			version: 1,
			name: "Test",
			drawing: "main.ecaddraw",
			symbols: [],
			assets: [],
		},
		shapes: [],
		symbols: [],
	};
}
const symbols: SymbolLibraryStorage = {
	mode: "memory",
	async load() {
		return { symbols: [] };
	},
	async save() {
		return "Saved";
	},
};
function fixture(initial = snapshot()) {
	let current = initial;
	let saves = 0;
	let failure: Error | undefined;
	const storage: ProjectStorage = {
		mode: "web",
		async load() {
			return current;
		},
		async list() {
			return [];
		},
		async open() {
			return current;
		},
		async create() {
			return current;
		},
		async save(_directory, document) {
			saves++;
			if (failure) throw failure;
			current = { ...current, ...document };
			return current;
		},
		async importAssets() {
			return current;
		},
		async readAsset() {
			return new Uint8Array();
		},
	};
	const session = createProjectSession(storage, symbols);
	return {
		session,
		storage,
		get saves() {
			return saves;
		},
		fail(error?: Error) {
			failure = error;
		},
		replace(next: ProjectSnapshot) {
			current = next;
		},
	};
}
async function loaded(session: ReturnType<typeof createProjectSession>) {
	await new Promise<void>((resolve) => {
		const stop = session.subscribe(() => {
			if (!session.getSnapshot().busy) {
				stop();
				resolve();
			}
		});
	});
}

test("save assembly merges all editor inputs without mutating saved files or unrelated libraries", () => {
	const symbol = createEmptySymbolFile("Part", []);
	const drawing = { id: "extra", name: "Extra", shapes: [] };
	const library = {
		id: "project-symbols",
		name: "Project symbols",
		enabled: true,
		source: { kind: "embedded" as const, symbols: [symbol] },
	};
	const unrelated = { ...library, id: "other" };
	const circuit = createCircuit("Main", primaryPcbId);
	const document = assembleProjectSave({
		symbols: [symbol],
		libraries: [library, unrelated],
		pending: new Map([[symbol.id, [rectangle]]]),
		mainShapes: [],
		drawings: [drawing],
		drawingEdits: new Map([
			[drawing.id, { shapes: [rectangle], pages: [{ id: 4, name: "Power" }] }],
		]),
		savedCircuits: [circuit],
	});
	assert.equal(symbol.shapes.length, 0);
	assert.equal(drawing.shapes.length, 0);
	assert.equal(document.symbols[0].shapes.length, 1);
	assert.deepEqual(document.drawings?.[0].shapes, [rectangle]);
	assert.deepEqual(document.drawings?.[0].pages, [{ id: 4, name: "Power" }]);
	assert.ok(!("pages" in document));
	assert.equal(document.circuits?.[0], circuit);
	assert.equal(document.symbolLibraries[1], unrelated);
	const embedded = document.symbolLibraries[0].source;
	assert.equal(embedded.kind, "embedded");
	if (embedded.kind === "embedded")
		assert.equal(embedded.symbols, document.symbols);
	const empty = assembleProjectSave({
		symbols: [],
		libraries: [],
		pending: new Map(),
		mainShapes: [],
		drawingEdits: new Map(),
	});
	assert.ok(!("drawings" in empty));
	assert.ok(!("circuits" in empty));
});

test("conflict pauses autosave and reload discards edits without writing them", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const conflict = new ProjectConflict({ path: ".ecadprj" });
	f.fail(conflict);
	const store = f.session.getSnapshot().store;
	store.transact((current) => [undefined, { ...current, shapes: [rectangle] }]);
	await assert.rejects(() => f.session.getSnapshot().save(), ProjectConflict);
	assert.equal(f.session.getSnapshot().conflict, true);
	const count = f.saves;
	store.transact((current) => [
		undefined,
		{ ...current, shapes: [rectangle, { ...rectangle, id: 2 }] },
	]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.saves, count);
	f.fail();
	f.replace(snapshot());
	await f.session.getSnapshot().reload();
	assert.equal(f.saves, count);
	assert.equal(f.session.getSnapshot().dirty, false);
	assert.equal(f.session.getSnapshot().conflict, false);
	assert.deepEqual(f.session.getSnapshot().store.getSnapshot().shapes, []);
	stop();
});

test("a save that lands during a drag keeps it, and the drag commits with working undo", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const store = f.session.getSnapshot().store;
	const editor = createEditorSession(store);
	let cancelled = 0;
	const disconnect = editor.connect(store, () => cancelled++);
	cancelled = 0;
	editor.place([rectangle], "Draw rectangle");
	await f.session.getSnapshot().save();
	const placed = store.getSnapshot().shapes;

	// The drag starts while this edit's save is still running.
	editor.place([{ ...rectangle, id: 2, x: 30 }], "Draw second rectangle");
	const saving = f.session.getSnapshot().save();
	const initial = editor.shapes();
	const moved = { ...initial[0], x: initial[0].x + 7 };
	editor.select(new Set([moved.id]));
	editor.preview(
		initial.map((shape) => (shape.id === moved.id ? moved : shape)),
	);
	await saving;
	assert.equal(
		store.getSnapshot().shapes,
		initial,
		"the save kept the store's equal shapes",
	);
	assert.equal(cancelled, 0);
	assert.notEqual(editor.getState().draft, null);

	const before = new Map(initial.map((shape) => [shape.id, shape]));
	editor.replace(
		editor.shapes().filter((shape) => shape !== before.get(shape.id)),
		"Move selection",
	);
	assert.deepEqual(store.getSnapshot().shapes, [moved, initial[1]]);
	editor.restore(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, initial);
	editor.restore(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, placed);
	editor.restore(redoEffect);
	editor.restore(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [moved, initial[1]]);
	assert.equal(cancelled, 0);
	await f.session.getSnapshot().save();
	disconnect();
	stop();
});

test("schematic import parses in the KiCad worker and rejects oversized files without saving", async (t) => {
	const installed = installKiCadWorker();
	t.after(installed.restore);
	const f = fixture();
	// Real storage assigns each drawing a file path when it is saved.
	const save = f.storage.save.bind(f.storage);
	f.storage.save = async (...args) => {
		const saved = await save(...args);
		return {
			...saved,
			manifest: {
				...saved.manifest,
				drawings: saved.drawings?.map((drawing) => `${drawing.id}.ecaddraw`),
			},
		};
	};
	const stop = f.session.connect();
	await loaded(f.session);
	const oversized = new File(["(kicad_sch)"], "huge.kicad_sch");
	Object.defineProperty(oversized, "size", { value: MAX_KICAD_FILE_BYTES + 1 });
	const before = f.saves;
	await assert.rejects(
		f.session.getSnapshot().importSchematic(oversized),
		InvalidFile,
	);
	assert.equal(f.saves, before);
	assert.equal(installed.workers.length, 0);
	const source = readFileSync(
		new URL(
			"./fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch",
			import.meta.url,
		),
		"utf8",
	);
	const expected = importKiCadSchematic(source);
	const { path, report } = await f.session
		.getSnapshot()
		.importSchematic(new File([source], "RPI-RP2350A-MINIMAL_R4-S1.kicad_sch"));
	assert.deepEqual(report, expected.report);
	const project = required(f.session.getSnapshot().project);
	const drawing = required(
		project.drawings?.find((entry) => entry.id === "kicad-import"),
	);
	assert.equal(drawing.name, "RPI-RP2350A-MINIMAL_R4-S1");
	assert.deepEqual(drawing.shapes, expected.shapes);
	assert.equal(
		projectIndex(project).drawingsById.get("kicad-import")?.path,
		path,
	);
	assert.equal(installed.workers.length, 1);
	assert.equal(installed.workers[0].terminated, 1);
	stop();
});

test("project assets over the size limit are rejected before they are read or stored", async (t) => {
	const f = fixture();
	const imported: { name: string; kind: string; size: number }[][] = [];
	f.storage.importAssets = async (_directory, assets) => {
		imported.push(
			assets.map(({ name, kind, bytes }) => ({
				name,
				kind,
				size: bytes.byteLength,
			})),
		);
		return required(await f.storage.load());
	};
	const stop = f.session.connect();
	t.after(stop);
	await loaded(f.session);
	const huge = new File(["x"], "huge.zip");
	Object.defineProperty(huge, "size", { value: MAX_GERBER_ARCHIVE_BYTES + 1 });
	huge.arrayBuffer = () => {
		throw new Error("An oversized asset was read.");
	};
	await assert.rejects(
		f.session
			.getSnapshot()
			.importAssets([new File(["G04*"], "top.gbr"), huge], "gerber"),
		(error) =>
			error instanceof ProjectAssetTooLarge && error.assetName === "huge.zip",
	);
	assert.deepEqual(imported, []);
	const step = new File(["x"], "huge.step");
	Object.defineProperty(step, "size", { value: MAX_STEP_FILE_BYTES + 1 });
	await assert.rejects(
		f.session.getSnapshot().importAssets([step], "step"),
		(error) =>
			error instanceof ProjectAssetTooLarge && error.assetName === "huge.step",
	);
	await f.session
		.getSnapshot()
		.importAssets([new File(["G04*"], "top.gbr")], "gerber");
	assert.deepEqual(imported, [[{ name: "top.gbr", kind: "gerber", size: 4 }]]);
});

test("importing project assets resolves to the assets it added", async (t) => {
	const initial = snapshot();
	initial.manifest.assets = [
		{ path: "assets/old.gbr", name: "old.gbr", kind: "gerber" },
	];
	const f = fixture(initial);
	f.storage.importAssets = async (_directory, assets) => {
		const current = required(await f.storage.load());
		return {
			...current,
			manifest: {
				...current.manifest,
				assets: [
					...current.manifest.assets,
					...assets.map(({ name, kind }) => ({
						path: `assets/${name}`,
						name,
						kind,
					})),
				],
			},
		};
	};
	const stop = f.session.connect();
	t.after(stop);
	await loaded(f.session);
	assert.deepEqual(
		await f.session
			.getSnapshot()
			.importAssets([new File(["x"], "cube.step")], "step"),
		[{ path: "assets/cube.step", name: "cube.step", kind: "step" }],
	);
});

test("restoring assets loads every asset within the limit and names the oversized ones", async (t) => {
	const source = snapshot();
	source.manifest.assets = [
		{ path: "assets/small.step", name: "small.step", kind: "step" },
		{ path: "assets/b.step", name: "b.step", kind: "step" },
		{ path: "assets/c.step", name: "c.step", kind: "step" },
		{ path: "assets/top.gbr", name: "top.gbr", kind: "gerber" },
	];
	const f = fixture(source);
	const reads: string[] = [];
	f.storage.readAsset = async (_directory, path) => {
		reads.push(path);
		if (path === "assets/b.step" || path === "assets/c.step")
			throw new ProjectAssetTooLarge({
				assetName: path.slice("assets/".length),
				reason: "STEP files must be 256 MiB or smaller.",
			});
		return new TextEncoder().encode(path);
	};
	const stop = f.session.connect();
	t.after(stop);
	await loaded(f.session);
	const restored = await f.session.getSnapshot().readAssets("step");
	assert.deepEqual(
		restored.files.map((file) => file.name),
		["small.step"],
	);
	assert.equal(await restored.files[0].text(), "assets/small.step");
	assert.equal(restored.problems.length, 2);
	assert.match(restored.problems[0], /\bb\.step\b/);
	assert.match(restored.problems[1], /\bc\.step\b/);
	const gerber = await f.session.getSnapshot().readAssets("gerber");
	assert.deepEqual(
		gerber.files.map((file) => file.name),
		["top.gbr"],
	);
	assert.deepEqual(gerber.problems, []);
	// Other failures still reject the restore, as before.
	f.storage.readAsset = async () => {
		throw new Error("disk unavailable");
	};
	await assert.rejects(
		f.session.getSnapshot().readAssets("step"),
		/disk unavailable/,
	);
});

test("a circuit's schematic, circuit and PCB load together and the PCB takes the selection", async () => {
	const initial = snapshot();
	const { session } = fixture({
		...initial,
		manifest: { ...initial.manifest, circuits: [{ circuit: "main.ecaddraw" }] },
		circuits: [createCircuit("Main", primaryPcbId)],
	});
	const stop = session.connect();
	await loaded(session);
	const project = () => session.getSnapshot();
	await project().preloadEditorViews();
	const views = required(project().editorViews);
	assert.equal(views.circuitId, primaryPcbId);
	assert.equal(views.schematic, "main");
	assert.equal(views.board, null);
	const circuit = required(views.circuit);

	const schematic = {
		view: "schematic" as const,
		store: project().store,
		selection: { shapeIds: [1], childKey: null },
	};
	project().rememberViewSelection(schematic);
	await project().switchEditorView("pcb");
	const board = required(project().editorBoard);
	const handoff = required(project().takeSelectionHandoff("pcb"));
	assert.equal(handoff.source, schematic);
	assert.equal(handoff.circuit?.id, primaryPcbId);

	await project().preloadEditorViews();
	assert.equal(project().editorViews?.board, board);
	assert.equal(project().editorViews?.circuit, circuit);
	await project().switchEditorView("circuit");
	assert.equal(project().editorCircuit, circuit);
	stop();
});

test("a page-only edit marks the project dirty and saves the pages", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const store = f.session.getSnapshot().store;
	const editor = createEditorSession(store);
	const disconnect = editor.connect(store, () => undefined);
	editor.execute(
		setPagesEffect(
			[
				{ id: 1, name: "Main" },
				{ id: 2, name: "Power" },
			],
			"Add page",
		),
	);
	assert.equal(f.session.getSnapshot().dirty, true);
	await f.session.getSnapshot().save();
	assert.equal(f.session.getSnapshot().dirty, false);
	const saved = required(await f.storage.load());
	assert.deepEqual(saved.pages, [
		{ id: 1, name: "Main" },
		{ id: 2, name: "Power" },
	]);
	// A rename alone also counts as an edit.
	editor.execute(
		setPagesEffect(
			[
				{ id: 1, name: "Inputs" },
				{ id: 2, name: "Power" },
			],
			"Rename page",
		),
	);
	assert.equal(f.session.getSnapshot().dirty, true);
	await f.session.getSnapshot().save();
	assert.equal(required(await f.storage.load()).pages?.[0].name, "Inputs");
	disconnect();
	stop();
});

test("undoing the removal of inner copper gives the board its copper layers back", async () => {
	const initial = snapshot();
	const { session } = fixture({
		...initial,
		manifest: { ...initial.manifest, circuits: [{ circuit: "main.ecaddraw" }] },
		circuits: [createCircuit("Main", primaryPcbId)],
	});
	const stop = session.connect();
	await loaded(session);
	const project = () => session.getSnapshot();
	await project().switchEditorView("pcb");
	const board = required(project().editorBoard);
	board.rules.set({ ...board.rules.get(), copperLayers: 6 });
	const editor = createEditorSession(board.store);
	const track = trackSegment(
		editor.nextId(),
		{ x: 0, y: 0 },
		{ x: 5, y: 0 },
		"In3.Cu",
		0.25,
		undefined,
	);
	editor.place([track], "Route track");
	editor.commit(removeShapesEffect([track.id]));
	board.rules.set({ ...board.rules.get(), copperLayers: 2 });
	editor.restore(undoEffect);
	assert.ok(
		board.store.getSnapshot().shapes.some((shape) => shape.id === track.id),
	);
	assert.equal(board.rules.get().copperLayers, 6);
	stop();
});

test("split view loads circuit views together, focuses panes, broadcasts selection, and clears on file open", async () => {
	const initial = snapshot();
	const { session } = fixture({
		...initial,
		manifest: { ...initial.manifest, circuits: [{ circuit: "main.ecaddraw" }] },
		circuits: [createCircuit("Main", primaryPcbId)],
	});
	const stop = session.connect();
	await loaded(session);
	const project = () => session.getSnapshot();
	await project().setSplitEditorViews(
		["pcb", "schematic", "circuit"],
		"circuit",
	);
	assert.deepEqual(project().splitViews, ["schematic", "circuit", "pcb"]);
	const views = required(project().editorViews);
	assert.equal(views.schematic, "main");
	assert.ok(views.circuit);
	assert.ok(views.board);
	assert.equal(project().editorCircuit, views.circuit);
	assert.equal(project().editorBoard, null);

	const schematicSelection = {
		view: "schematic" as const,
		store: project().store,
		selection: { shapeIds: [1], childKey: null },
	};
	project().rememberViewSelection(schematicSelection);
	const firstSynced = required(project().getViewSelection());
	assert.equal(firstSynced.version, 1);
	assert.equal(firstSynced.circuitId, primaryPcbId);
	assert.equal(firstSynced.source, schematicSelection);
	// Handoff echoes with origin must not overwrite the live synced selection.
	project().rememberViewSelection({
		view: "pcb",
		store: required(views.board).store,
		selection: { shapeIds: [2], childKey: null },
		origin: schematicSelection,
	});
	const afterEcho = required(project().getViewSelection());
	assert.equal(afterEcho.version, 1);
	assert.equal(afterEcho.source, schematicSelection);

	project().focusSplitView("pcb");
	assert.deepEqual(project().splitViews, ["schematic", "circuit", "pcb"]);
	assert.equal(project().editorBoard, views.board);
	assert.equal(project().editorCircuit, null);

	await project().setSplitEditorViews(["pcb"]);
	assert.deepEqual(project().splitViews, []);
	assert.equal(project().editorBoard, views.board);

	await project().setSplitEditorViews(["schematic", "circuit"]);
	assert.deepEqual(project().splitViews, ["schematic", "circuit"]);
	project().selectEditorFile("main.ecaddraw");
	assert.deepEqual(project().splitViews, []);
	assert.equal(project().getViewSelection(), null);

	stop();
});

test("exiting split view to the focused view cancels an in-flight split open", async () => {
	const initial = snapshot();
	const f = fixture({
		...initial,
		manifest: { ...initial.manifest, circuits: [{ circuit: "main.ecaddraw" }] },
		circuits: [createCircuit("Main", primaryPcbId)],
	});
	const origSave = f.storage.save.bind(f.storage);
	let notifySaveEntered: (() => void) | undefined;
	const saveEntered = new Promise<void>((resolve) => {
		notifySaveEntered = resolve;
	});
	let releaseSave: (() => void) | undefined;
	let holdSave = false;
	f.storage.save = async (...args) => {
		if (holdSave) {
			notifySaveEntered?.();
			await new Promise<void>((resolve) => {
				releaseSave = resolve;
			});
		}
		return origSave(...args);
	};
	const stop = f.session.connect();
	await loaded(f.session);
	f.session
		.getSnapshot()
		.store.transact((current) => [
			undefined,
			{ ...current, shapes: [rectangle] },
		]);
	holdSave = true;
	const opening = f.session
		.getSnapshot()
		.setSplitEditorViews(["schematic", "circuit", "pcb"], "schematic");
	await saveEntered;
	await f.session.getSnapshot().setSplitEditorViews(["schematic"]);
	holdSave = false;
	releaseSave?.();
	await opening;
	assert.deepEqual(f.session.getSnapshot().splitViews, []);
	stop();
});
