import type {
	CopperItem,
	CopperLayer,
} from "@ecad/drawing-core/board/connectivity.ts";
import { outlineEncloses } from "@ecad/drawing-core/board/geometry.ts";
import { ruleVia } from "@ecad/drawing-core/board/routing-grid.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import {
	type TrackPosture,
	type TrackRouting,
	trackPath,
} from "@ecad/drawing-core/board/track-router.ts";
import { isNetLabel } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	canInspectSymbolChild,
	canSelectShape,
	canSelectSymbolChild,
	constrainWireEndpoint,
	drawShape,
	type EditorShape,
	type EditorSymbol,
	findWireConnection,
	hitsHollowInterior,
	isUnsafeMove,
	openPins,
	prepareMove,
	type ResizeHandle,
	routeWire,
	type ShapeKind,
	shapeAt,
	snapPoint,
	symbolChildAt,
	UNSAFE_MOVE_MESSAGE,
	withFullRouting,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { Heading } from "@ecad/drawing-core/drawing/wire-router.ts";
import {
	createWireRoutingContext,
	finalHeading,
	pathWires,
	routeWireConnection,
	routingPitch,
	type WireRoutingContext,
	wireEnds,
} from "@ecad/drawing-core/drawing/wire-routing.ts";
import { withZoneOutline } from "@ecad/drawing-core/drawing/zone-outline.ts";
import {
	copperLayers,
	type FootprintLayer,
	type PadType,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	createHole,
	createPad,
	createVia,
	newPadLayers,
	nextPadNumber,
	onFootprintLayer,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { freeze } from "@ecad/drawing-core/lib/freeze.ts";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import {
	otherCopperLayer,
	trackAnchor,
	trackSegments,
} from "#/board/routing.ts";
import {
	type CanvasDrag,
	type CanvasMarquee,
	canvasDragStep,
} from "#/components/editor/canvasDrag.ts";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import {
	applySelection,
	selectionMode,
} from "#/components/editor/selectionMode.ts";
import { shortcutModifier } from "#/components/viewer/shortcutModifier.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
import {
	createPlacementShape,
	isPlacementTool,
	type PlacementTool,
	placementLabel,
	placementSnapsToConnection,
} from "#/drawing/placement.ts";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export type CanvasTool =
	| "net"
	| "supply"
	| ShapeKind
	| "select"
	| "pan"
	| "symbol"
	| PadTool
	| "via"
	| "hole"
	| "track"
	| "zone"
	| "zone-polygon"
	| "outline";
type PadTool = "smd-pad" | "through-hole-pad";
const padToolTypes: Record<PadTool, PadType> = {
	"smd-pad": "smd",
	"through-hole-pad": "through-hole",
};
const isPadTool = (tool: string): tool is PadTool =>
	Object.hasOwn(padToolTypes, tool);
type Drag = CanvasDrag;
interface WireChain {
	start: Point;
	pointerId: number;
	/** Whether `start` is the pin the wire began at, so its lead sets the first direction. */
	fromPin: boolean;
	/** Direction of the last placed segment, preferred for the next one. */
	heading?: Heading;
}

interface TrackChain {
	start: Point;
	layer: CopperLayer;
	net?: string;
	netless: number[];
	pointerId: number;
	posture: TrackPosture;
	/** Where the chain last reached every copper layer, through a via or through-hole pad. */
	through?: Point;
}

interface ZoneChain {
	/** The corners placed so far. */
	points: Point[];
	layer: CopperLayer;
	net?: string;
	pointerId: number;
}

type CanvasGesture =
	| { kind: "idle" }
	| { kind: "drag"; drag: Drag }
	| { kind: "wire"; wire: WireChain }
	| { kind: "track"; track: TrackChain }
	| { kind: "zone"; zone: ZoneChain };

/** What the board tools need from the board editor. */
export interface BoardGestures {
	/** Copper on the visible layers, in board coordinates. */
	items(): readonly CopperItem[];
	/** Copper on every layer, hidden ones too. */
	copper(): readonly CopperItem[];
	rules: BoardRules;
	/** The copper layer new tracks, zones and copper graphics go on. */
	copperLayer: CopperLayer;
	/** The board's copper layers, front first. */
	copperLayers: readonly CopperLayer[];
	setCopperLayer(layer: CopperLayer): void;
	/** The net a new zone or via takes at a point. */
	netAt(point: Point): string | undefined;
}

interface ToolHandler {
	press?: (event: PointerEvent, point: Point, start: Point) => void;
	hover?: (canvas: HTMLCanvasElement, point: Point) => boolean;
	create?: (start: Point) => EditorShape;
}

export interface CanvasGesturesOptions {
	session: EditorSession;
	cameraView: CanvasView;
	tool: CanvasTool;
	setTool: (tool: CanvasTool) => void;
	shapes: EditorShape[];
	selected: EditorShape[];
	selectedIds: ReadonlySet<number>;
	selectedChildKey: string | null;
	selectedSymbol: EditorSymbol | undefined;
	allowLocked: boolean;
	handles: {
		shape: EditorShape;
		handle: ResizeHandle;
		childKey: string | undefined;
	}[];
	ready: boolean;
	gridStep: number;
	symbolDefinition: SymbolDefinition | null;
	sheetless: boolean;
	footprintLayer?: FootprintLayer;
	board?: BoardGestures;
	setTextFocusId: (id: number | null) => void;
	openAttributes: () => void;
}

const samePoint = (a: Point | null, b: Point | null) =>
	a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);

export function useCanvasGestures(getOptions: () => CanvasGesturesOptions) {
	const options = new Proxy({} as CanvasGesturesOptions, {
		get: (_, key) => getOptions()[key as keyof CanvasGesturesOptions],
	});
	const tool = createMemo(() => options.tool);
	const symbolDefinition = createMemo(() => options.symbolDefinition);
	const selected = createMemo(() => options.selected);
	const shapes = createMemo(() => options.shapes);
	const [marquee, setMarquee] = createSignal<CanvasMarquee | null>(null);
	const [placementRotation, setPlacementRotation] = createSignal(() => {
		tool();
		symbolDefinition();
		return 0;
	});
	const canRotatePlacement = createMemo(
		() =>
			isPlacementTool(tool()) ||
			isPadTool(tool()) ||
			(tool() === "symbol" && !!symbolDefinition()),
	);
	const placing = createMemo(
		() =>
			canRotatePlacement() ||
			tool() === "via" ||
			tool() === "hole" ||
			tool() === "track" ||
			tool() === "zone" ||
			tool() === "zone-polygon" ||
			tool() === "outline",
	);
	const onLayer = <Shape extends EditorShape>(shape: Shape): Shape => {
		const layer = options.footprintLayer;
		return layer ? onFootprintLayer(shape, layer) : shape;
	};
	const rotatePlacement = (angle: number) =>
		setPlacementRotation((rotation) => (rotation + angle) % (2 * Math.PI));
	const [pendingPreview, setPlacementPreview] = createSignal<{
		tool: CanvasTool;
		symbolDefinition: SymbolDefinition | null;
		shape: EditorShape;
	} | null>(null);
	const placementPreview = createMemo(() => {
		const pending = pendingPreview();
		return pending?.tool === tool() &&
			pending.symbolDefinition === symbolDefinition()
			? { ...pending.shape, rotation: placementRotation() }
			: null;
	});
	const clearPlacementPreview = () => setPlacementPreview(null);
	let gesture: CanvasGesture = { kind: "idle" };
	const getDrag = () => (gesture.kind === "drag" ? gesture.drag : null);
	const getWireChain = () => (gesture.kind === "wire" ? gesture.wire : null);
	const getTrack = () => (gesture.kind === "track" ? gesture.track : null);
	const getZoneChain = () => (gesture.kind === "zone" ? gesture.zone : null);
	const getWire = () => getWireChain() ?? getTrack() ?? getZoneChain();
	createEffect(
		() => [tool(), selected(), shapes()] as const,
		([current, selection, drawing]) => {
			if (current !== "select" || !selection.length) return;
			if (typeof requestIdleCallback !== "function") return;
			let id = 0;
			const prepare = (deadline: IdleDeadline) => {
				if (deadline.timeRemaining() < 12 || gesture.kind !== "idle")
					id = requestIdleCallback(prepare);
				else prepareMove(selection, drawing);
			};
			id = requestIdleCallback(prepare);
			return () => cancelIdleCallback(id);
		},
	);
	const [movingShapeId, setMovingShapeId] = createSignal<number | null>(null);
	const [wirePreview, setWirePreview] = createSignal<EditorShape[] | null>(
		null,
	);
	const [connectionHover, setConnectionHover] = createSignal<Point | null>(
		null,
		{ equals: samePoint },
	);
	const heightOf = (shape: EditorShape) =>
		options.cameraView.getProjection()?.heightOf(shape) ?? 0;
	const toolLayers = (): readonly FootprintLayer[] => {
		const { tool, footprintLayer, board } = options;
		if (isPadTool(tool))
			return newPadLayers(padToolTypes[tool], footprintLayer ?? "F.Cu");
		if (tool === "via") return copperLayers;
		if (tool === "hole") return ["F.Mask", "B.Mask"];
		if (
			(tool === "track" || tool === "zone" || tool === "zone-polygon") &&
			board
		)
			return [board.copperLayer];
		if (tool === "outline") return ["Edge.Cuts"];
		return footprintLayer ? [footprintLayer] : [];
	};
	const toolHeight = () =>
		options.cameraView.getProjection()?.layerHeight(toolLayers()) ?? 0;
	const screenPoint = (
		event: Pick<PointerEvent, "clientX" | "clientY">,
		canvas: HTMLCanvasElement,
	) => {
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};
	const handleAt = (screen: Point) => {
		const projection = options.cameraView.getProjection();
		if (!projection) return undefined;
		return [...options.handles].reverse().find(({ shape, handle }) => {
			const at = projection.toScreen(handle, projection.heightOf(shape));
			return (
				at !== null &&
				Math.abs(at.x - screen.x) <= 7 &&
				Math.abs(at.y - screen.y) <= 7
			);
		});
	};
	const pointAt = (
		event: Pick<PointerEvent, "clientX" | "clientY">,
		canvas: HTMLCanvasElement,
		height = 0,
	) =>
		options.cameraView
			.getProjection()
			?.toWorld(screenPoint(event, canvas), height) ?? null;
	const pick = (
		event: Pick<PointerEvent, "clientX" | "clientY">,
		canvas: HTMLCanvasElement,
	) => {
		const projection = options.cameraView.getProjection();
		if (!projection) return undefined;
		const screen = screenPoint(event, canvas);
		const points = new Map<number, Point | null>();
		return shapeAt(
			projection.nearestLast(options.shapes),
			(shape) => {
				const height = projection.heightOf(shape);
				let point = points.get(height);
				if (point === undefined) {
					point = projection.toWorld(screen, height);
					points.set(height, point);
				}
				return point;
			},
			6 / projection.scale,
			(shape) => canSelectShape(shape, options.allowLocked),
		);
	};
	const stop = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const previewReplacements = (
		replacements: EditorShape[],
		base = options.session.shapes(),
	) => {
		const byId = new Map(replacements.map((shape) => [shape.id, shape]));
		const existing = new Set(base.map((shape) => shape.id));
		// Rerouting deletes a wire by collapsing it to zero length. The preview
		// keeps it so the release commits it, and committing drops it.
		options.session.preview([
			...base.map((shape) => byId.get(shape.id) ?? shape),
			...replacements.filter((shape) => !existing.has(shape.id)),
		]);
	};
	const placementAnchor = (tool: PlacementTool, point: Point, start: Point) =>
		placementSnapsToConnection(tool)
			? (findWireConnection(
					options.session.shapes(),
					point,
					8 / (options.cameraView.getProjection()?.scale ?? 1),
				) ?? start)
			: start;
	// Routing obstacles are rebuilt only after the drawing changes.
	let routing: WireRoutingContext | null = null;
	let routed: {
		key: string;
		start: Point;
		shapes: readonly EditorShape[];
		points: Point[];
		clear: boolean;
	} | null = null;
	const previewWire = (point: Point) => {
		const active = getWireChain();
		if (!active) return null;
		const snapStep = options.cameraView.getGridStep();
		const shapes = options.session.shapes();
		const connection = findWireConnection(
			shapes,
			point,
			8 / (options.cameraView.getProjection()?.scale ?? 1),
			active.start,
		);
		setConnectionHover(connection ?? null);
		let segments: EditorShape[];
		let end: Point;
		if (connection) {
			// Ending on a connection routes the rest of the wire around obstacles.
			const pitch = routingPitch(snapStep);
			const key = `${connection.x},${connection.y},${active.fromPin},${active.heading},${pitch}`;
			if (
				routed?.key !== key ||
				routed.start !== active.start ||
				routed.shapes !== shapes
			) {
				if (routing?.shapes !== shapes)
					routing = createWireRoutingContext(shapes);
				const context = routing;
				const { points, clear } = measurePerformance(
					"editor.wire-route",
					() =>
						routeWireConnection(context, active.start, connection, {
							pitch,
							heading: active.heading,
							fromPin: active.fromPin,
						}),
					{ shapes: shapes.length },
				);
				routed = {
					key,
					start: active.start,
					shapes,
					points,
					clear,
				};
			}
			end = connection;
			segments = pathWires(options.session.nextId(), routed.points);
			// No safe route: show the fallback, but never connect through it.
			if (!routed.clear) {
				setWirePreview(segments);
				return { segments, end, connected: true, blocked: true };
			}
		} else {
			end = constrainWireEndpoint(active.start, point, snapStep);
			segments = routeWire(options.session.nextId(), active.start, end);
		}
		setWirePreview(segments);
		return { segments, end, connected: !!connection, blocked: false };
	};
	const finishWire = () => {
		if (
			gesture.kind === "wire" ||
			gesture.kind === "track" ||
			gesture.kind === "zone"
		)
			gesture = { kind: "idle" };
		setWirePreview(null);
		setConnectionHover(null);
		clearPlacementPreview();
	};
	const startWire = (connection: Point, pointerId: number) => {
		gesture = {
			kind: "wire",
			wire: { start: connection, pointerId, fromPin: true },
		};
		previewWire(connection);
	};
	const trackRouting = (): TrackRouting | undefined => {
		const { board } = options;
		return board && { items: board.copper(), clearance: board.rules.clearance };
	};
	const stepDrag = (active: Drag, point: Point | null, end: Point) => {
		const step = canvasDragStep(active, point, end, {
			shapes: options.shapes,
			allowLocked: options.allowLocked,
			cameraScale: () => options.cameraView.getProjection()?.scale ?? 1,
			nextId: options.session.nextId,
			routing: () => {
				active.routing ??= trackRouting() ?? null;
				return active.routing ?? undefined;
			},
			inScreenBox: (shape, box, mode) =>
				options.cameraView.getProjection()?.inScreenBox(shape, box, mode) ??
				false,
		});
		active.moved = step.moved;
		active.valid = step.valid;
		const { effect } = step;
		if (effect.kind === "preview") {
			if (effect.movingShapeId !== undefined)
				setMovingShapeId(effect.movingShapeId);
			active.unsafe = isUnsafeMove(effect.replacements);
			previewReplacements(effect.replacements, effect.base);
		} else if (effect.kind === "marquee-cancel") {
			setMarquee(null);
			options.session.select(effect.selection);
		} else if (effect.kind === "marquee") {
			setMarquee(effect.marquee);
			options.session.select(effect.selection);
		}
	};
	const beginDrag = (
		event: PointerEvent,
		canvas: HTMLCanvasElement,
		drag: Omit<
			CanvasDrag,
			| "pointerId"
			| "canvas"
			| "startScreen"
			| "previousSelection"
			| "previousChild"
			| "moved"
			| "initialShapes"
			| "valid"
		>,
	) => {
		gesture = {
			kind: "drag",
			drag: {
				pointerId: event.pointerId,
				canvas,
				startScreen: screenPoint(event, canvas),
				previousSelection: options.selectedIds,
				previousChild: options.selectedChildKey,
				moved: false,
				initialShapes: options.session.shapes(),
				valid: false,
				...drag,
			},
		};
		canvas.setPointerCapture(event.pointerId);
	};
	const updateDrag = (event: PointerEvent) => {
		const active = getDrag();
		if (!active || active.pointerId !== event.pointerId) return;
		stop(event);
		const point = pointAt(event, active.canvas, active.height);
		if (!point && active.mode !== "marquee") return;
		const end = screenPoint(event, active.canvas);
		if (active.mode === "marquee") active.selectionMode = selectionMode(event);
		active.pointer = end;
		stepDrag(active, point, end);
	};
	const refreshMarqueeMode = (event: KeyboardEvent) => {
		const active = getDrag();
		if (active?.mode !== "marquee" || !active.pointer) return;
		const mode = selectionMode(event);
		if (mode === active.selectionMode) return;
		active.selectionMode = mode;
		stepDrag(active, null, active.pointer);
	};
	const marqueeActive = createMemo(() => marquee() !== null);
	createEffect(marqueeActive, (active) => {
		if (!active) return;
		window.addEventListener("keydown", refreshMarqueeMode);
		window.addEventListener("keyup", refreshMarqueeMode);
		return () => {
			window.removeEventListener("keydown", refreshMarqueeMode);
			window.removeEventListener("keyup", refreshMarqueeMode);
		};
	});
	const finishDrag = (cancel = false) => {
		const active = getDrag();
		if (!active) return;
		gesture = { kind: "idle" };
		setMovingShapeId(null);
		active.canvas.style.cursor = "";
		setMarquee(null);
		// Releasing where a wire could only cross another net restores the drag.
		const refused =
			(active.mode === "move" || active.mode === "resize") && active.unsafe;
		if (refused && !cancel) options.session.setError(UNSAFE_MOVE_MESSAGE);
		if (cancel || (active.created && !active.valid) || refused) {
			options.session.preview(null);
			options.session.select(active.previousSelection);
			options.session.selectChild(active.previousChild);
		} else if (active.wireStart && !active.moved) {
			options.session.preview(null);
			options.session.select(new Set());
			options.setTool("wire");
			startWire(active.wireStart, active.pointerId);
		} else if (active.created) {
			const original = active.originals[0];
			const kind =
				original.kind === "text" && original.electrical
					? `${original.electrical} label`
					: original.kind === "rectangle" && original.zone
						? "zone"
						: original.kind;
			const createdIds = new Set(active.originals.map((shape) => shape.id));
			options.session.place(
				options.session.shapes().filter((shape) => createdIds.has(shape.id)),
				active.mode !== "duplicate"
					? `Draw ${kind}`
					: active.originals.length > 1
						? "Duplicate selection"
						: `Duplicate ${kind}`,
			);
			options.setTool("select");
		} else if (
			active.mode === "move" ||
			active.mode === "resize" ||
			active.mode === "symbol-child"
		) {
			const initial = new Map(
				active.initialShapes.map((shape) => [shape.id, shape]),
			);
			const changed = options.session
				.shapes()
				.filter((shape) => shape !== initial.get(shape.id));
			if (!changed.length) options.session.preview(null);
			else
				options.session.replace(
					changed.map(freeze),
					active.mode === "symbol-child"
						? active.handle
							? "Resize symbol child"
							: "Move symbol child"
						: active.mode === "move"
							? "Move selection"
							: active.handle?.corner !== undefined
								? "Edit zone outline"
								: `Resize ${active.originals[0].kind}`,
				);
		}
		if (active.canvas.hasPointerCapture(active.pointerId))
			active.canvas.releasePointerCapture(active.pointerId);
	};
	const placementHandler = (kind: PlacementTool): ToolHandler => ({
		press: (_event, point, start) => {
			const placed = {
				...onLayer(
					createPlacementShape(
						kind,
						options.session.nextId(),
						placementAnchor(kind, point, start),
						measureText,
					),
				),
				rotation: placementRotation(),
			};
			options.session.place([placed], placementLabel(kind));
			options.setTool("select");
			if (placed.kind === "text") {
				options.setTextFocusId(placed.id);
				options.openAttributes();
			}
			return;
		},
		hover: (_event, point) => {
			setPlacementPreview({
				tool: options.tool,
				symbolDefinition: options.symbolDefinition,
				shape: onLayer(
					createPlacementShape(
						kind,
						options.session.nextId(),
						placementAnchor(kind, point, snapPoint(point, options.gridStep)),
						measureText,
					),
				),
			});
			return true;
		},
	});
	const padAt = (tool: PadTool, center: Point) =>
		createPad(
			options.session.nextId(),
			center,
			padToolTypes[tool],
			nextPadNumber(options.session.drawing().shapes),
			options.footprintLayer ?? "F.Cu",
		);
	const padHandler = (kind: PadTool): ToolHandler => ({
		press: (_event, _point, start) => {
			options.session.place(
				[{ ...padAt(kind, start), rotation: placementRotation() }],
				"Place pad",
			);
		},
		hover: (_canvas, point) => {
			setPlacementPreview({
				tool: options.tool,
				symbolDefinition: options.symbolDefinition,
				shape: padAt(kind, snapPoint(point, options.gridStep)),
			});
			return true;
		},
	});
	const boardVia = (
		id: number,
		center: Point,
		net?: string,
		board = options.board,
	) => (board ? ruleVia(id, center, board.rules, net) : createVia(id, center));
	const viaHandler: ToolHandler = {
		press: (_event, _point, start) => {
			options.session.place(
				[
					boardVia(
						options.session.nextId(),
						start,
						options.board?.netAt(start),
					),
				],
				"Place via",
			);
		},
		hover: (_canvas, point) => {
			setPlacementPreview({
				tool: options.tool,
				symbolDefinition: options.symbolDefinition,
				shape: boardVia(
					options.session.nextId(),
					snapPoint(point, options.gridStep),
				),
			});
			return true;
		},
	};
	const holeHandler: ToolHandler = {
		press: (_event, _point, start) => {
			options.session.place(
				[createHole(options.session.nextId(), start)],
				"Place hole",
			);
		},
		hover: (_canvas, point) => {
			setPlacementPreview({
				tool: options.tool,
				symbolDefinition: options.symbolDefinition,
				shape: createHole(
					options.session.nextId(),
					snapPoint(point, options.gridStep),
				),
			});
			return true;
		},
	};
	const anchorAt = (
		point: Point,
		chain?: Partial<Pick<TrackChain, "layer" | "net" | "start">>,
	) => {
		if (!options.board) return undefined;
		const scale = options.cameraView.getProjection()?.scale ?? 1;
		return trackAnchor(options.board.items(), point, {
			layer: chain?.layer,
			net: chain?.net,
			exclude: chain?.start,
			padReach: 16 / scale,
			tolerance: 4 / scale,
		});
	};
	const startAnchorAt = (point: Point) =>
		anchorAt(point, { layer: options.board?.copperLayer }) ?? anchorAt(point);
	/** The preview of the track from the chain's start to `point`, and its end. */
	const previewTrack = (point: Point) => {
		const active = getTrack();
		if (!active || !options.board) return null;
		const joins = anchorAt(point, active);
		const end =
			joins?.point ?? snapPoint(point, options.cameraView.getGridStep());
		const segments = trackSegments(
			options.session.nextId(),
			trackPath(active.start, end, active.posture),
			active.layer,
			options.board.rules.trackWidth,
			active.net ?? joins?.item.net,
		);
		setWirePreview(segments);
		setConnectionHover(joins && segments.length ? joins.point : null);
		return { segments, end, joins };
	};
	const switchTrackLayer = (
		layer: CopperLayer,
		board = options.board,
		session = options.session,
	) => {
		const active = getTrack();
		if (!active || active.layer === layer || !board) return false;
		const { start, through } = active;
		if (through?.x !== start.x || through.y !== start.y) {
			const via = boardVia(session.nextId(), start, active.net, board);
			session.place([via], "Place via");
			if (active.net === undefined) active.netless.push(via.id);
			active.through = { ...start };
		}
		active.layer = layer;
		board.setCopperLayer(layer);
		setWirePreview(null);
		return true;
	};
	const placeTrackVia = () => {
		const active = getTrack();
		return active ? switchTrackLayer(otherCopperLayer(active.layer)) : false;
	};
	const stepCopperLayer = (step: 1 | -1) => {
		if (!options.board) return false;
		const current = getTrack()?.layer ?? options.board.copperLayer;
		const next =
			options.board.copperLayers[
				options.board.copperLayers.indexOf(current) + step
			];
		if (!next) return false;
		if (getTrack()) return switchTrackLayer(next);
		options.board.setCopperLayer(next);
		return true;
	};
	const boardGestures = createMemo(() => options.board);
	const boardCopperLayer = createMemo(() => boardGestures()?.copperLayer);
	const boardStack = createMemo(() => boardGestures()?.copperLayers);
	const editorSession = createMemo(() => options.session);
	let shownStack: readonly CopperLayer[] | undefined;
	let followed = false;
	createEffect(
		() =>
			[
				boardCopperLayer(),
				boardStack(),
				boardGestures(),
				editorSession(),
			] as const,
		([layer, stack, board, session]) => {
			if (followed && stack !== shownStack) {
				shownStack = stack;
				const active = getTrack() ?? getZoneChain();
				if (active && stack && !stack.includes(active.layer)) finishWire();
				return;
			}
			followed = true;
			shownStack = stack;
			if (layer) switchTrackLayer(layer, board, session);
		},
	);
	const flipTrackPosture = () => {
		const active = getTrack();
		if (!active) return false;
		active.posture =
			active.posture === "straight-first" ? "diagonal-first" : "straight-first";
		setWirePreview(null);
		return true;
	};
	const trackHandler: ToolHandler = {
		press: (event, point) => {
			if (!options.board) return;
			const active = getTrack();
			if (!active) {
				const anchor = startAnchorAt(point);
				let layer = options.board.copperLayer;
				if (anchor && !anchor.item.layers.includes(layer)) {
					layer = anchor.item.layers[0];
					options.board.setCopperLayer(layer);
				}
				gesture = {
					kind: "track",
					track: {
						start:
							anchor?.point ??
							snapPoint(point, options.cameraView.getGridStep()),
						layer,
						...(anchor?.item.net ? { net: anchor.item.net } : {}),
						netless: [],
						pointerId: event.pointerId,
						posture: "straight-first",
						...(anchor && anchor.item.layers.length > 1
							? { through: { ...anchor.point } }
							: {}),
					},
				};
				previewTrack(point);
				return;
			}
			const next = previewTrack(point);
			if (!next || !next.segments.length) return;
			const net = next.segments[0]?.net;
			if (net !== undefined && active.netless.length) {
				const earlier = new Set(active.netless);
				options.session.replace(
					[
						...options.session
							.shapes()
							.filter((shape) => earlier.has(shape.id))
							.map((shape) => ({ ...shape, net })),
						...next.segments,
					],
					"Route track",
				);
				active.netless = [];
			} else {
				options.session.place(next.segments, "Route track");
				if (net === undefined)
					active.netless.push(...next.segments.map((shape) => shape.id));
			}
			if (next.joins) {
				finishWire();
				return;
			}
			active.net ??= next.segments[0]?.net;
			active.start = next.end;
			active.pointerId = event.pointerId;
			setWirePreview(null);
		},
		hover: (canvas, point) => {
			if (getTrack()) {
				previewTrack(point);
				return true;
			}
			if (!options.board) return false;
			const anchor = startAnchorAt(point);
			setConnectionHover(anchor?.point ?? null);
			canvas.style.cursor = "crosshair";
			return true;
		},
	};
	const zoneHandler: ToolHandler = {
		create: (start) => {
			const net = options.board?.netAt(start);
			return {
				...drawShape(options.session.nextId(), "rectangle", start, start),
				layer: options.board?.copperLayer ?? "F.Cu",
				lineWidth: 0.1,
				zone: {},
				...(net ? { net } : {}),
			};
		},
	};
	const polygonZone = (chain: ZoneChain, points: readonly Point[]) =>
		withZoneOutline(
			{
				id: options.session.nextId(),
				kind: "rectangle",
				layer: chain.layer,
				...points[0],
				width: 1,
				height: 1,
				rotation: 0,
				lineWidth: 0.1,
				zone: {},
				...(chain.net ? { net: chain.net } : {}),
			},
			points,
		);
	const closable = (points: readonly Point[]) => {
		const scale = options.cameraView.getProjection()?.scale ?? 1;
		return outlineEncloses(points, 9 / (scale * scale));
	};
	/** Places the zone drawn so far once its corners enclose an area. A zone still too small keeps drawing. */
	const closeZone = () => {
		const active = getZoneChain();
		if (!active) return false;
		if (!closable(active.points)) return true;
		options.session.place([polygonZone(active, active.points)], "Draw zone");
		finishWire();
		options.setTool("select");
		return true;
	};
	const previewZone = (point: Point) => {
		const active = getZoneChain();
		if (!active) return;
		const end = snapPoint(point, options.cameraView.getGridStep());
		const points = [...active.points, end];
		setWirePreview(
			points.length > 2
				? [polygonZone(active, points)]
				: [
						{
							...drawShape(options.session.nextId(), "line", points[0], end),
							layer: active.layer,
							lineWidth: 0.1,
						},
					],
		);
	};
	const zonePolygonHandler: ToolHandler = {
		press: (event, _point, start) => {
			const active = getZoneChain();
			if (!active) {
				if (!options.board) return;
				const net = options.board.netAt(start);
				gesture = {
					kind: "zone",
					zone: {
						points: [start],
						layer: options.board.copperLayer,
						...(net ? { net } : {}),
						pointerId: event.pointerId,
					},
				};
				previewZone(start);
				return;
			}
			const scale = options.cameraView.getProjection()?.scale ?? 1;
			const near = (point: Point) =>
				Math.hypot(point.x - start.x, point.y - start.y) * scale < 8;
			const last = active.points[active.points.length - 1];
			active.pointerId = event.pointerId;
			if (closable(active.points) && (near(active.points[0]) || near(last))) {
				closeZone();
				return;
			}
			if (
				active.points.some(
					(point) => point.x === start.x && point.y === start.y,
				)
			)
				return;
			active.points.push(start);
			previewZone(start);
		},
		hover: (canvas, point) => {
			canvas.style.cursor = "crosshair";
			previewZone(point);
			return true;
		},
	};
	const outlineHandler: ToolHandler = {
		create: (start) => ({
			...drawShape(options.session.nextId(), "rectangle", start, start),
			layer: "Edge.Cuts",
			lineWidth: 0.1,
		}),
	};
	const drawingHandler = (
		kind: "rectangle" | "circle" | "triangle" | "line",
	): ToolHandler => ({
		create: (start) =>
			onLayer(drawShape(options.session.nextId(), kind, start, start)),
	});
	const toolHandlers: Record<CanvasTool, ToolHandler> = {
		select: {},
		pan: {},
		rectangle: drawingHandler("rectangle"),
		circle: drawingHandler("circle"),
		triangle: drawingHandler("triangle"),
		line: drawingHandler("line"),
		pin: placementHandler("pin"),
		"no-connect": placementHandler("no-connect"),
		text: placementHandler("text"),
		net: placementHandler("net"),
		supply: placementHandler("supply"),
		"smd-pad": padHandler("smd-pad"),
		"through-hole-pad": padHandler("through-hole-pad"),
		via: viaHandler,
		hole: holeHandler,
		track: trackHandler,
		zone: zoneHandler,
		"zone-polygon": zonePolygonHandler,
		outline: outlineHandler,
		symbol: {
			press: (_event, _point, start) => {
				const definition = options.symbolDefinition;
				if (!definition || (options.sheetless && definition.netSymbol)) return;
				const symbol = {
					...createSymbol(options.session.nextId(), definition, start),
					rotation: placementRotation(),
				};
				options.session.place([symbol], `Insert ${symbol.attributes.name}`);
				clearPlacementPreview();
				options.setTool("select");
				return;
			},
			hover: (_event, point) => {
				const definition = options.symbolDefinition;
				if (!definition) return false;

				setPlacementPreview({
					tool: options.tool,
					symbolDefinition: definition,
					shape: createSymbol(
						options.session.nextId(),
						definition,
						snapPoint(point, options.gridStep),
					),
				});
				return true;
			},
		},
		wire: {
			press: (event, point) => {
				const active = getWireChain();
				if (!active) {
					const connection = findWireConnection(
						options.session.shapes(),
						point,
						8 / (options.cameraView.getProjection()?.scale ?? 1),
					);
					if (!connection) return;
					startWire(connection, event.pointerId);
					return;
				}
				const next = previewWire(point);
				if (
					!next ||
					next.blocked ||
					next.segments.reduce((sum, segment) => sum + segment.width, 0) *
						(options.cameraView.getProjection()?.scale ?? 1) <
						3
				)
					return;
				options.session.place(next.segments, "Draw wire");
				if (next.connected) {
					finishWire();
					options.setTool("select");
					return;
				}
				active.heading = finalHeading(
					next.segments.flatMap((segment) => wireEnds(segment)),
				);
				active.start = next.end;
				active.fromPin = false;
				active.pointerId = event.pointerId;
				setWirePreview(null);
				return;
			},
			hover: (canvas, point) => {
				if (getWireChain()) return false;

				const connection = findWireConnection(
					options.session.shapes(),
					point,
					8 / (options.cameraView.getProjection()?.scale ?? 1),
				);
				setConnectionHover(connection ?? null);
				canvas.style.cursor = connection ? "crosshair" : "not-allowed";
				return true;
			},
		},
	};
	const onPointerLeave = () => {
		clearPlacementPreview();
		setConnectionHover(null);
	};
	const onDoubleClick = (event: MouseEvent) => {
		if (
			!(event.target instanceof HTMLCanvasElement) ||
			options.tool !== "select"
		)
			return;
		const shape = pick(event, event.target);
		if (!shape) return;
		event.preventDefault();
		event.stopPropagation();
		if (shape.kind === "text") {
			options.session.select(new Set([shape.id]));
			options.setTextFocusId(shape.id);
		} else if (!options.session.getState().selection.has(shape.id))
			options.session.select(new Set([shape.id]));
		options.openAttributes();
	};
	const onPointerDown = (event: PointerEvent) => {
		const {
			tool,
			session,
			cameraView,
			selectedIds,
			selected,
			selectedSymbol,
			allowLocked,
			footprintLayer,
			shapes,
		} = options;
		const canvas = event.target;
		if (!(canvas instanceof HTMLCanvasElement) || !options.ready) return;
		if (getDrag()) {
			stop(event);
			return;
		}
		const mode = selectionMode(event);
		if (
			!event.isPrimary ||
			event.button !== 0 ||
			tool === "pan" ||
			(event.shiftKey &&
				!event[shortcutModifier().flag] &&
				(cameraView.getProjection()?.turned ||
					(footprintLayer !== undefined && event.altKey))) ||
			((event.ctrlKey || event.metaKey) &&
				(tool !== "select" || event.altKey || !event[shortcutModifier().flag]))
		)
			return;
		const created = tool !== "select";
		const hit = created ? undefined : pick(event, canvas);
		const pressedHandle =
			event.altKey && hit ? undefined : handleAt(screenPoint(event, canvas));
		const height = pressedHandle
			? heightOf(pressedHandle.shape)
			: hit
				? heightOf(hit)
				: created
					? toolHeight()
					: 0;
		const point = pointAt(event, canvas, height);
		if (!point) {
			if (!cameraView.getProjection()?.turned) return;
			stop(event);
			if (tool !== "select" || pressedHandle || event.altKey) return;
			canvas.focus({ preventScroll: true });
			canvas.style.cursor = "";
			session.select(mode === "replace" ? new Set() : selectedIds);
			session.selectChild(null);
			beginDrag(event, canvas, {
				start: null,
				mode: "marquee",
				gridStep: cameraView.getGridStep(),
				originals: [],
				created: false,
				selectionMode: mode,
			});
			return;
		}
		const duplicate =
			event.altKey && hit
				? selectedIds.has(hit.id)
					? selected.filter((shape) => canSelectShape(shape, allowLocked))
					: [hit]
				: undefined;
		if (event.altKey && !duplicate) return;
		stop(event);
		canvas.focus({ preventScroll: true });
		const resize = duplicate ? undefined : pressedHandle;
		canvas.style.cursor = resize?.handle.cursor ?? "";
		let shape: EditorShape | undefined;
		const snapStep = cameraView.getGridStep();
		const start = created ? snapPoint(point, snapStep) : point;
		let wireStart: Point | undefined;
		const childHit =
			!created &&
			!resize &&
			!duplicate &&
			mode === "replace" &&
			selectedSymbol &&
			hit?.id === selectedSymbol.id
				? symbolChildAt(
						selectedSymbol,
						point,
						2 / (cameraView.getProjection()?.scale ?? 1),
						allowLocked,
					)
				: undefined;
		if (childHit) shape = selectedSymbol;
		const editableChild =
			childHit &&
			selectedSymbol &&
			canSelectSymbolChild(selectedSymbol, childHit, allowLocked)
				? childHit
				: undefined;
		// Pressing a fixed pin selects it, and dragging still moves the symbol.
		const inspectedChild =
			editableChild ??
			(childHit &&
			selectedSymbol &&
			canInspectSymbolChild(selectedSymbol, childHit, allowLocked)
				? childHit
				: undefined);

		if (
			tool === "select" &&
			mode === "replace" &&
			!resize &&
			!duplicate &&
			(!childHit || childHit.shape.kind === "pin")
		) {
			let connection: ReturnType<typeof openPins>[number] | undefined;
			let distance = 8 / (cameraView.getProjection()?.scale ?? 1);
			const candidates = measurePerformance(
				"editor.pin-hit-test",
				() =>
					openPins(session.shapes(), {
						point,
						tolerance: distance,
					}),
				{ shapes: session.shapes().length },
			);
			for (const candidate of candidates) {
				const terminal = candidate.point;
				const next = Math.hypot(terminal.x - point.x, terminal.y - point.y);
				if (next <= distance && canSelectShape(candidate.shape, allowLocked)) {
					connection = candidate;
					distance = next;
				}
			}
			if (connection) {
				wireStart = connection.point;
				shape = connection.shape;
			}
		}
		const handler = toolHandlers[tool];
		if (handler.press) {
			handler.press(event, point, start);
			return;
		}
		let copies: EditorShape[] = [];
		if (duplicate && hit) {
			copies = pasteSelection(
				duplicate,
				shapes,
				session.nextId(),
				{ x: 0, y: 0 },
				footprintLayer ? { footprintLayer } : "drawing",
			);
			shape = copies[duplicate.findIndex((item) => item.id === hit.id)];
			session.preview([...session.shapes(), ...copies]);
		} else if (created) {
			const create = handler.create;
			if (!create) return;
			shape = create(start);
			session.preview([...session.shapes(), shape]);
		} else if (resize) shape = resize.shape;
		else if (!shape) shape = hit;
		if (
			hit &&
			shape === hit &&
			!resize &&
			hitsHollowInterior(
				hit,
				point,
				6 / (cameraView.getProjection()?.scale ?? 1),
			)
		) {
			const pressed =
				mode === "replace" && selectedIds.has(hit.id)
					? selectedIds
					: applySelection(selectedIds, [hit.id], mode);
			session.select(pressed);
			session.selectChild(null);
			beginDrag(event, canvas, {
				start: point,
				height,
				mode: "marquee",
				gridStep: snapStep,
				originals: [],
				created: false,
				selectionMode: mode,
				pressed,
			});
			return;
		}
		if (shape && mode !== "replace" && !created && !resize && !duplicate) {
			session.select(applySelection(selectedIds, [shape.id], mode));
			return;
		}
		const childKey = resize?.childKey ?? editableChild?.key;

		const originals = duplicate
			? copies
			: shape
				? childKey === undefined &&
					!created &&
					!resize &&
					selectedIds.has(shape.id)
					? selected
					: [shape]
				: [];
		session.select(
			resize
				? selectedIds
				: shape
					? new Set(originals.map((item) => item.id))
					: mode === "replace"
						? new Set()
						: selectedIds,
		);
		session.selectChild(childKey ?? inspectedChild?.key ?? null);
		beginDrag(event, canvas, {
			start,
			height,
			childKey,
			mode: duplicate
				? "duplicate"
				: childKey !== undefined
					? "symbol-child"
					: created
						? "draw"
						: resize
							? "resize"
							: shape
								? "move"
								: "marquee",
			handle: resize?.handle,
			anchorShape: shape,
			gridStep:
				editableChild?.shape.kind === "text" ||
				(!created &&
					!resize &&
					originals.length > 0 &&
					originals.every((item) => item.kind === "text" && !isNetLabel(item)))
					? snapStep / 10
					: snapStep,
			originals,
			created: created || !!duplicate,
			selectionMode: mode,
			wireStart,
		});
	};
	const onPointerMove = (event: PointerEvent) => {
		if (getDrag()) {
			updateDrag(event);
			return;
		}
		if (!(event.target instanceof HTMLCanvasElement)) return;
		const point = pointAt(
			event,
			event.target,
			options.tool === "select" ? 0 : toolHeight(),
		);
		if (!point) clearPlacementPreview();
		else if (toolHandlers[options.tool].hover?.(event.target, point)) return;
		if (
			getWireChain() &&
			event.isPrimary &&
			(event.buttons & ~1) === 0 &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey
		) {
			stop(event);
			if (point) previewWire(point);
			return;
		}
		event.target.style.cursor =
			handleAt(screenPoint(event, event.target))?.handle.cursor ?? "";
	};
	const onPointerUp = (event: PointerEvent) => {
		if (getDrag()?.pointerId !== event.pointerId) return;
		// The release routes without the preview budget, so a move is refused
		// only when no safe route exists.
		withFullRouting(() => updateDrag(event));
		finishDrag();
	};
	const onPointerCancel = (event: PointerEvent) => {
		if (options.tool === "symbol") {
			clearPlacementPreview();
			options.setTool("select");
			return;
		}
		if (getWire()?.pointerId === event.pointerId) {
			stop(event);
			finishWire();
			options.setTool("select");
			return;
		}
		if (getDrag()?.pointerId !== event.pointerId) return;
		stop(event);
		finishDrag(true);
	};
	const onLostPointerCapture = (event: PointerEvent) => {
		if (getDrag()?.pointerId === event.pointerId) finishDrag(true);
	};
	let bound: HTMLElement | undefined;
	const listeners = [
		["pointerleave", onPointerLeave, false],
		["dblclick", onDoubleClick, true],
		["pointerdown", onPointerDown, true],
		["pointermove", onPointerMove, true],
		["pointerup", onPointerUp, true],
		["pointercancel", onPointerCancel, true],
		["lostpointercapture", onLostPointerCapture, false],
	] as const;
	const unbind = () => {
		for (const [type, listener, capture] of listeners)
			bound?.removeEventListener(type, listener as EventListener, capture);
		bound = undefined;
	};
	const pointerRef = (element: HTMLElement) => {
		if (element === bound) return;
		unbind();
		bound = element;
		for (const [type, listener, capture] of listeners)
			element.addEventListener(type, listener as EventListener, capture);
	};
	onSettled(() => unbind);
	return {
		getDrag,
		getWire,
		get marquee() {
			return marquee();
		},
		get movingShapeId() {
			return movingShapeId();
		},
		get wirePreview() {
			return wirePreview();
		},
		get placementPreview() {
			return placementPreview();
		},
		clearPlacementPreview,
		get canRotatePlacement() {
			return canRotatePlacement();
		},
		get placing() {
			return placing();
		},
		rotatePlacement,
		get connectionHover() {
			return connectionHover();
		},
		finishDrag,
		finishWire,
		trackRouting,
		placeTrackVia,
		stepCopperLayer,
		flipTrackPosture,
		closeZone,
		pointerRef,
	};
}
