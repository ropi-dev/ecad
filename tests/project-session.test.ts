import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { assembleLinkedPcbs } from "#/projects/linked-pcb.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { createEmptySymbolFile } from "#/components/editor/symbolFormat.ts";
import { createDocumentRegistry } from "#/projects/document-registry.ts";
import { ProjectClosed, ProjectConflict } from "#/projects/errors.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import { createProjectIndex, projectIndex } from "#/projects/project-index.ts";
import { createProjectSession } from "#/projects/ProjectSession.ts";
import { assembleProjectSave } from "#/projects/save-assembly.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
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
		drawingEdits: new Map([[drawing.id, [rectangle]]]),
		savedCircuits: [circuit],
	});
	assert.equal(symbol.shapes.length, 0);
	assert.equal(drawing.shapes.length, 0);
	assert.equal(document.symbols[0].shapes.length, 1);
	assert.deepEqual(document.drawings?.[0].shapes, [rectangle]);
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
	await assert.rejects(() => oldLibrary!.save([], []), ProjectClosed);
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
