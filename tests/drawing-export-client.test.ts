import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { exportDrawing } from "#/drawing/export-client.ts";
import type { DrawingExportRequest } from "#/drawing/export-reply.ts";
import type { WorkerReply } from "#/lib/worker-task.ts";

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
	constructor(private readonly png: WorkerReply<Blob | Uint8Array>) {}
	postMessage(request: DrawingExportRequest) {
		this.posted.push(request);
		const reply: WorkerReply<string | Blob | Uint8Array | boolean> =
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

const started = (png: WorkerReply<Blob | Uint8Array>) => {
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

test("a PDF comes from the worker in one request, or from the page when the worker gives it back", async () => {
	const { worker, start } = started({
		result: new Uint8Array([37, 80, 68, 70]),
	});
	const pdf = await exportDrawing(
		[],
		{ ...options, title: "Board" },
		"pdf",
		start,
	);
	assert.equal(pdf.type, "application/pdf");
	assert.equal(await pdf.text(), "%PDF");
	assert.deepEqual(worker.posted, [
		{
			type: "pdf",
			shapes: [],
			options: {
				area: "sheet",
				background: "white",
				sheet: options.sheet,
				title: "Board",
				layers: false,
			},
		},
	]);

	const refused = started({ unavailable: true });
	const page = await exportDrawing([], options, "pdf", refused.start);
	assert.equal(page.type, "application/pdf");
	assert.match(
		await page.text(),
		/^%PDF-1\.4\n[\s\S]*\/Title <feff00440072006100770069006e0067>/,
	);
	assert.equal(refused.worker.terminated, true);
});
