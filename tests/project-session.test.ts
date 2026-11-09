import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import {
	redoEffect,
	setPagesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { createEmptySymbolFile } from "#/components/editor/symbolFormat.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { InvalidFile } from "#/formats/import-effects.ts";
import {
	MAX_GERBER_ARCHIVE_BYTES,
	MAX_KICAD_FILE_BYTES,
	MAX_STEP_FILE_BYTES,
} from "#/formats/import-limits.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { createDocumentRegistry } from "#/projects/document-registry.ts";
import {
	ProjectAssetTooLarge,
	ProjectClosed,
	ProjectConflict,
} from "#/projects/errors.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { assembleLinkedPcbs } from "#/projects/linked-pcb.ts";
import { createProjectSession } from "#/projects/ProjectSession.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import { createProjectIndex, projectIndex } from "#/projects/project-index.ts";
import { assembleProjectSave } from "#/projects/save-assembly.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";
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

test("document registry reuses stores within a kind, separates colliding IDs and disposes every subscription", () => {
	const disposed: string[] = [];
	const registry = createDocumentRegistry<{
		drawing: { unsubscribe(): void; drawing: true };
		symbol: { unsubscribe(): void; symbol: true };
	}>();
	const drawing = registry.openDocument("drawing", "same", () => ({
		drawing: true,
		unsubscribe() {
			disposed.push("drawing");
		},
	}));
	assert.equal(
		registry.openDocument("drawing", "same", () => {
			throw new Error("duplicate store");
		}),
		drawing,
	);
	registry.openDocument("symbol", "same", () => ({
		symbol: true,
		unsubscribe() {
			disposed.push("symbol");
		},
	}));
	registry.clear();
	registry.clear();
	assert.deepEqual(disposed.sort(), ["drawing", "symbol"]);
	assert.equal(registry.collection("drawing").size, 0);
});

test("snapshot index keeps paths paired with IDs and rebuilds after a save renames paths", () => {
	const first = snapshot();
	const symbol = createEmptySymbolFile("Part", []);
	first.symbols = [symbol];
	first.manifest.symbols = ["old.ecadsym"];
	first.drawings = [
		{ id: "extra", name: "Extra", circuitId: "pcb-extra", shapes: [] },
	];
	first.manifest.drawings = ["extra.ecaddraw"];
	first.circuits = [createCircuit("Extra", "pcb-extra")];
	first.manifest.circuits = [{ circuit: "extra.ecadcircuit" }];
	const index = projectIndex(first);
	assert.equal(projectIndex(first), index);
	assert.equal(index.symbolsByPath.get("old.ecadsym"), symbol);
	assert.equal(
		index.drawingsByCircuit.get("pcb-extra")?.path,
		"extra.ecaddraw",
	);
	assert.equal(
		index.circuitsByPath.get("extra.ecadcircuit"),
		first.circuits[0],
	);
	const next = {
		...first,
		manifest: { ...first.manifest, symbols: ["new.ecadsym"] },
	};
	assert.equal(
		projectIndex(next).symbolsById.get(symbol.id)?.path,
		"new.ecadsym",
	);
	assert.equal(createProjectIndex(snapshot()).circuitsById.size, 0);
});

test("session caches snapshots and actions across status changes and rejects obsolete library saves", async () => {
	const { session } = fixture();
	const stop = session.connect();
	await loaded(session);
	const first = session.getSnapshot();
	assert.equal(session.getSnapshot(), first);
	first.reportUnsavedEdits("library", true);
	const next = session.getSnapshot();
	assert.equal(next.project, first.project);
	assert.equal(next.store, first.store);
	assert.equal(next.createDrawing, first.createDrawing);
	assert.equal(next.otherUnsavedEdits, true);
	const oldLibrary = session.getProjectSymbols(first.session);
	await next.reload();
	await assert.rejects(() => required(oldLibrary).save([], []), ProjectClosed);
	stop();
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

test("library writes and explicit saves share the session queue", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started!: () => void;
	const entered = new Promise<void>((resolve) => {
		started = resolve;
	});
	const save = f.storage.save;
	let calls = 0;
	f.storage.save = async (...args) => {
		calls++;
		if (calls === 1) {
			started();
			await blocked;
		}
		return save(...args);
	};
	const first = f.session.getSnapshot().save();
	await entered;
	const library = f.session.getProjectSymbols(f.session.getSnapshot().session);
	assert.ok(library);
	const second = library.save([], []);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);
	release();
	await Promise.all([first, second]);
	assert.equal(calls, 2);
	stop();
});

test("linked PCB assembly preserves the first drawing match and never mutates its inputs", async () => {
	const definition = symbolDefinitions.find(
		(symbol) => symbol.id === "resistor",
	);
	assert.ok(definition);
	const placed = createSymbol(1, definition, { x: 0, y: 0 }, "R1");
	const original = synchronizePcb(
		createCircuit("Other", "other"),
		[placed],
		undefined,
		symbolDefinitions,
	);
	const changed = {
		...original.file,
		circuit: {
			...original.file.circuit,
			revision: original.file.circuit.revision + 1,
			components: original.file.circuit.components.map((component) => ({
				...component,
				value: "Changed",
			})),
		},
	};
	const previous = { ...snapshot(), circuits: [original.file] };
	const document = {
		shapes: [],
		symbols: [],
		symbolLibraries: [],
		circuits: [changed],
		drawings: [
			{
				id: "first",
				name: "First",
				circuitId: "other",
				shapes: original.shapes,
			},
			{
				id: "second",
				name: "Second",
				circuitId: "other",
				shapes: original.shapes,
			},
		],
	};
	const before = structuredClone(document);
	const result = await assembleLinkedPcbs(
		document,
		previous,
		symbols,
		() => {},
	);
	assert.ok(result.externalDrawings.has("first"));
	assert.ok(!result.externalDrawings.has("second"));
	const first = result.document.drawings?.[0].shapes[0];
	assert.equal(first?.kind === "symbol" && first.attributes.value, "Changed");
	assert.deepEqual(document, before);
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
		(error) =>
			error instanceof InvalidFile &&
			error.message === "KiCad schematics must be 32 MiB or smaller.",
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
			error instanceof ProjectAssetTooLarge &&
			error.message ===
				"huge.zip: Gerber ZIP archives must be 256 MiB or smaller.",
	);
	assert.deepEqual(imported, []);
	const step = new File(["x"], "huge.step");
	Object.defineProperty(step, "size", { value: MAX_STEP_FILE_BYTES + 1 });
	await assert.rejects(
		f.session.getSnapshot().importAssets([step], "step"),
		(error) =>
			error instanceof ProjectAssetTooLarge &&
			error.message === "huge.step: STEP files must be 256 MiB or smaller.",
	);
	await f.session
		.getSnapshot()
		.importAssets([new File(["G04*"], "top.gbr")], "gerber");
	assert.deepEqual(imported, [[{ name: "top.gbr", kind: "gerber", size: 4 }]]);
});

test("a new project copies the source project's assets except those over the size limit", async (t) => {
	const source = snapshot();
	source.manifest.assets = [
		{ path: "assets/huge.step", name: "huge.step", kind: "step" },
		{ path: "assets/top.gbr", name: "top.gbr", kind: "gerber" },
	];
	const f = fixture(source);
	const imported: string[][] = [];
	f.storage.readAsset = async (_directory, path) => {
		if (path === "assets/huge.step")
			throw new ProjectAssetTooLarge({
				assetName: "huge.step",
				reason: "STEP files must be 256 MiB or smaller.",
			});
		return new Uint8Array([1, 2]);
	};
	f.storage.importAssets = async (_directory, assets) => {
		imported.push(assets.map((asset) => asset.name));
		return required(await f.storage.load());
	};
	const stop = f.session.connect();
	t.after(stop);
	await loaded(f.session);
	await f.session.getSnapshot().create("Copy");
	assert.equal(
		f.session.getSnapshot().error,
		"The new project leaves out an asset over the size limit, which stays in the original project. huge.step: STEP files must be 256 MiB or smaller.",
	);
	assert.deepEqual(imported, [["top.gbr"]]);
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
	assert.deepEqual(restored.problems, [
		"b.step: STEP files must be 256 MiB or smaller.",
		"c.step: STEP files must be 256 MiB or smaller.",
	]);
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

test("view switches hand the remembered selection only to the paired destination", async () => {
	const initial = snapshot();
	const { session } = fixture({
		...initial,
		manifest: { ...initial.manifest, circuits: [{ circuit: "main.ecaddraw" }] },
		circuits: [createCircuit("Main", primaryPcbId)],
	});
	const stop = session.connect();
	await loaded(session);
	const project = () => session.getSnapshot();
	const schematic = {
		view: "schematic" as const,
		store: project().store,
		selection: { shapeIds: [1], childKey: null },
	};
	project().rememberViewSelection(schematic);
	await project().switchEditorView("circuit");
	const circuit = required(project().editorCircuit);
	assert.deepEqual(project().takeSelectionHandoff("schematic"), null);
	project().rememberViewSelection(schematic);
	await project().switchEditorView("schematic");
	await project().switchEditorView("circuit");
	assert.equal(project().takeSelectionHandoff("circuit"), schematic);
	assert.equal(project().takeSelectionHandoff("circuit"), null);

	const derived = {
		view: "circuit" as const,
		store: circuit.store,
		selection: { item: { kind: "net" as const, id: "net" }, checkedPins: [] },
	};
	project().rememberViewSelection({ ...derived, origin: { ...schematic } });
	await project().switchEditorView("schematic");
	assert.deepEqual(project().takeSelectionHandoff("schematic"), derived);

	project().rememberViewSelection({ ...derived, origin: schematic });
	await project().switchEditorView("circuit");
	assert.equal(project().takeSelectionHandoff("circuit"), null);

	project().rememberViewSelection({ ...derived, origin: schematic });
	await project().switchEditorView("schematic");
	assert.equal(project().takeSelectionHandoff("schematic"), schematic);

	project().rememberViewSelection(schematic);
	await project().switchEditorView("circuit");
	await project().openCircuit("main.ecaddraw");
	assert.equal(project().takeSelectionHandoff("circuit"), null);

	await project().switchEditorView("schematic");
	project().rememberViewSelection(schematic);
	await project().switchEditorView("circuit");
	await project().reload();
	assert.equal(project().takeSelectionHandoff("circuit"), null);
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
