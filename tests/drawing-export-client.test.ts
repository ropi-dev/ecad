import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { exportDrawing, warmDrawingExport } from "#/drawing/export-client.ts";
import {
	type DrawingExportRequest,
	drawingExportReply,
} from "#/drawing/export-reply.ts";
import {
	keepWarm,
	type TaskWorker,
	type WorkerReply,
} from "#/lib/worker-task.ts";

const options = {
	width: 100,
	height: 50,
	area: "sheet" as const,
	background: "white" as const,
	sheet: { width: 420, height: 297 },
};
const workerSvg = '<svg data-from="worker"/>';

class ExportWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	onmessageerror: (() => void) | null = null;
	terminated = false;
	readonly posted: DrawingExportRequest[] = [];
	constructor(private readonly png: WorkerReply<Blob>) {}
	postMessage(request: DrawingExportRequest) {
		this.posted.push(request);
		const reply: WorkerReply<string | Blob | boolean> =
			request.type === "svg"
				? { result: workerSvg }
				: request.type === "warm"
					? { result: true }
					: this.png;
		setTimeout(() => this.onmessage?.({ data: reply } as MessageEvent));
	}
	terminate() {
		this.terminated = true;
	}
}

const started = (png: WorkerReply<Blob>) => {
	const worker = new ExportWorker(png);
	return { worker, start: () => worker as unknown as Worker };
};

const browser = globalThis as unknown as Record<string, unknown>;
const names = ["Image", "createImageBitmap", "document", "OffscreenCanvas"];
let saved: [string, unknown][] = [];
let decoded: Blob[] = [];
let painted = 0;
let closed = 0;
const createObjectURL = URL.createObjectURL;
const bitmap = (width = 100, height = 50) => ({
	width,
	height,
	close: () => closed++,
});

beforeEach(() => {
	saved = names.map((name) => [name, browser[name]]);
	decoded = [];
	painted = 0;
	closed = 0;
	URL.createObjectURL = (blob) => {
		decoded.push(blob as Blob);
		return createObjectURL(blob);
	};
	browser.Image = class {
		src = "";
		decode = async () => undefined;
	};
	browser.createImageBitmap = async () => bitmap();
	browser.document = {
		createElement: () => ({
			width: 0,
			height: 0,
			getContext: () => ({
				fillStyle: "",
				fillRect: () => undefined,
				drawImage: () => painted++,
			}),
			toBlob: (done: (blob: Blob) => void) => done(new Blob(["page png"])),
		}),
	};
});

afterEach(() => {
	URL.createObjectURL = createObjectURL;
	for (const [name, value] of saved)
		if (value === undefined) delete browser[name];
		else browser[name] = value;
});

const sources = () => Promise.all(decoded.map((blob) => blob.text()));

test("a PNG is encoded by the worker from the bitmap of the SVG it built", async () => {
	const { worker, start } = started({ result: new Blob(["worker png"]) });
	const png = await exportDrawing([], options, "png", start);
	assert.equal(await png.text(), "worker png");
	assert.deepEqual(
		worker.posted.map((request) => request.type),
		["svg", "png"],
	);
	const [built] = worker.posted;
	assert.equal(built.type === "svg" && built.options.coverOutput, true);
	assert.deepEqual(await sources(), [workerSvg]);
	assert.equal(painted, 0);
	assert.equal(worker.terminated, true);

	const vector = started({ result: new Blob() });
	const svg = await exportDrawing([], options, "svg", vector.start);
	assert.equal(svg.type, "image/svg+xml");
	assert.equal(await svg.text(), workerSvg);
	const [request] = vector.worker.posted;
	assert.equal(request.type === "svg" && request.options.coverOutput, false);
	assert.equal(vector.worker.posted.length, 1);
});

test("an export started while the worker warms up waits for that worker and leaves it warm", async () => {
	const workers: ExportWorker[] = [];
	const start = keepWarm(() => {
		const worker = new ExportWorker({ result: new Blob() });
		workers.push(worker);
		return worker as unknown as TaskWorker;
	}, 30);
	const warmed = warmDrawingExport(start);
	const svg = await exportDrawing([], options, "svg", start);
	assert.equal(await svg.text(), workerSvg);
	assert.equal(await warmed, true);
	assert.equal(workers.length, 1);
	assert.deepEqual(
		workers[0]?.posted.map((request) => request.type),
		["warm", "svg"],
	);
	assert.equal(workers[0]?.terminated, false);
	await exportDrawing([], options, "svg", start);
	assert.equal(workers.length, 1);
});

test("when the worker cannot encode the PNG the page paints the SVG the worker already built", async () => {
	for (const reply of [
		{ unavailable: true } as const,
		{ error: "Export failed." },
	]) {
		decoded = [];
		painted = 0;
		closed = 0;
		const { worker, start } = started(reply);
		const png = await exportDrawing([], options, "png", start);
		assert.equal(await png.text(), "page png");
		assert.deepEqual(
			worker.posted.map((request) => request.type),
			["svg", "png"],
		);
		assert.deepEqual(await sources(), [workerSvg, workerSvg]);
		assert.equal(painted, 1);
		assert.equal(closed, 1);
	}
});

test("a browser that cannot make the bitmap, or makes one of another size, paints the PNG in the page", async () => {
	browser.createImageBitmap = async () => {
		throw new DOMException("The source image could not be decoded.");
	};
	const refused = started({ result: new Blob(["worker png"]) });
	const first = await exportDrawing([], options, "png", refused.start);
	assert.equal(await first.text(), "page png");
	assert.deepEqual(
		refused.worker.posted.map((request) => request.type),
		["svg"],
	);

	browser.createImageBitmap = async () => bitmap(99, 50);
	const resized = started({ result: new Blob(["worker png"]) });
	const second = await exportDrawing([], options, "png", resized.start);
	assert.equal(await second.text(), "page png");
	assert.deepEqual(
		resized.worker.posted.map((request) => request.type),
		["svg"],
	);
	assert.equal(closed, 1);
	assert.equal(painted, 2);
});

test("the export worker encodes the bitmap it is given, and hands the export back when it cannot", async () => {
	const image = bitmap() as unknown as ImageBitmap;
	assert.deepEqual(await drawingExportReply({ type: "png", image }), {
		unavailable: true,
	});

	let context: unknown = null;
	browser.OffscreenCanvas = class {
		constructor(
			readonly width: number,
			readonly height: number,
		) {}
		getContext = () => context;
		convertToBlob = async () => new Blob([`${this.width}x${this.height}`]);
	};
	assert.deepEqual(await drawingExportReply({ type: "png", image }), {
		unavailable: true,
	});
	assert.equal(closed, 1);

	context = {
		transferFromImageBitmap: () => {
			throw new Error("The bitmap is detached.");
		},
	};
	assert.deepEqual(await drawingExportReply({ type: "png", image }), {
		unavailable: true,
	});
	assert.equal(closed, 2);

	const taken: unknown[] = [];
	context = {
		transferFromImageBitmap: (bitmap: unknown) => taken.push(bitmap),
	};
	const reply = await drawingExportReply({ type: "png", image });
	assert.ok("result" in reply && reply.result instanceof Blob);
	assert.equal(await reply.result.text(), "100x50");
	assert.deepEqual(taken, [image]);
	assert.equal(closed, 2);
});
