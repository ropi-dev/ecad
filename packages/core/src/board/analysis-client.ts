import type { RatsnestLine } from "@ecad/drawing-core/board/connectivity.ts";
import type { DrcFinding } from "@ecad/drawing-core/board/drc.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type AnalysisKind,
	type AnalysisReply,
	type AnalysisRequest,
	createBoardAnalysis,
	createShapesSender,
} from "#/board/analysis.ts";
import type { FabricationArchive } from "#/board/fabrication.ts";
import type { BoardFill } from "#/board/fill.ts";

export interface BoardAnalysisState {
	fills: readonly BoardFill[];
	ratsnest: readonly RatsnestLine[] | undefined;
	error: string;
}

export interface BoardAnalysisClient {
	configure(circuit: Circuit | undefined, rules: BoardRules): void;
	show(committed: readonly EditorShape[], live: readonly EditorShape[]): void;
	check(shapes: readonly EditorShape[]): Promise<DrcFinding[]>;
	fabricate(
		name: string,
		shapes: readonly EditorShape[],
	): Promise<FabricationArchive>;
	getState(): BoardAnalysisState;
	subscribe(listener: () => void): () => void;
	dispose(): void;
}

type Shapes = readonly EditorShape[];
type Settle = {
	resolve(reply: AnalysisReply): void;
	reject(cause: Error): void;
};
interface Flight extends Settle {
	type: AnalysisKind;
	shapes: Shapes;
	name: string;
}

const CLOSED = "The board was closed.";

const sameLines = (
	a: readonly RatsnestLine[] | undefined,
	b: readonly RatsnestLine[],
) =>
	a !== undefined &&
	a.length === b.length &&
	a.every((line, index) => {
		const other = b[index];
		return (
			line.net === other.net &&
			line.from.x === other.from.x &&
			line.from.y === other.from.y &&
			line.to.x === other.to.x &&
			line.to.y === other.to.y
		);
	});

export function createBoardAnalysisClient(
	startWorker: (() => Worker) | undefined,
): BoardAnalysisClient {
	let state: BoardAnalysisState = { fills: [], ratsnest: undefined, error: "" };
	const listeners = new Set<() => void>();
	const flights = new Map<number, Flight>();
	let nextId = 1;
	let disposed = false;
	let board: { circuit: Circuit | undefined; rules: BoardRules } | undefined;
	const sender = createShapesSender();
	let worker: Worker | undefined;
	let analyseHere: ReturnType<typeof createBoardAnalysis> | undefined;
	const wanted: { fills?: Shapes; connectivity?: Shapes } = {};
	const shown: { fills?: Shapes; connectivity?: Shapes } = {};
	const pending: { fills?: Shapes; connectivity?: Shapes } = {};
	const failed: { fills?: string; connectivity?: string } = {};
	let fillsRequested = 0;
	let connectedToFills = -1;
	let generation = 0;

	const publish = (next: Partial<BoardAnalysisState>) => {
		state = { ...state, ...next };
		for (const listener of listeners) listener();
	};

	const receive = (reply: AnalysisReply) => {
		const flight = flights.get(reply.id);
		if (!flight) return;
		flights.delete(reply.id);
		if (reply.type === "error") flight.reject(new Error(reply.message));
		else flight.resolve(reply);
	};

	const post = (request: AnalysisRequest) => {
		if (analyseHere) {
			const analyse = analyseHere;
			setTimeout(() => {
				if (disposed) return;
				const reply = analyse(request);
				if (reply instanceof Promise) void reply.then(receive);
				else if (reply) receive(reply);
			});
			return;
		}
		worker?.postMessage(request);
	};

	const send = (id: number, { type, shapes, name }: Flight) => {
		const patch = sender.patch(shapes);
		post(
			type === "fabrication"
				? { type, id, shapes: patch, name }
				: { type, id, shapes: patch },
		);
	};

	const runHere = () => {
		if (disposed || analyseHere) return;
		if (worker && import.meta.env?.DEV)
			console.warn("The board analysis worker failed. Analysing in the page.");
		worker?.terminate();
		worker = undefined;
		analyseHere = createBoardAnalysis();
		sender.reset();
		if (board) post({ type: "board", ...board });
		for (const [id, flight] of flights) send(id, flight);
		restart();
	};

	const requested = (type: AnalysisKind, shapes: Shapes, name = "") =>
		new Promise<AnalysisReply>((resolve, reject) => {
			if (disposed) {
				reject(new Error(CLOSED));
				return;
			}
			const id = nextId++;
			if (type === "fills") fillsRequested++;
			const flight = { type, shapes, name, resolve, reject };
			flights.set(id, flight);
			send(id, flight);
		});

	const current = (kind: "fills" | "connectivity", shapes: Shapes) =>
		shown[kind] === shapes &&
		(kind === "fills" || connectedToFills === fillsRequested);

	const pump = (kind: "fills" | "connectivity") => {
		const shapes = wanted[kind];
		if (disposed || !board || !shapes) return;
		if (pending[kind] || current(kind, shapes)) return;
		pending[kind] = shapes;
		const asked = generation;
		const request = requested(kind, shapes);
		const fills = fillsRequested;
		const settle = (failure: string) => {
			pending[kind] = undefined;
			if (asked === generation) {
				shown[kind] = shapes;
				failed[kind] = failure;
				if (kind === "connectivity") connectedToFills = fills;
				const error = failed.fills || failed.connectivity || "";
				if (error !== state.error) publish({ error });
			}
			pump("fills");
			pump("connectivity");
		};
		request.then(
			(reply) => {
				if (asked !== generation) settle("");
				else if (reply.type === "fills") {
					publish({ fills: reply.fills });
					settle("");
				} else {
					if (
						reply.type === "connectivity" &&
						!sameLines(state.ratsnest, reply.ratsnest)
					)
						publish({ ratsnest: reply.ratsnest });
					settle("");
				}
			},
			(cause: Error) => {
				if (!disposed) settle(cause.message);
			},
		);
	};

	const restart = () => {
		generation++;
		shown.fills = undefined;
		connectedToFills = -1;
		pump("fills");
		pump("connectivity");
	};

	if (startWorker)
		try {
			worker = startWorker();
			worker.onmessage = (event: MessageEvent<AnalysisReply>) =>
				receive(event.data);
			worker.onerror = runHere;
			worker.onmessageerror = runHere;
		} catch {
			runHere();
		}
	else runHere();

	return {
		configure(circuit, rules) {
			if (board && board.circuit === circuit && board.rules === rules) return;
			board = { circuit, rules };
			post({ type: "board", circuit, rules });
			restart();
		},
		show(committed, live) {
			wanted.fills = committed;
			wanted.connectivity = live;
			pump("fills");
			pump("connectivity");
		},
		async check(shapes) {
			const reply = await requested("check", shapes);
			return reply.type === "check" ? reply.findings : [];
		},
		async fabricate(name, shapes) {
			const reply = await requested("fabrication", shapes, name);
			if (reply.type !== "fabrication")
				throw new Error("Unable to export fabrication files");
			return { archive: reply.archive, files: reply.files };
		},
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			disposed = true;
			worker?.terminate();
			worker = undefined;
			analyseHere = undefined;
			for (const flight of flights.values()) flight.reject(new Error(CLOSED));
			flights.clear();
			listeners.clear();
		},
	};
}

export const startBoardAnalysisWorker =
	typeof Worker === "undefined"
		? undefined
		: () =>
				new Worker(new URL("./analysis.worker.ts", import.meta.url), {
					type: "module",
				});
