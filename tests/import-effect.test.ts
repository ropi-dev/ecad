import assert from "node:assert/strict";
import test from "node:test";
import { Cause, Effect, Exit, Fiber, TestClock, TestContext } from "effect";
import { BufferGeometry, Mesh } from "three";
import { expandGerberFile } from "#/formats/expandGerberFile.ts";
import {
	acquireImported,
	ArchiveError,
	ImportTimeout,
	InvalidFile,
	requestWorker,
	WorkerError,
} from "#/formats/import-effects.ts";
import { ImportOwnership } from "#/formats/import-ownership.ts";
import { type ImportFile, importFilesEffect } from "#/formats/importFiles.ts";
import { parseStepFile } from "#/formats/parseStepFile.ts";
import type { StepModel } from "#/formats/step/types/StepModel.ts";
import { runEffect } from "#/lib/effect.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

class FakeWorker {
	onmessage: Worker["onmessage"] = null;
	onerror: Worker["onerror"] = null;
	onmessageerror: Worker["onmessageerror"] = null;
	terminated = 0;
	posted: unknown[] = [];
	constructor(readonly respond?: (worker: FakeWorker) => void) {}
	postMessage(message: unknown) {
		this.posted.push(message);
		this.respond?.(this);
	}
	terminate() {
		this.terminated++;
	}
	result(result: unknown) {
		this.onmessage?.call(
			this as unknown as Worker,
			new MessageEvent("message", { data: { result } }),
		);
	}
}

const workerRequest = (worker: FakeWorker, timeout = 20_000) =>
	requestWorker<string>({
		create: () => worker as unknown as Worker,
		message: { input: "file" },
		timeout,
		timeoutMessage: "Import timed out.",
		parseMessage: "Invalid file.",
		startMessage: "Worker failed.",
		receiveMessage: "Invalid response.",
	});

function assertReleased(worker: FakeWorker) {
	assert.equal(worker.terminated, 1);
	assert.equal(worker.onmessage, null);
	assert.equal(worker.onerror, null);
	assert.equal(worker.onmessageerror, null);
}

test("workers terminate and detach handlers before successful results escape", async () => {
	const worker = new FakeWorker((worker) => worker.result("parsed"));
	assert.equal(await runEffect(workerRequest(worker)), "parsed");
	assert.deepEqual(worker.posted, [{ input: "file" }]);
	assertReleased(worker);
});

test("worker parse, runtime, message and postMessage failures preserve errors and clean up", async () => {
	const cases: Array<[string, (worker: FakeWorker) => void]> = [
		[
			"Invalid file.",
			(worker) =>
				worker.onmessage?.call(
					worker as unknown as Worker,
					new MessageEvent("message", { data: {} }),
				),
		],
		[
			"bad syntax",
			(worker) =>
				worker.onmessage?.call(
					worker as unknown as Worker,
					new MessageEvent("message", { data: { error: "bad syntax" } }),
				),
		],
		[
			"runtime failed",
			(worker) =>
				worker.onerror?.call(
					worker as unknown as Worker,
					{ message: "runtime failed" } as ErrorEvent,
				),
		],
		[
			"Invalid response.",
			(worker) =>
				worker.onmessageerror?.call(
					worker as unknown as Worker,
					new MessageEvent("messageerror"),
				),
		],
		[
			"transfer failed",
			() => {
				throw new Error("transfer failed");
			},
		],
	];
	for (const [message, respond] of cases) {
		const worker = new FakeWorker(respond);
		await assert.rejects(
			runEffect(workerRequest(worker)),
			(error) => error instanceof WorkerError && error.message === message,
		);
		assertReleased(worker);
	}
});

test("worker deadlines interrupt computation and finish cleanup before returning a typed timeout", async () => {
	const worker = new FakeWorker();
	await Effect.runPromise(
		Effect.gen(function* () {
			const fiber = yield* Effect.fork(workerRequest(worker));
			yield* TestClock.adjust("20 seconds");
			const exit = yield* Fiber.await(fiber);
			assert.ok(Exit.isFailure(exit));
			assert.ok(Cause.squash(exit.cause) instanceof ImportTimeout);
			assertReleased(worker);
		}).pipe(Effect.provide(TestContext.TestContext)),
	);
});

test("abort terminates pending workers once, preserves its reason and ignores late responses", async () => {
	const started = deferred();
	const worker = new FakeWorker(() => started.resolve());
	const controller = new AbortController();
	const pending = runEffect(workerRequest(worker), controller.signal);
	await started.promise;
	const late = worker.onmessage;
	const reason = new Error("superseded");
	controller.abort(reason);
	await assert.rejects(pending, (error) => error === reason);
	assertReleased(worker);
	late?.call(
		worker as unknown as Worker,
		new MessageEvent("message", { data: { result: "late" } }),
	);
	assertReleased(worker);
	const neverStarted = new FakeWorker();
	await assert.rejects(
		runEffect(workerRequest(neverStarted), controller.signal),
		(error) => error === reason,
	);
	assert.equal(neverStarted.posted.length, 0);
	assert.equal(neverStarted.terminated, 0);
});

test("batch imports preserve order, diagnostics and partial success without disposing transferred values", async () => {
	const files = ["board.zip", "broken.zip", "last.gbr"].map(
		(name) => new File(["data"], name),
	);
	const disposed: string[] = [];
	const parse: ImportFile<string> = (file) =>
		file.name === "bad.gbr"
			? Effect.fail(new InvalidFile({ message: "bad geometry" }))
			: Effect.map(
					acquireImported(Effect.succeed(file.name), (name) =>
						disposed.push(name),
					),
					(value) => ({ value, messages: ["warning"] }),
				);
	const result = await runEffect(
		importFilesEffect(files, parse, (file) =>
			file.name === "broken.zip"
				? Effect.fail(new ArchiveError({ message: "bad archive" }))
				: Effect.succeed(
						file.name === "board.zip"
							? {
									files: ["bottom.gbr", "bad.gbr", "top.gbr"].map(
										(name) => new File(["data"], name),
									),
									messages: ["Skipped manual.pdf (example)."],
								}
							: { files: [file] },
					),
		),
	);
	assert.deepEqual(result.values, ["bottom.gbr", "top.gbr", "last.gbr"]);
	assert.deepEqual(result.messages, [
		"board.zip: Skipped manual.pdf (example).",
		"bottom.gbr: warning",
		"bad.gbr: bad geometry",
		"top.gbr: warning",
		"broken.zip: bad archive",
		"last.gbr: warning",
	]);
	assert.deepEqual(disposed, []);
});

test("a failure after acquisition releases only that file while successful batch values survive", async () => {
	const disposed: string[] = [];
	const parse: ImportFile<string> = (file) =>
		Effect.gen(function* () {
			const value = yield* acquireImported(Effect.succeed(file.name), (name) =>
				disposed.push(name),
			);
			if (file.name === "bad.step")
				return yield* new InvalidFile({ message: "invalid metadata" });
			return { value };
		});
	const result = await runEffect(
		importFilesEffect(
			["first.step", "bad.step", "last.step"].map(
				(name) => new File(["STEP"], name),
			),
			parse,
		),
	);
	assert.deepEqual(result.values, ["first.step", "last.step"]);
	assert.deepEqual(result.messages, ["bad.step: invalid metadata"]);
	assert.deepEqual(disposed, ["bad.step"]);
});

test("interrupted batches dispose every acquired model including the current parse", async () => {
	const started = deferred();
	const disposed: string[] = [];
	const parse: ImportFile<string> = (file) =>
		Effect.gen(function* () {
			const value = yield* acquireImported(Effect.succeed(file.name), (name) =>
				disposed.push(name),
			);
			if (file.name === "second.step") {
				started.resolve();
				yield* Effect.never;
			}
			return { value };
		});
	const controller = new AbortController();
	const pending = runEffect(
		importFilesEffect(
			["first.step", "second.step", "third.step"].map(
				(name) => new File(["data"], name),
			),
			parse,
		),
		controller.signal,
	);
	await started.promise;
	controller.abort();
	await assert.rejects(pending, { name: "AbortError" });
	assert.deepEqual(disposed, ["second.step", "first.step"]);
});

test("STEP Promise results retain live geometry until the viewer disposes them", async (t) => {
	const disposeGeometry = t.mock.method(BufferGeometry.prototype, "dispose");
	const model: StepModel = {
		name: "part.step",
		meshes: [
			{
				id: "part",
				name: "part",
				attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } },
				index: { array: [0, 1, 2] },
			},
		],
	};
	const workers: FakeWorker[] = [];
	const previous = globalThis.Worker;
	globalThis.Worker = class extends FakeWorker {
		constructor() {
			super((worker) => queueMicrotask(() => worker.result(model)));
			workers.push(this);
		}
	} as unknown as typeof Worker;
	t.after(() => {
		globalThis.Worker = previous;
	});
	const imported = await parseStepFile(new File(["STEP"], "part.step"));
	assertReleased(workers[0]);
	assert.equal(disposeGeometry.mock.calls.length, 0);
	const mesh = imported.scene[0];
	assert.ok(mesh.type === "spatial" && mesh.object instanceof Mesh);
	assert.equal(mesh.object.geometry.getAttribute("position").count, 3);
	let disposed = 0;
	mesh.object.geometry.addEventListener("dispose", () => disposed++);
	assert.equal(disposed, 0);
	imported.dispose();
	imported.dispose();
	assert.equal(disposed, 1);
	assert.equal(disposeGeometry.mock.calls.length, 1);
});

test("ZIP failures remain typed and aborted reads cannot proceed to extraction", async () => {
	await assert.rejects(
		expandGerberFile(
			new File(["not a zip"], "broken.zip"),
			new AbortController().signal,
		),
		(error) =>
			error instanceof ArchiveError &&
			error.message === "Unable to read this ZIP archive.",
	);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		expandGerberFile(new File(["zip"], "cancelled.zip"), controller.signal),
		{ name: "AbortError" },
	);
});

test("React ownership retains staged models across stale commits and releases superseded models", () => {
	const ownership = new ImportOwnership();
	const disposed: string[] = [];
	const first = () => disposed.push("first");
	const second = () => disposed.push("second");
	const third = () => disposed.push("third");
	ownership.stage([first]);
	ownership.commit([first]);
	ownership.stage([second]);
	ownership.commit([first]);
	assert.deepEqual(disposed, []);
	ownership.stage([third]);
	ownership.commit([third]);
	assert.deepEqual(disposed, ["first", "second"]);
	ownership.dispose();
	ownership.dispose();
	assert.deepEqual(disposed, ["first", "second", "third"]);
});

test("unmount disposes every returned resource even if React never commits it", () => {
	const ownership = new ImportOwnership();
	const disposed: string[] = [];
	ownership.stage([() => disposed.push("uncommitted first")]);
	ownership.stage([() => disposed.push("uncommitted second")]);
	ownership.dispose();
	assert.deepEqual(disposed, ["uncommitted first", "uncommitted second"]);
});

test("Gerber metadata changes keep shared geometry and removed layers dispose exactly once", () => {
	const ownership = new ImportOwnership();
	let disposed = 0;
	const dispose = () => disposed++;
	ownership.stage([dispose]);
	ownership.commit([dispose]);
	ownership.stage([dispose]);
	ownership.commit([dispose]);
	assert.equal(disposed, 0);
	ownership.stage([]);
	ownership.commit([]);
	ownership.dispose();
	assert.equal(disposed, 1);
});
