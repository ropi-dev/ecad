import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { createEmptySymbolFile } from "#/components/editor/symbolFormat.ts";
import { toastManager } from "#/components/ui/toast.ts";
import { ProjectConflict } from "#/projects/errors.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { createProjectSession } from "#/projects/ProjectSession.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import type { ProjectRefresh, ProjectStorage } from "#/projects/storage.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";

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
const symbol = createEmptySymbolFile("Part", []);

function snapshot(): ProjectSnapshot {
	return {
		directory: "project",
		manifest: {
			format: "ecad-project",
			version: 1,
			name: "Board",
			drawing: "main.ecaddraw",
			drawings: ["extra.ecaddraw"],
			symbols: ["part.ecadsym"],
			assets: [],
		},
		shapes: [],
		drawings: [{ id: "extra", name: "Extra", shapes: [] }],
		symbols: [symbol],
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
	let notify: (directory: string) => void = () => {};
	const calls = { saves: 0, refreshes: 0 };
	const storage: ProjectStorage & {
		refresh(directory: string): Promise<ProjectRefresh | null>;
	} = {
		mode: "desktop",
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
			calls.saves++;
			current = { ...current, ...document };
			return current;
		},
		async importAssets() {
			return current;
		},
		async readAsset() {
			return new Uint8Array();
		},
		async refresh() {
			calls.refreshes++;
			return null;
		},
		subscribeExternalChanges(listener) {
			notify = listener;
			return () => {
				notify = () => {};
			};
		},
	};
	const session = createProjectSession(storage, symbols);
	return {
		session,
		storage,
		calls,
		/** Simulates another program writing these files. */
		changeOnDisk(next: ProjectSnapshot, changed: string[]) {
			storage.refresh = async () => {
				calls.refreshes++;
				current = next;
				return { snapshot: next, changed };
			};
			notify("project");
		},
		notify: (directory = "project") => notify(directory),
	};
}

async function loaded(session: ReturnType<typeof createProjectSession>) {
	await until(() => !session.getSnapshot().busy);
}

async function until(condition: () => boolean) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail("The condition did not become true.");
}

const reloadToast = () =>
	toastManager
		.getSnapshot()
		.find((toast) => toast.id === "project-external-reload");

test("an external change replaces only the changed document and keeps the other stores and history", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const main = f.session.getSnapshot().store;
	main.transact((current) => [undefined, { ...current, shapes: [rectangle] }]);
	await until(() => f.calls.saves === 1 && !f.session.getSnapshot().dirty);
	const mainState = main.getSnapshot();
	assert.equal(
		f.session.getSnapshot().selectEditorFile("extra.ecaddraw"),
		true,
	);
	const extra = f.session.getSnapshot().editorDrawing;
	assert.ok(extra);
	const epoch = f.session.getSnapshot().session;

	const next = snapshot();
	next.shapes = [rectangle];
	next.drawings = [
		{ id: "extra", name: "Extra", shapes: [{ ...rectangle, id: 5 }] },
	];
	f.changeOnDisk(next, ["extra.ecaddraw"]);
	await until(() => extra.store.getSnapshot().shapes.length === 1);

	const value = f.session.getSnapshot();
	assert.equal(value.store, main);
	assert.equal(main.getSnapshot(), mainState);
	assert.equal(value.editorDrawing?.store, extra.store);
	assert.equal(
		value.editorDrawing?.savedShapes,
		extra.store.getSnapshot().shapes,
	);
	assert.equal(value.dirty, false);
	assert.equal(value.session, epoch);
	assert.equal(value.project, next);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(f.calls.saves, 1);
	assert.match(reloadToast()?.description ?? "", /Extra/);
	stop();
});

test("an external change during a drag cancels the drag", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const main = f.session.getSnapshot().store;
	const editor = createEditorSession(main);
	let cancelled = 0;
	const disconnect = editor.connect(main, () => cancelled++);
	cancelled = 0;
	editor.place([rectangle], "Draw rectangle");
	await until(() => f.calls.saves === 1 && !f.session.getSnapshot().dirty);
	assert.equal(cancelled, 0, "the editor's own save does not cancel");
	editor.preview([{ ...rectangle, x: 7 }]);

	const next = snapshot();
	next.shapes = [{ ...rectangle, y: 20 }];
	f.changeOnDisk(next, ["main.ecaddraw"]);
	await until(() => main.getSnapshot().shapes[0]?.y === 20);
	assert.equal(cancelled, 1);
	disconnect();
	stop();
});

test("unsaved edits are never replaced: the save reports the conflict and no refresh runs", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.storage.save = async () => {
		f.calls.saves++;
		await blocked;
		throw new ProjectConflict({ path: "main.ecaddraw" });
	};
	const main = f.session.getSnapshot().store;
	main.transact((current) => [undefined, { ...current, shapes: [rectangle] }]);
	await until(() => f.calls.saves === 1);
	f.changeOnDisk(snapshot(), ["main.ecaddraw"]);
	release();
	await until(() => f.session.getSnapshot().conflict);
	assert.equal(f.calls.refreshes, 0);
	assert.deepEqual(main.getSnapshot().shapes, [rectangle]);
	stop();
});

test("an edit made while the files are read becomes a conflict instead of being overwritten", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const main = f.session.getSnapshot().store;
	const next = snapshot();
	next.shapes = [{ ...rectangle, id: 9 }];
	f.storage.refresh = async () => {
		main.transact((current) => [
			undefined,
			{ ...current, shapes: [rectangle] },
		]);
		return { snapshot: next, changed: ["main.ecaddraw"] };
	};
	f.notify();
	await until(() => f.session.getSnapshot().conflict);
	assert.deepEqual(main.getSnapshot().shapes, [rectangle]);
	stop();
});

test("a deleted open document closes and the editor returns to the main drawing", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	f.session.getSnapshot().selectEditorFile("part.ecadsym");
	assert.ok(f.session.getSnapshot().editorSymbol);
	const next = snapshot();
	next.manifest = { ...next.manifest, symbols: [] };
	next.symbols = [];
	f.changeOnDisk(next, ["ecad-project.json", "part.ecadsym"]);
	await until(() => f.session.getSnapshot().project === next);
	assert.equal(f.session.getSnapshot().editorSymbol, null);
	assert.equal(reloadToast()?.type, "warning");
	assert.match(reloadToast()?.description ?? "", /Closed Part/);
	stop();
});

test("unreadable changes keep the open documents and explain why", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const before = f.session.getSnapshot().project;
	f.storage.refresh = async () => {
		throw new Error("The file is not valid JSON.");
	};
	f.notify();
	await until(
		() => reloadToast()?.title === "Unable to reload changes from disk",
	);
	assert.match(reloadToast()?.description ?? "", /not valid JSON/);
	assert.equal(f.session.getSnapshot().project, before);
	assert.equal(f.session.getSnapshot().conflict, false);
	stop();
});

test("changes reported for another directory are ignored", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	f.notify("elsewhere");
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(f.calls.refreshes, 0);
	stop();
});

function withCircuit(name: string): ProjectSnapshot {
	const file = createCircuit("Board", primaryPcbId);
	file.circuit.nets = [{ id: "n1", names: [name], pinIds: [] }];
	const next = snapshot();
	next.manifest = {
		...next.manifest,
		circuits: [{ circuit: "main.ecaddraw" }],
	};
	next.circuits = [file];
	return next;
}

test("an open circuit takes the external circuit, keeps its node positions and starts a new history", async () => {
	const f = fixture(withCircuit("GND"));
	const stop = f.session.connect();
	await loaded(f.session);
	assert.equal(
		await f.session.getSnapshot().openCircuit("main.ecaddraw"),
		true,
	);
	const circuit = f.session.getSnapshot().editorCircuit;
	assert.ok(circuit);
	circuit.store.execute({ type: "rename-net", id: "n1", names: ["GROUND"] });
	await until(() => f.calls.saves === 1 && !f.session.getSnapshot().dirty);
	assert.equal(circuit.store.getSnapshot().canUndo, true);
	const positions = circuit.store.getSnapshot().graph.positions;

	f.changeOnDisk(withCircuit("VCC"), ["main.ecaddraw"]);
	await until(
		() => circuit.store.getSnapshot().circuit.nets[0]?.names[0] === "VCC",
	);
	const value = f.session.getSnapshot();
	assert.equal(value.editorCircuit?.store, circuit.store);
	assert.deepEqual(circuit.store.getSnapshot().graph.positions, positions);
	assert.equal(circuit.store.getSnapshot().canUndo, false);
	assert.equal(
		value.editorCircuit?.savedFile.circuit,
		circuit.store.getSnapshot().circuit,
	);
	assert.equal(value.dirty, false);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(f.calls.saves, 1);
	stop();
});

test("a manifest that points the main drawing at another existing file reloads it", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const next = snapshot();
	next.manifest = { ...next.manifest, drawing: "other.ecaddraw" };
	next.shapes = [rectangle];
	f.changeOnDisk(next, ["ecad-project.json"]);
	await until(() => f.session.getSnapshot().project === next);
	assert.deepEqual(f.session.getSnapshot().store.getSnapshot().shapes, [
		rectangle,
	]);
	assert.equal(f.session.getSnapshot().dirty, false);
	stop();
});

test("a changed open symbol takes the file's shapes and starts a new history", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	f.session.getSnapshot().selectEditorFile("part.ecadsym");
	const document = f.session.getSnapshot().editorSymbol;
	assert.ok(document);
	const next = snapshot();
	const { id: _id, ...shape } = rectangle;
	next.symbols = [{ ...symbol, shapes: [shape] }];
	f.changeOnDisk(next, ["part.ecadsym"]);
	await until(() => document.store.getSnapshot().shapes.length === 1);
	const value = f.session.getSnapshot();
	assert.equal(value.editorSymbol?.store, document.store);
	assert.equal(value.editorSymbol?.file, next.symbols[0]);
	assert.equal(
		value.editorSymbol?.savedShapes,
		document.store.getSnapshot().shapes,
	);
	assert.equal(value.dirty, false);
	stop();
});

test("an unsaved draft in another editor keeps the files from being reloaded", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	f.session.getSnapshot().reportUnsavedEdits("symbol-editor", true);
	f.changeOnDisk(snapshot(), ["main.ecaddraw"]);
	await until(() => f.calls.saves === 1);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(f.calls.refreshes, 0);
	stop();
});

test("a failure after the files were read pauses saving instead of reporting no change", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	const library = f.session.getProjectSymbols(f.session.getSnapshot().session);
	library?.subscribe?.(() => {
		throw new Error("listener failed");
	});
	const next = snapshot();
	next.shapes = [rectangle];
	f.changeOnDisk(next, ["main.ecaddraw"]);
	await until(() => f.session.getSnapshot().conflict);
	assert.notEqual(reloadToast()?.title, "Unable to reload changes from disk");
	stop();
});

test("notifications during a refresh share one more refresh", async () => {
	const f = fixture();
	const stop = f.session.connect();
	await loaded(f.session);
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.storage.refresh = async () => {
		f.calls.refreshes++;
		if (f.calls.refreshes === 1) await blocked;
		return null;
	};
	f.notify();
	f.notify();
	f.notify();
	await until(() => f.calls.refreshes === 1);
	f.notify();
	f.notify();
	release();
	await until(() => f.calls.refreshes === 2);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(f.calls.refreshes, 2);
	stop();
});

test("an external change drops the selection a view switch would restore", async () => {
	const initial = snapshot();
	const linked = {
		...initial,
		manifest: { ...initial.manifest, circuits: [{ circuit: "main.ecaddraw" }] },
		circuits: [createCircuit("Board", primaryPcbId)],
	};
	const f = fixture(linked);
	const stop = f.session.connect();
	await loaded(f.session);
	const project = () => f.session.getSnapshot();
	const main = project().store;
	const schematic = {
		view: "schematic" as const,
		store: main,
		selection: { shapeIds: [1], childKey: null },
	};
	project().rememberViewSelection(schematic);
	await project().switchEditorView("circuit");
	const origin = project().takeSelectionHandoff("circuit");
	const circuit = project().editorCircuit;
	assert.ok(origin && circuit);
	const derived = {
		view: "circuit" as const,
		store: circuit.store,
		selection: { item: null, checkedPins: [] },
	};
	project().rememberViewSelection({ ...derived, origin });
	f.changeOnDisk({ ...linked, shapes: [rectangle] }, ["main.ecaddraw"]);
	await until(() => main.getSnapshot().shapes.length === 1);
	project().rememberViewSelection({ ...derived, origin });
	await project().switchEditorView("schematic");
	assert.deepEqual(project().takeSelectionHandoff("schematic"), derived);
	stop();
});
