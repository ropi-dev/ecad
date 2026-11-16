import {
	analyzeConnectivity,
	copperItems,
	type RatsnestLine,
} from "@ecad/drawing-core/board/connectivity.ts";
import { checkBoard, type DrcFinding } from "@ecad/drawing-core/board/drc.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import {
	type BoardRules,
	defaultBoardRules,
} from "@ecad/drawing-core/board/rules.ts";
import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { FabricationArchive } from "#/board/fabrication.ts";
import {
	type BoardFill,
	boardFills,
	fillReach,
	fillZones,
	type ZoneFill,
} from "#/board/fill.ts";

export interface ShapesPatch {
	ids?: readonly number[];
	changed?: readonly EditorShape[];
}

export type AnalysisKind = "fills" | "connectivity" | "check" | "fabrication";

export type AnalysisRequest =
	| { type: "board"; circuit: Circuit | undefined; rules: BoardRules }
	| {
			type: "fills" | "connectivity" | "check";
			id: number;
			shapes: ShapesPatch;
	  }
	| { type: "fabrication"; id: number; shapes: ShapesPatch; name: string };

export type AnalysisReply =
	| { type: "fills"; id: number; fills: BoardFill[] }
	| { type: "connectivity"; id: number; ratsnest: RatsnestLine[] }
	| { type: "check"; id: number; findings: DrcFinding[] }
	| ({ type: "fabrication"; id: number } & FabricationArchive)
	| { type: "error"; id: number; message: string };

export type Fabricate = (
	name: string,
	shapes: readonly EditorShape[],
	fills: readonly ZoneFill[],
	maskMargin: number,
) => FabricationArchive | Promise<FabricationArchive>;

const STALE_SHAPES = 64;

const prune = (
	held: Map<number, EditorShape>,
	shapes: readonly EditorShape[],
) =>
	held.size > 2 * shapes.length + STALE_SHAPES
		? new Map(shapes.map((shape) => [shape.id, shape]))
		: held;

export function createShapesSender() {
	let sent: readonly EditorShape[] = [];
	let held = new Map<number, EditorShape>();
	return {
		patch(shapes: readonly EditorShape[]): ShapesPatch {
			if (shapes === sent) return {};
			const changed: EditorShape[] = [];
			for (const shape of shapes)
				if (held.get(shape.id) !== shape) {
					held.set(shape.id, shape);
					changed.push(shape);
				}
			held = prune(held, shapes);
			sent = shapes;
			return { ids: shapes.map((shape) => shape.id), changed };
		},
		reset() {
			sent = [];
			held = new Map();
		},
	};
}

function createShapesReceiver() {
	let shapes: EditorShape[] = [];
	let held = new Map<number, EditorShape>();
	return ({ ids, changed }: ShapesPatch) => {
		if (!ids) return shapes;
		for (const shape of changed ?? []) held.set(shape.id, shape);
		shapes = ids.flatMap((id) => held.get(id) ?? []);
		held = prune(held, shapes);
		return shapes;
	};
}

export interface BoardAnalysis {
	(
		request: Exclude<AnalysisRequest, { type: "fabrication" }>,
	): AnalysisReply | undefined;
	(
		request: AnalysisRequest,
	): AnalysisReply | Promise<AnalysisReply> | undefined;
}

export function createBoardAnalysis(fabricate: Fabricate): BoardAnalysis {
	const receive = createShapesReceiver();
	let netlist = boardNetlist(undefined);
	let rules: BoardRules = defaultBoardRules;
	let fills: ZoneFill[] = [];
	return ((request: AnalysisRequest) => {
		if (request.type === "board") {
			netlist = boardNetlist(request.circuit);
			rules = request.rules;
			return undefined;
		}
		const { type, id } = request;
		const failed = (cause: unknown): AnalysisReply => ({
			type: "error",
			id,
			message: errorMessage(cause, "The analysis stopped."),
		});
		try {
			const current = receive(request.shapes);
			if (type === "fabrication") {
				const made = fabricate(
					request.name,
					current,
					fillZones(current, netlist, rules),
					rules.solderMaskMargin,
				);
				return made instanceof Promise
					? made.then((archive) => ({ type, id, ...archive }), failed)
					: { type, id, ...made };
			}
			if (type === "fills") {
				fills = fillZones(current, netlist, rules);
				return { type, id, fills: boardFills(fills) };
			}
			if (type === "connectivity")
				return {
					type,
					id,
					ratsnest: [
						...analyzeConnectivity(
							copperItems(current, netlist),
							fillReach(fills),
						).ratsnest,
					],
				};
			return {
				type,
				id,
				findings: checkBoard(current, netlist, rules, {
					zoneReach: fillReach(fillZones(current, netlist, rules)),
				}),
			};
		} catch (cause) {
			return failed(cause);
		}
	}) as BoardAnalysis;
}
