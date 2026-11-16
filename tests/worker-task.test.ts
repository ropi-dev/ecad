import assert from "node:assert/strict";
import { test } from "node:test";
import {
	circuitLayoutQuality,
	createCircuitView,
	untangleCircuitGraph,
} from "@ecad/drawing-core/circuit/untangle.ts";
import {
	untangleCircuit,
	untangledCircuitView,
} from "#/circuit/untangle-client.ts";
import {
	inWorkerOrHere,
	keepWarm,
	type TaskWorker,
	type WorkerReply,
	workerReply,
} from "#/lib/worker-task.ts";
import { createTestCircuit } from "./fixtures/circuit.ts";

class FakeWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	onmessageerror: (() => void) | null = null;
	terminated = false;
	readonly posted: unknown[] = [];
	constructor(
		private readonly answer: (
			request: unknown,
		) => WorkerReply<unknown> | Promise<WorkerReply<unknown>> | "crash",
	) {}
	postMessage(request: unknown) {
		const copy = structuredClone(request);
		this.posted.push(copy);
		setTimeout(async () => {
			if (this.terminated) return;
			const reply = await this.answer(copy);
			if (reply === "crash") this.onerror?.();
			else this.onmessage?.({ data: structuredClone(reply) } as MessageEvent);
		});
	}
	terminate() {
		this.terminated = true;
	}
}

const started = (answer: ConstructorParameters<typeof FakeWorker>[0]) => {
	const worker = new FakeWorker(answer);
	return { worker, start: () => worker as unknown as Worker };
};

const doubled = (request: unknown) => ({ result: (request as number) * 2 });

test("a task runs in its worker, which serves several requests and stops when the task ends", async () => {
	const { worker, start } = started(doubled);
	const result = await inWorkerOrHere(
		start,
		async (ask) => (await ask<number>(2)) + (await ask<number>(10)),
		() => assert.fail("The page should not do a task its worker finished."),
	);
	assert.equal(result, 24);
	assert.deepEqual(worker.posted, [2, 10]);
	assert.equal(worker.terminated, true);
	assert.equal(worker.onmessage, null);
});

test("the page does the task when there is no worker, when it cannot start, when it crashes and when it declines", async () => {
	const here = () => "page";
	const inWorker = (ask: (request: unknown) => Promise<string>) => ask("job");
	assert.equal(await inWorkerOrHere(undefined, inWorker, here), "page");
	assert.equal(
		await inWorkerOrHere(
			() => {
				throw new Error("Blocked by the content security policy.");
			},
			inWorker,
			here,
		),
		"page",
	);
	const crashed = started(() => "crash");
	assert.equal(await inWorkerOrHere(crashed.start, inWorker, here), "page");
	assert.equal(crashed.worker.terminated, true);
	const declined = started(() => ({ unavailable: true }));
	assert.equal(await inWorkerOrHere(declined.start, inWorker, here), "page");
	assert.equal(declined.worker.terminated, true);
	const uncloneable = started(doubled);
	assert.equal(
		await inWorkerOrHere(
			uncloneable.start,
			(ask) => ask<string>(() => "functions cannot be posted"),
			here,
		),
		"page",
	);
});

test("an error the worker reports fails the task instead of repeating it in the page", async () => {
	const { worker, start } = started(() =>
		workerReply(() => {
			throw new RangeError("Export dimensions must be whole pixels.");
		}, "Export failed."),
	);
	let ranHere = false;
	await assert.rejects(
		inWorkerOrHere(
			start,
			(ask) => ask("job"),
			() => {
				ranHere = true;
			},
		),
		/Export dimensions must be whole pixels\./,
	);
	assert.equal(ranHere, false);
	assert.equal(worker.terminated, true);
	assert.deepEqual(
		await workerReply(() => {
			throw "not an error";
		}, "Export failed."),
		{ error: "Export failed." },
	);
});

test("aborting a task stops its worker and rejects with the reason", async () => {
	const controller = new AbortController();
	const { worker, start } = started(doubled);
	const task = inWorkerOrHere(
		start,
		(ask) => ask<number>(1),
		() => assert.fail("An aborted task should not run in the page."),
		{ signal: controller.signal },
	);
	controller.abort(new Error("The circuit was closed."));
	await assert.rejects(task, /The circuit was closed\./);
	assert.equal(worker.terminated, true);
	await assert.rejects(
		inWorkerOrHere(
			start,
			(ask) => ask<number>(1),
			() => 1,
			{ signal: controller.signal },
		),
		/The circuit was closed\./,
	);

	const closing = new AbortController();
	const crashing = started(doubled);
	await assert.rejects(
		inWorkerOrHere(
			crashing.start,
			(ask) => {
				const answer = ask<number>(1);
				crashing.worker.onerror?.();
				closing.abort(new Error("The circuit was closed."));
				return answer;
			},
			() => assert.fail("A crash after the abort should not run in the page."),
			{ signal: closing.signal },
		),
		/The circuit was closed\./,
	);
});

test("a worker that never answers is stopped and the page does the task", async () => {
	const { worker, start } = started(() => new Promise(() => undefined));
	assert.equal(
		await inWorkerOrHere(
			start,
			(ask) => ask<string>("job"),
			() => "page",
			{ timeout: 20 },
		),
		"page",
	);
	assert.equal(worker.terminated, true);

	const stuck = started((request) =>
		request === "second" ? new Promise(() => undefined) : { result: "first" },
	);
	let stoppedBeforeFallback: boolean | undefined;
	assert.equal(
		await inWorkerOrHere(
			stuck.start,
			async (ask) => {
				await ask<string>("first");
				try {
					return await ask<string>("second");
				} catch {
					stoppedBeforeFallback = stuck.worker.terminated;
					await new Promise((resolve) => setTimeout(resolve, 5));
					return "recovered";
				}
			},
			() => assert.fail("The task recovered without the page fallback."),
			{ timeout: 20 },
		),
		"recovered",
	);
	assert.equal(stoppedBeforeFallback, true);

	const declining = started(() => ({ unavailable: true }));
	let stoppedOnDecline: boolean | undefined;
	await inWorkerOrHere(
		declining.start,
		async (ask) => {
			try {
				return await ask<string>("job");
			} catch {
				stoppedOnDecline = declining.worker.terminated;
				return "recovered";
			}
		},
		() => "page",
	);
	assert.equal(stoppedOnDecline, true);

	const prompt = started(doubled);
	assert.equal(
		await inWorkerOrHere(
			prompt.start,
			(ask) => ask<number>(4),
			() => assert.fail("A prompt worker should finish the task."),
			{ timeout: 5_000 },
		),
		8,
	);
});

test("untangling in a worker lays the circuit out as the page would", async () => {
	const file = createTestCircuit();
	const expected = untangleCircuitGraph(file);
	const workers: FakeWorker[] = [];
	const start = () => {
		const worker = new FakeWorker((request) =>
			workerReply(
				() => untangleCircuitGraph(request as typeof file),
				"Unable to untangle this circuit.",
			),
		);
		workers.push(worker);
		return worker as unknown as Worker;
	};
	assert.deepEqual(await untangleCircuit(file, undefined, start), expected);
	assert.deepEqual(workers[0]?.posted, [file]);
	assert.equal(workers[0]?.terminated, true);
	assert.deepEqual(await untangleCircuit(file), expected);

	const view = await untangledCircuitView(file.circuit, undefined, start);
	assert.deepEqual(view, createCircuitView(file.circuit));
	assert.equal(circuitLayoutQuality(view).overlaps, 0);

	const broken = structuredClone(file);
	broken.circuit.nets[0]?.pinIds.push("missing-pin");
	await assert.rejects(
		untangleCircuit(broken, undefined, start),
		/Graph references an unknown pin\./,
	);
	assert.equal(workers.length, 3);
	assert.ok(workers.every((worker) => worker.terminated));
});

test("a warm worker serves the next task, and one that was stopped mid-request, crashed or sat idle is replaced", async () => {
	const workers: FakeWorker[] = [];
	const start = keepWarm(() => {
		const worker = new FakeWorker((request) =>
			request === "hang" ? new Promise(() => undefined) : doubled(request),
		);
		workers.push(worker);
		return worker as unknown as TaskWorker;
	}, 30);
	const double = (value: number) =>
		inWorkerOrHere(
			start,
			(ask) => ask<number>(value),
			() => assert.fail("The worker should answer."),
		);

	assert.equal(await double(2), 4);
	assert.equal(await double(5), 10);
	assert.equal(workers.length, 1);
	assert.deepEqual(workers[0]?.posted, [2, 5]);
	assert.equal(workers[0]?.terminated, false);

	assert.deepEqual(await Promise.all([double(1), double(3)]), [2, 6]);
	assert.equal(workers.length, 2);
	assert.equal(
		workers.filter((worker) => worker.terminated).length,
		1,
		"Only one worker stays warm.",
	);

	const controller = new AbortController();
	const hung = inWorkerOrHere(
		start,
		(ask) => ask<number>("hang"),
		() => 0,
		{ signal: controller.signal },
	);
	controller.abort(new Error("The circuit was closed."));
	await assert.rejects(hung, /The circuit was closed\./);
	assert.equal(
		workers.every((worker) => worker.terminated),
		true,
	);
	assert.equal(await double(4), 8);
	assert.equal(workers.length, 3);

	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(workers[2]?.terminated, true);
	assert.equal(await double(6), 12);
	assert.equal(workers.length, 4);

	const crashing = keepWarm(
		() => new FakeWorker(() => "crash") as unknown as TaskWorker,
		30,
	);
	assert.equal(
		await inWorkerOrHere(
			crashing,
			(ask) => ask<string>("job"),
			() => "page",
		),
		"page",
	);
});
