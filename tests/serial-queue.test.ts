import assert from "node:assert/strict";
import { test } from "node:test";
import { createSerialQueue } from "#/lib/serial-queue.ts";
import { required } from "./helpers/required.ts";

const later = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

test("queued tasks run one at a time in call order", async () => {
	const enqueue = createSerialQueue();
	const events: string[] = [];
	const task = (name: string, delay: number) => async () => {
		events.push(`start ${name}`);
		await new Promise((resolve) => setTimeout(resolve, delay));
		events.push(`end ${name}`);
		return name;
	};
	const results = await Promise.all([
		enqueue(task("slow", 20)),
		enqueue(task("fast", 1)),
		enqueue(() => "sync"),
	]);
	assert.deepEqual(results, ["slow", "fast", "sync"]);
	assert.deepEqual(events, [
		"start slow",
		"end slow",
		"start fast",
		"end fast",
	]);
});

test("a task does not start until the caller's turn, even when queued synchronously", async () => {
	const enqueue = createSerialQueue();
	let started = false;
	const pending = enqueue(async () => {
		started = true;
	});
	assert.equal(started, false);
	await pending;
	assert.equal(started, true);
});

test("a rejected task fails only its own promise", async () => {
	const enqueue = createSerialQueue();
	const failure = new Error("Disk full");
	const order: string[] = [];
	const first = enqueue(async () => {
		await later();
		order.push("first");
		throw failure;
	});
	const second = enqueue(async () => {
		order.push("second");
		return 2;
	});
	await assert.rejects(first, failure);
	assert.equal(await second, 2);
	assert.deepEqual(order, ["first", "second"]);
});

test("a task that throws synchronously rejects instead of throwing and does not wedge the queue", async () => {
	const enqueue = createSerialQueue();
	const failure = new Error("Invalid name");
	let result: Promise<never> | undefined;
	assert.doesNotThrow(() => {
		result = enqueue(() => {
			throw failure;
		});
	});
	await assert.rejects(required(result), failure);
	assert.equal(await enqueue(() => "next"), "next");
});

test("separate queues do not wait for each other", async () => {
	const first = createSerialQueue();
	const second = createSerialQueue();
	let release!: () => void;
	const blocked = first(
		() => new Promise<void>((resolve) => (release = resolve)),
	);
	assert.equal(await second(() => "independent"), "independent");
	release();
	await blocked;
});
