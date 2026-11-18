import assert from "node:assert/strict";
import test from "node:test";
import { runEffect } from "@ecad/drawing-core/lib/effect.ts";
import { Cause, Effect, Exit, Fiber, TestClock, TestContext } from "effect";
import {
	ArchiveError,
	acquireImported,
	ImportTimeout,
	InvalidFile,
	requestWorker,
} from "#/formats/import-effects.ts";
import { type ImportFile, importFilesEffect } from "#/formats/importFiles.ts";

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
