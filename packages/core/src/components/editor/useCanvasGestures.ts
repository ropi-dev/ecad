import type {
	CopperItem,
	CopperLayer,
} from "@ecad/drawing-core/board/connectivity.ts";
import { outlineEncloses } from "@ecad/drawing-core/board/geometry.ts";
import { ruleVia } from "@ecad/drawing-core/board/routing-grid.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
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
import {
	type Dispatch,
	type DOMAttributes,
	type PointerEvent as ReactPointerEvent,
	type SetStateAction,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	otherCopperLayer,
	type TrackPosture,
	trackAnchor,
	trackPath,
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
	| { kind: "placing"; tool: CanvasTool }
	| { kind: "drag"; drag: Drag }
	| { kind: "wire"; wire: WireChain }
	| { kind: "track"; track: TrackChain }
	| { kind: "zone"; zone: ZoneChain };

/** What the board tools need from the board editor. */
export interface BoardGestures {
	/** Copper on the visible layers, in board coordinates. */
	items(): readonly CopperItem[];
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
	press?: (
		event: ReactPointerEvent<HTMLDivElement>,
		point: Point,
		start: Point,
	) => void;
	hover?: (canvas: HTMLCanvasElement, point: Point) => boolean;
	create?: (start: Point) => EditorShape;
}

interface CanvasGesturesOptions {
	session: EditorSession;
	cameraView: CanvasView;
	tool: CanvasTool;
	setTool: Dispatch<SetStateAction<CanvasTool>>;
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
	setTextFocusId: Dispatch<SetStateAction<number | null>>;
	openAttributes: () => void;
}

export function useCanvasGestures({
	session,
	cameraView,
	tool,
	setTool,
	shapes,
	selected,
	selectedIds,
	selectedChildKey,
	selectedSymbol,
	allowLocked,
	handles,
	ready,
	gridStep,
	symbolDefinition,
	sheetless,
	footprintLayer,
	board,
	setTextFocusId,
	openAttributes,
}: CanvasGesturesOptions) {
	const [marquee, setMarquee] = useState<CanvasMarquee | null>(null);
	const [placement, setPlacement] = useState({
		tool,
		symbolDefinition,
		rotation: 0,
	});
	if (
		placement.tool !== tool ||
		placement.symbolDefinition !== symbolDefinition
	)
		setPlacement({ tool, symbolDefinition, rotation: 0 });
	const placementRotation =
		placement.tool === tool && placement.symbolDefinition === symbolDefinition
			? placement.rotation
			: 0;
	const canRotatePlacement =
		isPlacementTool(tool) ||
		isPadTool(tool) ||
		(tool === "symbol" && !!symbolDefinition);
	const placing =
		canRotatePlacement ||
		tool === "via" ||
		tool === "hole" ||
		tool === "track" ||
		tool === "zone" ||
		tool === "zone-polygon" ||
		tool === "outline";
	const onLayer = <Shape extends EditorShape>(shape: Shape): Shape =>
		footprintLayer ? onFootprintLayer(shape, footprintLayer) : shape;
	const rotatePlacement = useCallback((angle: number) => {
		setPlacement((current) => ({
			...current,
			rotation: (current.rotation + angle) % (2 * Math.PI),
		}));
	}, []);
	const [pendingPreview, setPlacementPreview] = useState<{
		tool: CanvasTool;
		symbolDefinition: SymbolDefinition | null;
		shape: EditorShape;
	} | null>(null);
	const placementPreview = useMemo(
		() =>
			pendingPreview?.tool === tool &&
			pendingPreview.symbolDefinition === symbolDefinition
				? { ...pendingPreview.shape, rotation: placementRotation }
				: null,
		[pendingPreview, tool, symbolDefinition, placementRotation],
	);
	const clearPlacementPreview = useCallback(
		() => setPlacementPreview(null),
		[],
	);
	const gesture = useRef<CanvasGesture>({ kind: "idle" });
	const getGesture = useCallback(
		(): CanvasGesture =>
			gesture.current.kind === "idle" && tool !== "select" && tool !== "pan"
				? { kind: "placing", tool }
				: gesture.current,
		[tool],
	);
	const getDrag = useCallback(() => {
		const active = getGesture();
		return active.kind === "drag" ? active.drag : null;
	}, [getGesture]);
	const getWireChain = useCallback(() => {
		const active = getGesture();
		return active.kind === "wire" ? active.wire : null;
	}, [getGesture]);
	const getTrack = useCallback(() => {
		const active = getGesture();
		return active.kind === "track" ? active.track : null;
	}, [getGesture]);
	const getZoneChain = useCallback(() => {
		const active = getGesture();
		return active.kind === "zone" ? active.zone : null;
	}, [getGesture]);
	const getWire = useCallback(
		() => getWireChain() ?? getTrack() ?? getZoneChain(),
		[getWireChain, getTrack, getZoneChain],
	);
	useEffect(() => {
		if (tool !== "select" || !selected.length) return;
		if (typeof requestIdleCallback !== "function") return;
		let id = 0;
		const prepare = (deadline: IdleDeadline) => {
			if (deadline.timeRemaining() < 12 || gesture.current.kind !== "idle")
				id = requestIdleCallback(prepare);
			else prepareMove(selected, shapes);
		};
		id = requestIdleCallback(prepare);
		return () => cancelIdleCallback(id);
	}, [tool, selected, shapes]);
	const [movingShapeId, setMovingShapeId] = useState<number | null>(null);
	const [wirePreview, setWirePreview] = useState<EditorShape[] | null>(null);
	const [connectionHover, setConnectionHover] = useState<Point | null>(null);
	const heightOf = (shape: EditorShape) =>
		cameraView.getProjection()?.heightOf(shape) ?? 0;
	const toolLayers = (): readonly FootprintLayer[] => {
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
		cameraView.getProjection()?.layerHeight(toolLayers()) ?? 0;
	const screenPoint = (
		event: Pick<ReactPointerEvent, "clientX" | "clientY">,
		canvas: HTMLCanvasElement,
	) => {
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};
	const handleAt = (screen: Point) => {
		const projection = cameraView.getProjection();
		if (!projection) return undefined;
		return [...handles].reverse().find(({ shape, handle }) => {
			const at = projection.toScreen(handle, projection.heightOf(shape));
			return (
				at !== null &&
				Math.abs(at.x - screen.x) <= 7 &&
				Math.abs(at.y - screen.y) <= 7
			);
		});
	};
	const pointAt = (
		event: Pick<ReactPointerEvent, "clientX" | "clientY">,
		canvas: HTMLCanvasElement,
		height = 0,
	) =>
		cameraView.getProjection()?.toWorld(screenPoint(event, canvas), height) ??
		null;
	const pick = (
		event: Pick<ReactPointerEvent, "clientX" | "clientY">,
		canvas: HTMLCanvasElement,
	) => {
		const projection = cameraView.getProjection();
		if (!projection) return undefined;
		const screen = screenPoint(event, canvas);
		const points = new Map<number, Point | null>();
		return shapeAt(
			projection.nearestLast(shapes),
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
			(shape) => canSelectShape(shape, allowLocked),
		);
	};
	const stop = (event: ReactPointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const previewReplacements = (
		replacements: EditorShape[],
		base = session.shapes(),
	) => {
		const byId = new Map(replacements.map((shape) => [shape.id, shape]));
		const existing = new Set(base.map((shape) => shape.id));
		// Rerouting deletes a wire by collapsing it to zero length. The preview
		// keeps it so the release commits it, and committing drops it.
		session.preview([
			...base.map((shape) => byId.get(shape.id) ?? shape),
			...replacements.filter((shape) => !existing.has(shape.id)),
		]);
	};
	const placementAnchor = (tool: PlacementTool, point: Point, start: Point) =>
		placementSnapsToConnection(tool)
			? (findWireConnection(
					session.shapes(),
					point,
					8 / (cameraView.getProjection()?.scale ?? 1),
				) ?? start)
			: start;
	// Routing obstacles are rebuilt only after the drawing changes.
	const routing = useRef<WireRoutingContext | null>(null);
	const routed = useRef<{
		key: string;
		start: Point;
		shapes: readonly EditorShape[];
		points: Point[];
		clear: boolean;
	} | null>(null);
	const previewWire = useCallback(
		(point: Point) => {
			const active = getWireChain();
			if (!active) return null;
			const snapStep = cameraView.getGridStep();
			const shapes = session.shapes();
			const connection = findWireConnection(
				shapes,
				point,
				8 / (cameraView.getProjection()?.scale ?? 1),
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
					routed.current?.key !== key ||
					routed.current.start !== active.start ||
					routed.current.shapes !== shapes
				) {
					if (routing.current?.shapes !== shapes)
						routing.current = createWireRoutingContext(shapes);
					const context = routing.current;
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
					routed.current = {
						key,
						start: active.start,
						shapes,
						points,
						clear,
					};
				}
				end = connection;
				segments = pathWires(session.nextId(), routed.current.points);
				// No safe route: show the fallback, but never connect through it.
				if (!routed.current.clear) {
					setWirePreview(segments);
					return { segments, end, connected: true, blocked: true };
				}
			} else {
				end = constrainWireEndpoint(active.start, point, snapStep);
				segments = routeWire(session.nextId(), active.start, end);
			}
			setWirePreview(segments);
			return { segments, end, connected: !!connection, blocked: false };
		},
		[getWireChain, cameraView, session],
	);
	const finishWire = useCallback(() => {
		if (
			gesture.current.kind === "wire" ||
			gesture.current.kind === "track" ||
			gesture.current.kind === "zone"
		)
			gesture.current = { kind: "idle" };
		setWirePreview(null);
		setConnectionHover(null);
		clearPlacementPreview();
	}, [clearPlacementPreview]);
	const startWire = useCallback(
		(connection: Point, pointerId: number) => {
			gesture.current = {
				kind: "wire",
				wire: { start: connection, pointerId, fromPin: true },
			};
			previewWire(connection);
		},
		[previewWire],
	);
	const stepDrag = (active: Drag, point: Point | null, end: Point) => {
		const step = canvasDragStep(active, point, end, {
			shapes,
			allowLocked,
			cameraScale: () => cameraView.getProjection()?.scale ?? 1,
			nextId: session.nextId,
			inScreenBox: (shape, box, mode) =>
				cameraView.getProjection()?.inScreenBox(shape, box, mode) ?? false,
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
			session.select(effect.selection);
		} else if (effect.kind === "marquee") {
			setMarquee(effect.marquee);
			session.select(effect.selection);
		}
	};
	const beginDrag = (
		event: ReactPointerEvent,
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
		gesture.current = {
			kind: "drag",
			drag: {
				pointerId: event.pointerId,
				canvas,
				startScreen: screenPoint(event, canvas),
				previousSelection: selectedIds,
				previousChild: selectedChildKey,
				moved: false,
				initialShapes: session.shapes(),
				valid: false,
				...drag,
			},
		};
		canvas.setPointerCapture(event.pointerId);
	};
	const updateDrag = (event: ReactPointerEvent) => {
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
	const refreshMarqueeMode = useEffectEvent((event: KeyboardEvent) => {
		const active = getDrag();
		if (active?.mode !== "marquee" || !active.pointer) return;
		const mode = selectionMode(event);
		if (mode === active.selectionMode) return;
		active.selectionMode = mode;
		stepDrag(active, null, active.pointer);
	});
	const marqueeActive = marquee !== null;
	useEffect(() => {
		if (!marqueeActive) return;
		window.addEventListener("keydown", refreshMarqueeMode);
		window.addEventListener("keyup", refreshMarqueeMode);
		return () => {
			window.removeEventListener("keydown", refreshMarqueeMode);
			window.removeEventListener("keyup", refreshMarqueeMode);
		};
	}, [marqueeActive]);
	const finishDrag = useCallback(
		(cancel = false) => {
			const active = getDrag();
			if (!active) return;
			gesture.current = { kind: "idle" };
			setMovingShapeId(null);
			active.canvas.style.cursor = "";
			setMarquee(null);
			// Releasing where a wire could only cross another net restores the drag.
			if (active.mode === "move" && active.unsafe && !cancel)
				session.setError(UNSAFE_MOVE_MESSAGE);
			if (
				cancel ||
				(active.created && !active.valid) ||
				(active.mode === "move" && active.unsafe)
			) {
				session.preview(null);
				session.select(active.previousSelection);
				session.selectChild(active.previousChild);
			} else if (active.wireStart && !active.moved) {
				session.preview(null);
				session.select(new Set());
				setTool("wire");
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
				session.place(
					session.shapes().filter((shape) => createdIds.has(shape.id)),
					active.mode !== "duplicate"
						? `Draw ${kind}`
						: active.originals.length > 1
							? "Duplicate selection"
							: `Duplicate ${kind}`,
				);
				setTool("select");
			} else if (
				active.mode === "move" ||
				active.mode === "resize" ||
				active.mode === "symbol-child"
			) {
				const initial = new Map(
					active.initialShapes.map((shape) => [shape.id, shape]),
				);
				const changed = session
					.shapes()
					.filter((shape) => shape !== initial.get(shape.id));
				if (!changed.length) session.preview(null);
				else
					session.replace(
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
		},
		[getDrag, session, setTool, startWire],
	);
	const placementHandler = (kind: PlacementTool): ToolHandler => ({
		press: (_event, point, start) => {
			const placed = {
				...onLayer(
					createPlacementShape(
						kind,
						session.nextId(),
						placementAnchor(kind, point, start),
						measureText,
					),
				),
				rotation: placementRotation,
			};
			session.place([placed], placementLabel(kind));
			setTool("select");
			if (placed.kind === "text") {
				setTextFocusId(placed.id);
				openAttributes();
			}
			return;
		},
		hover: (_event, point) => {
			setPlacementPreview({
				tool,
				symbolDefinition,
				shape: onLayer(
					createPlacementShape(
						kind,
						session.nextId(),
						placementAnchor(kind, point, snapPoint(point, gridStep)),
						measureText,
					),
				),
			});
			return true;
		},
	});
	const padAt = (tool: PadTool, center: Point) =>
		createPad(
			session.nextId(),
			center,
			padToolTypes[tool],
			nextPadNumber(session.drawing().shapes),
			footprintLayer ?? "F.Cu",
		);
	const padHandler = (kind: PadTool): ToolHandler => ({
		press: (_event, _point, start) => {
			session.place(
				[{ ...padAt(kind, start), rotation: placementRotation }],
				"Place pad",
			);
		},
		hover: (_canvas, point) => {
			setPlacementPreview({
				tool,
				symbolDefinition,
				shape: padAt(kind, snapPoint(point, gridStep)),
			});
			return true;
		},
	});
	const boardVia = (id: number, center: Point, net?: string) =>
		board ? ruleVia(id, center, board.rules, net) : createVia(id, center);
	const viaHandler: ToolHandler = {
		press: (_event, _point, start) => {
			session.place(
				[boardVia(session.nextId(), start, board?.netAt(start))],
				"Place via",
			);
		},
		hover: (_canvas, point) => {
			setPlacementPreview({
				tool,
				symbolDefinition,
				shape: boardVia(session.nextId(), snapPoint(point, gridStep)),
			});
			return true;
		},
	};
	const holeHandler: ToolHandler = {
		press: (_event, _point, start) => {
			session.place([createHole(session.nextId(), start)], "Place hole");
		},
		hover: (_canvas, point) => {
			setPlacementPreview({
				tool,
				symbolDefinition,
				shape: createHole(session.nextId(), snapPoint(point, gridStep)),
			});
			return true;
		},
	};
	const anchorAt = (
		point: Point,
		chain?: Partial<Pick<TrackChain, "layer" | "net" | "start">>,
	) => {
		if (!board) return undefined;
		const scale = cameraView.getProjection()?.scale ?? 1;
		return trackAnchor(board.items(), point, {
			layer: chain?.layer,
			net: chain?.net,
			exclude: chain?.start,
			padReach: 16 / scale,
			tolerance: 4 / scale,
		});
	};
	const startAnchorAt = (point: Point) =>
		anchorAt(point, { layer: board?.copperLayer }) ?? anchorAt(point);
	/** The preview of the track from the chain's start to `point`, and its end. */
	const previewTrack = (point: Point) => {
		const active = getTrack();
		if (!active || !board) return null;
		const joins = anchorAt(point, active);
		const end = joins?.point ?? snapPoint(point, cameraView.getGridStep());
		const segments = trackSegments(
			session.nextId(),
			trackPath(active.start, end, active.posture),
			active.layer,
			board.rules.trackWidth,
			active.net ?? joins?.item.net,
		);
		setWirePreview(segments);
		setConnectionHover(joins && segments.length ? joins.point : null);
		return { segments, end, joins };
	};
	const switchTrackLayer = useEffectEvent((layer: CopperLayer) => {
		const active = getTrack();
		if (!active || !board || active.layer === layer) return false;
		const { start, through } = active;
		if (through?.x !== start.x || through.y !== start.y) {
			const via = boardVia(session.nextId(), start, active.net);
			session.place([via], "Place via");
			if (active.net === undefined) active.netless.push(via.id);
			active.through = { ...start };
		}
		active.layer = layer;
		board.setCopperLayer(layer);
		setWirePreview(null);
		return true;
	});
	const placeTrackVia = useEffectEvent(() => {
		const active = getTrack();
		return active ? switchTrackLayer(otherCopperLayer(active.layer)) : false;
	});
	const stepCopperLayer = useEffectEvent((step: 1 | -1) => {
		if (!board) return false;
		const current = getTrack()?.layer ?? board.copperLayer;
		const next = board.copperLayers[board.copperLayers.indexOf(current) + step];
		if (!next) return false;
		if (getTrack()) return switchTrackLayer(next);
		board.setCopperLayer(next);
		return true;
	});
	const boardCopperLayer = board?.copperLayer;
	const boardStack = board?.copperLayers;
	const shownStack = useRef(boardStack);
	const followCopperLayer = useEffectEvent(
		(layer: CopperLayer | undefined, stack: typeof boardStack) => {
			if (stack !== shownStack.current) {
				shownStack.current = stack;
				const active = getTrack() ?? getZoneChain();
				if (active && stack && !stack.includes(active.layer)) finishWire();
				return;
			}
			if (layer) switchTrackLayer(layer);
		},
	);
	useEffect(
		() => followCopperLayer(boardCopperLayer, boardStack),
		[boardCopperLayer, boardStack],
	);
	const flipTrackPosture = useEffectEvent(() => {
		const active = getTrack();
		if (!active) return false;
		active.posture =
			active.posture === "straight-first" ? "diagonal-first" : "straight-first";
		setWirePreview(null);
		return true;
	});
	const trackHandler: ToolHandler = {
		press: (event, point) => {
			if (!board) return;
			const active = getTrack();
			if (!active) {
				const anchor = startAnchorAt(point);
				let layer = board.copperLayer;
				if (anchor && !anchor.item.layers.includes(layer)) {
					layer = anchor.item.layers[0];
					board.setCopperLayer(layer);
				}
				gesture.current = {
					kind: "track",
					track: {
						start: anchor?.point ?? snapPoint(point, cameraView.getGridStep()),
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
				session.replace(
					[
						...session
							.shapes()
							.filter((shape) => earlier.has(shape.id))
							.map((shape) => ({ ...shape, net })),
						...next.segments,
					],
					"Route track",
				);
				active.netless = [];
			} else {
				session.place(next.segments, "Route track");
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
			if (!board) return false;
			const anchor = startAnchorAt(point);
			setConnectionHover(anchor?.point ?? null);
			canvas.style.cursor = "crosshair";
			return true;
		},
	};
	const zoneHandler: ToolHandler = {
		create: (start) => {
			const net = board?.netAt(start);
			return {
				...drawShape(session.nextId(), "rectangle", start, start),
				layer: board?.copperLayer ?? "F.Cu",
				lineWidth: 0.1,
				zone: {},
				...(net ? { net } : {}),
			};
		},
	};
	const polygonZone = (chain: ZoneChain, points: readonly Point[]) =>
		withZoneOutline(
			{
				id: session.nextId(),
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
		const scale = cameraView.getProjection()?.scale ?? 1;
		return outlineEncloses(points, 9 / (scale * scale));
	};
	/** Places the zone drawn so far once its corners enclose an area. A zone still too small keeps drawing. */
	const closeZone = useEffectEvent(() => {
		const active = getZoneChain();
		if (!active) return false;
		if (!closable(active.points)) return true;
		session.place([polygonZone(active, active.points)], "Draw zone");
		finishWire();
		setTool("select");
		return true;
	});
	const previewZone = (point: Point) => {
		const active = getZoneChain();
		if (!active) return;
		const end = snapPoint(point, cameraView.getGridStep());
		const points = [...active.points, end];
		setWirePreview(
			points.length > 2
				? [polygonZone(active, points)]
				: [
						{
							...drawShape(session.nextId(), "line", points[0], end),
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
				if (!board) return;
				const net = board.netAt(start);
				gesture.current = {
					kind: "zone",
					zone: {
						points: [start],
						layer: board.copperLayer,
						...(net ? { net } : {}),
						pointerId: event.pointerId,
					},
				};
				previewZone(start);
				return;
			}
			const scale = cameraView.getProjection()?.scale ?? 1;
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
			...drawShape(session.nextId(), "rectangle", start, start),
			layer: "Edge.Cuts",
			lineWidth: 0.1,
		}),
	};
	const drawingHandler = (
		kind: "rectangle" | "circle" | "triangle" | "line",
	): ToolHandler => ({
		create: (start) => onLayer(drawShape(session.nextId(), kind, start, start)),
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
				if (!symbolDefinition || (sheetless && symbolDefinition.netSymbol))
					return;
				const symbol = {
					...createSymbol(session.nextId(), symbolDefinition, start),
					rotation: placementRotation,
				};
				session.place([symbol], `Insert ${symbol.attributes.name}`);
				clearPlacementPreview();
				setTool("select");
				return;
			},
			hover: (_event, point) => {
				if (!symbolDefinition) return false;

				setPlacementPreview({
					tool,
					symbolDefinition,
					shape: createSymbol(
						session.nextId(),
						symbolDefinition,
						snapPoint(point, gridStep),
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
						session.shapes(),
						point,
						8 / (cameraView.getProjection()?.scale ?? 1),
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
						(cameraView.getProjection()?.scale ?? 1) <
						3
				)
					return;
				session.place(next.segments, "Draw wire");
				if (next.connected) {
					finishWire();
					setTool("select");
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
					session.shapes(),
					point,
					8 / (cameraView.getProjection()?.scale ?? 1),
				);
				setConnectionHover(connection ?? null);
				canvas.style.cursor = connection ? "crosshair" : "not-allowed";
				return true;
			},
		},
	};
	const pointerHandlers: Pick<
		DOMAttributes<HTMLDivElement>,
		| "onPointerLeave"
		| "onDoubleClickCapture"
		| "onPointerDownCapture"
		| "onPointerMoveCapture"
		| "onPointerUpCapture"
		| "onPointerCancelCapture"
		| "onLostPointerCapture"
	> = {
		onPointerLeave: () => {
			clearPlacementPreview();
			setConnectionHover(null);
		},
		onDoubleClickCapture: (event) => {
			if (!(event.target instanceof HTMLCanvasElement) || tool !== "select")
				return;
			const shape = pick(event, event.target);
			if (!shape) return;
			event.preventDefault();
			event.stopPropagation();
			if (shape.kind === "text") {
				session.select(new Set([shape.id]));
				setTextFocusId(shape.id);
			} else if (!session.getState().selection.has(shape.id))
				session.select(new Set([shape.id]));
			openAttributes();
		},
		onPointerDownCapture: (event) => {
			const canvas = event.target;
			if (!(canvas instanceof HTMLCanvasElement) || !ready) return;
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
					(tool !== "select" ||
						event.altKey ||
						!event[shortcutModifier().flag]))
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
					if (
						next <= distance &&
						canSelectShape(candidate.shape, allowLocked)
					) {
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
						originals.every(
							(item) => item.kind === "text" && !isNetLabel(item),
						))
						? snapStep / 10
						: snapStep,
				originals,
				created: created || !!duplicate,
				selectionMode: mode,
				wireStart,
			});
		},
		onPointerMoveCapture: (event) => {
			if (getDrag()) {
				updateDrag(event);
				return;
			}
			if (!(event.target instanceof HTMLCanvasElement)) return;
			const point = pointAt(
				event,
				event.target,
				tool === "select" ? 0 : toolHeight(),
			);
			if (!point) clearPlacementPreview();
			else if (toolHandlers[tool].hover?.(event.target, point)) return;
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
		},
		onPointerUpCapture: (event) => {
			if (getDrag()?.pointerId !== event.pointerId) return;
			// The release routes without the preview budget, so a move is refused
			// only when no safe route exists.
			withFullRouting(() => updateDrag(event));
			finishDrag();
		},
		onPointerCancelCapture: (event) => {
			if (tool === "symbol") {
				clearPlacementPreview();
				setTool("select");
				return;
			}
			if (getWire()?.pointerId === event.pointerId) {
				stop(event);
				finishWire();
				setTool("select");
				return;
			}
			if (getDrag()?.pointerId !== event.pointerId) return;
			stop(event);
			finishDrag(true);
		},
		onLostPointerCapture: (event) => {
			if (getDrag()?.pointerId === event.pointerId) finishDrag(true);
		},
	};
	return {
		getDrag,
		getWire,
		marquee,
		movingShapeId,
		wirePreview,
		placementPreview,
		clearPlacementPreview,
		canRotatePlacement,
		placing,
		rotatePlacement,
		connectionHover,
		finishDrag,
		finishWire,
		placeTrackVia,
		stepCopperLayer,
		flipTrackPosture,
		closeZone,
		pointerHandlers,
	};
}
