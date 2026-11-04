import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { ProjectConflict } from "#/projects/errors.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { createLinkedPcbAssembler } from "#/projects/linked-pcb.ts";
import { createProjectSession } from "#/projects/ProjectSession.ts";
import { ProjectRepository } from "#/projects/repository.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";
import { memoryDirectory } from "./helpers/project-directory.ts";

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
function snapshot(directory = "first"): ProjectSnapshot {
	return {
		directory,
		manifest: {
			format: "ecad-project",
			version: 1,
			name: "Test",
			drawing: "main.ecaddraw",
			symbols: [],
			assets: [],
			drawings: ["extra.ecaddraw"],
			circuits: [{ circuit: "main.ecaddraw" }, { circuit: "extra.ecaddraw" }],
		},
		shapes: [],
		symbols: [],
		drawings: [{ id: "extra", name: "Extra", circuitId: "other", shapes: [] }],
		circuits: [
			createCircuit("Main", "pcb-main"),
			createCircuit("Other", "other"),
		],
	};
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture() {
	let current = snapshot();
	const writes: ProjectSnapshot[] = [];
	let blocked: ReturnType<typeof deferred> | undefined;
	const entered = deferred();
	let failure: Error | undefined;
	let configReads = 0;
	let listener = () => {};
	const symbols: SymbolLibraryStorage = {
		mode: "memory",
		async load() {
			return { symbols: [] };
		},
		async save() {
			return "Saved";
		},
		async loadConfiguration() {
			configReads++;
			return { version: 1, symbolLibraries: [] };
		},
		subscribe(next) {
			listener = next;
			return () => {
				listener = () => {};
			};
		},
	};
	const storage: ProjectStorage = {
		mode: "web",
		async load() {
			return current;
		},
		async list() {
			return [];
		},
		async open() {
			current = snapshot("second");
			return current;
		},
		async create() {
			return current;
		},
		async save(directory, document) {
			if (blocked) {
				const gate = blocked;
				blocked = undefined;
				entered.resolve();
				await gate.promise;
			}
			if (failure) throw failure;
			current = { ...current, ...document, directory };
			writes.push(current);
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
	const stop = session.connect();
	const ready = new Promise<void>((resolve) => {
		const unsubscribe = session.subscribe(() => {
			if (!session.getSnapshot().busy) {
				unsubscribe();
				resolve();
			}
		});
	});
	return {
		session,
		stop,
		ready,
		writes,
		entered,
		block() {
			blocked = deferred();
			return blocked;
		},
		fail(next?: Error) {
			failure = next;
		},
		invalidate() {
			listener();
		},
		get configReads() {
			return configReads;
		},
	};
}
async function clean(f: ReturnType<typeof fixture>) {
	for (let i = 0; i < 100; i++) {
		await new Promise((resolve) => setImmediate(resolve));
		if (!f.session.getSnapshot().dirty) return;
	}
	assert.fail("save did not drain");
}
function edit(f: ReturnType<typeof fixture>, x: number) {
	f.session
		.getSnapshot()
		.store.transact((current) => [
			undefined,
			{ ...current, shapes: [{ ...rectangle, x }] },
		]);
}

test("rapid edits during an in-flight save coalesce and retain the latest revision", async () => {
	const f = fixture();
	await f.ready;
	try {
		const gate = f.block();
		edit(f, 1);
		await f.entered.promise;
		for (let i = 2; i <= 30; i++) edit(f, i);
		assert.equal(f.session.getSnapshot().dirty, true);
		gate.resolve();
		await clean(f);
		assert.equal(f.writes.length, 2);
		assert.equal(f.writes[0].shapes[0].x, 1);
		assert.equal(f.writes[1].shapes[0].x, 30);
		assert.equal(f.configReads, 1);
	} finally {
		f.stop();
	}
});

test("document selection during save waits for all edits and keeps the main store", async () => {
	const f = fixture();
	await f.ready;
	try {
		const store = f.session.getSnapshot().store;
		const gate = f.block();
		edit(f, 1);
		await f.entered.promise;
		const selecting = f.session
			.getSnapshot()
			.selectEditorFile("extra.ecaddraw");
		edit(f, 2);
		gate.resolve();
		assert.equal(await selecting, true);
		assert.equal(f.writes.at(-1)?.shapes[0].x, 2);
		assert.equal(f.session.getSnapshot().editorDrawing?.file.id, "extra");
		assert.equal(f.session.getSnapshot().store, store);
	} finally {
		f.stop();
	}
});

test("project switch drains the old project's writes before adopting the new stores", async () => {
	const f = fixture();
	await f.ready;
	try {
		const old = f.session.getSnapshot();
		const gate = f.block();
		edit(f, 1);
		await f.entered.promise;
		const switching = old.open();
		edit(f, 2);
		gate.resolve();
		await switching;
		assert.equal(f.writes.length, 2);
		assert.ok(f.writes.every((write) => write.directory === "first"));
		assert.equal(f.writes.at(-1)?.shapes[0].x, 2);
		assert.equal(f.session.getSnapshot().project?.directory, "second");
		assert.notEqual(f.session.getSnapshot().store, old.store);
		assert.equal(f.session.getSnapshot().dirty, false);
	} finally {
		f.stop();
	}
});

test("failed autosave stays dirty without a retry loop and explicit save retries latest edits", async () => {
	const f = fixture();
	await f.ready;
	try {
		f.fail(new Error("Disk full"));
		edit(f, 1);
		await assert.rejects(f.session.getSnapshot().save(), /Disk full/);
		assert.equal(f.session.getSnapshot().dirty, true);
		assert.match(f.session.getSnapshot().error, /Disk full/);
		assert.equal(f.writes.length, 0);
		f.fail();
		await f.session.getSnapshot().save();
		assert.equal(f.writes.at(-1)?.shapes[0].x, 1);
		edit(f, 2);
		await clean(f);
		assert.equal(f.writes.at(-1)?.shapes[0].x, 2);
		assert.equal(f.session.getSnapshot().error, "");
	} finally {
		f.stop();
	}
});

test("library updates invalidate resolution, including an update during a save", async () => {
	const f = fixture();
	await f.ready;
	try {
		const gate = f.block();
		edit(f, 1);
		await f.entered.promise;
		f.invalidate();
		gate.resolve();
		await clean(f);
		assert.equal(f.configReads, 2);
		edit(f, 2);
		await clean(f);
		assert.equal(f.configReads, 2);
		f.invalidate();
		await clean(f);
		assert.equal(f.configReads, 3);
	} finally {
		f.stop();
	}
});

test("linked assembly reuses unaffected PCB inputs and invalidates project library changes", async () => {
	const assembler = createLinkedPcbAssembler();
	let reads = 0;
	const symbols: SymbolLibraryStorage = {
		mode: "memory",
		async load() {
			return { symbols: [] };
		},
		async save() {
			return "Saved";
		},
		async loadConfiguration() {
			reads++;
			return { version: 1, symbolLibraries: [] };
		},
	};
	let previous = snapshot();
	const first = await assembler.assemble(
		{ ...previous, symbolLibraries: [] },
		previous,
		symbols,
		() => {},
	);
	previous = { ...previous, ...first.document };
	assembler.accept(previous);
	const unchanged = previous.drawings?.[0].shapes;
	const second = await assembler.assemble(
		{ ...previous, shapes: [rectangle], symbolLibraries: [] },
		previous,
		symbols,
		() => {},
	);
	assert.equal(second.document.drawings?.[0].shapes, unchanged);
	assert.equal(second.document.circuits?.[1], previous.circuits?.[1]);
	assert.equal(reads, 1);
	const changed = await assembler.assemble(
		{
			...second.document,
			symbolLibraries: [
				{
					id: "new",
					name: "New",
					enabled: true,
					source: { kind: "embedded", symbols: [] },
				},
			],
		},
		previous,
		symbols,
		() => {},
	);
	assert.equal(reads, 2);
	assert.notEqual(changed.document.drawings?.[0].shapes, unchanged);
});

test("save cache never bypasses disk conflict checks in either repository layout", async () => {
	for (const layout of ["files", "revisions"] as const) {
		const memory = memoryDirectory();
		const repository = new ProjectRepository(memory.directory, { layout });
		let previous = await repository.create("Test");
		const assembler = createLinkedPcbAssembler();
		const symbols: SymbolLibraryStorage = {
			mode: "memory",
			async load() {
				return { symbols: [] };
			},
			async save() {
				return "Saved";
			},
		};
		const first = await assembler.assemble(
			{ ...previous, symbolLibraries: [] },
			previous,
			symbols,
			() => {},
		);
		previous = await repository.save(first.document);
		assembler.accept(previous);
		const diskPath =
			layout === "files" ? previous.manifest.drawing : ".ecadprj";
		memory.files.set(diskPath, new TextEncoder().encode("external edit"));
		const second = await assembler.assemble(
			{ ...previous, symbolLibraries: [] },
			previous,
			symbols,
			() => {},
		);
		await assert.rejects(repository.save(second.document), ProjectConflict);
	}
});

test("electrical edits during save retain the latest revision and graph-only changes stay clean", async () => {
	const f = fixture();
	await f.ready;
	try {
		await f.session.getSnapshot().openCircuit("main.ecaddraw");
		const circuit = f.session.getSnapshot().editorCircuit!.store;
		const gate = f.block();
		const file = circuit.getSnapshot();
		circuit.execute({
			type: "replace",
			file: {
				graph: file.graph,
				circuit: {
					...file.circuit,
					name: "First edit",
					revision: file.circuit.revision + 1,
				},
			},
		});
		await f.entered.promise;
		const latest = circuit.getSnapshot();
		circuit.execute({
			type: "replace",
			file: {
				graph: latest.graph,
				circuit: {
					...latest.circuit,
					name: "Latest edit",
					revision: latest.circuit.revision + 1,
				},
			},
		});
		gate.resolve();
		await clean(f);
		assert.equal(f.writes.length, 2);
		assert.equal(f.writes.at(-1)?.circuits?.[0].circuit.name, "Latest edit");
		assert.equal(circuit.getSnapshot().circuit.name, "Latest edit");
		const count = f.writes.length;
		const electrical = circuit.getSnapshot().circuit;
		circuit.execute({ type: "move", positions: [] });
		assert.equal(circuit.getSnapshot().circuit, electrical);
		circuit.undo();
		assert.equal(circuit.getSnapshot().circuit, electrical);
		circuit.redo();
		assert.equal(circuit.getSnapshot().circuit, electrical);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(f.writes.length, count);
		assert.equal(f.session.getSnapshot().dirty, false);
	} finally {
		f.stop();
	}
});

test("a rejected library resolution retries instead of caching its rejection", async () => {
	const assembler = createLinkedPcbAssembler();
	let attempts = 0;
	const symbols: SymbolLibraryStorage = {
		mode: "memory",
		async load() {
			return { symbols: [] };
		},
		async save() {
			return "Saved";
		},
		async loadConfiguration() {
			if (++attempts === 1) throw new Error("Library unavailable");
			return { version: 1, symbolLibraries: [] };
		},
	};
	const previous = snapshot();
	const document = { ...previous, symbolLibraries: [] };
	await assert.rejects(
		assembler.assemble(document, previous, symbols, () => {}),
		/Library unavailable/,
	);
	await assembler.assemble(document, previous, symbols, () => {});
	assert.equal(attempts, 2);
});
