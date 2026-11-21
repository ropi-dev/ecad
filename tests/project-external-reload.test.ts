import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { createBoardFile } from "#/board/format.ts";
import { createEmptySymbolFile } from "#/components/editor/symbolFormat.ts";
import { toastManager } from "#/components/ui/toast.ts";
import { ProjectConflict } from "#/projects/errors.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { createProjectSession } from "#/projects/ProjectSession.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import type { ProjectRefresh, ProjectStorage } from "#/projects/storage.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.ts";
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
	await until(() => /not valid JSON/.test(reloadToast()?.description ?? ""));
	assert.equal(f.session.getSnapshot().project, before);
	assert.equal(f.session.getSnapshot().conflict, false);
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

test("a PCB shown beside its schematic follows the board file when another program replaces or deletes it", async () => {
	const withBoard = (name: string) => ({
		...withCircuit("GND"),
		boards: [createBoardFile(name, primaryPcbId)],
	});
	const f = fixture(withBoard("Board"));
	const stop = f.session.connect();
	await loaded(f.session);
	const project = () => f.session.getSnapshot();
	await project().prepareEditorViews(["schematic", "pcb"]);
	const board = required(project().editorViews?.board);
	assert.equal(project().editorBoard, null);

	const replaced = withBoard("Renamed");
	f.changeOnDisk(replaced, ["main.ecaddraw"]);
	await until(() => project().project === replaced);
	const next = required(project().editorViews?.board);
	assert.notEqual(next, board);
	assert.equal(next.store, board.store);
	assert.equal(next.file.name, "Renamed");

	const deleted = withCircuit("GND");
	f.changeOnDisk(deleted, ["main.ecaddraw"]);
	await until(() => project().project === deleted);
	assert.equal(project().editorViews?.board, null);
	assert.equal(project().editorViews?.schematic, "main");
	stop();
});
