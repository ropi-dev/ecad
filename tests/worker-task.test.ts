import assert from "node:assert/strict";
import { test } from "node:test";
import { inWorkerOrHere, type WorkerReply } from "#/lib/worker-task.ts";

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
