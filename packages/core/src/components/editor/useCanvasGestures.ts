import { isNetLabel } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	canSelectShape,
	canSelectSymbolChild,
	constrainWireEndpoint,
	drawShape,
	type EditorShape,
	type EditorSymbol,
	findWireConnection,
	hitShape,
	isUnsafeMove,
	openPins,
	type ResizeHandle,
	routeWire,
	type ShapeKind,
	shapeAt,
	snapPoint,
	symbolChildren,
	symbolChildWorld,
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
import {
	type Dispatch,
	type DOMAttributes,
	type PointerEvent as ReactPointerEvent,
	type SetStateAction,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type CanvasDrag,
	type CanvasMarquee,
	canvasDragStep,
} from "#/components/editor/canvasDrag.ts";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
import {
	createPlacementShape,
	isPlacementTool,
	type PlacementTool,
	placementLabel,
	placementSnapsToConnection,
} from "#/drawing/placement.ts";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import { screenToWorld } from "#/engine/camera.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export type CanvasTool =
	| "net"
	| "supply"
	| ShapeKind
	| "select"
	| "pan"
	| "symbol";
type Drag = CanvasDrag;
interface WireChain {
	start: Point;
	pointerId: number;
	/** Whether `start` is the pin the wire began at, so its lead sets the first direction. */
	fromPin: boolean;
	/** Direction of the last placed segment, preferred for the next one. */
	heading?: Heading;
}

type CanvasGesture =
	| { kind: "idle" }
	| { kind: "placing"; tool: CanvasTool }
	| { kind: "drag"; drag: Drag }
	| { kind: "wire"; wire: WireChain };

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
	snapEnabled: boolean;
	gridStep: number;
	symbolDefinition: SymbolDefinition | null;
	isSymbol: boolean;
	setTextFocusId: Dispatch<SetStateAction<number | null>>;
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
	snapEnabled,
	gridStep,
	symbolDefinition,
	isSymbol,
	setTextFocusId,
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
		isPlacementTool(tool) || (tool === "symbol" && !!symbolDefinition);
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
	const getWire = useCallback(() => {
		const active = getGesture();
		return active.kind === "wire" ? active.wire : null;
	}, [getGesture]);
	const [movingShapeId, setMovingShapeId] = useState<number | null>(null);
	const [wirePreview, setWirePreview] = useState<EditorShape[] | null>(null);
	const [connectionHover, setConnectionHover] = useState<Point | null>(null);
	const handleAt = (point: Point) => {
		const tolerance = 7 / (cameraView.getSnapshot()?.camera.scale ?? 1);
		return [...handles]
			.reverse()
			.find(
				({ handle }) =>
					Math.abs(handle.x - point.x) <= tolerance &&
					Math.abs(handle.y - point.y) <= tolerance,
			);
	};
	const pointAt = (
		event: Pick<ReactPointerEvent, "clientX" | "clientY">,
		canvas: HTMLCanvasElement,
	) => {
		const view = cameraView.getSnapshot();
		if (!view) return null;
		const rect = canvas.getBoundingClientRect();
		return screenToWorld(
			{ x: event.clientX - rect.left, y: event.clientY - rect.top },
			view.camera,
			rect.width,
			rect.height,
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
					8 / (cameraView.getSnapshot()?.camera.scale ?? 1),
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
			const active = getWire();
			if (!active) return null;
			const snapStep = snapEnabled ? cameraView.getGridStep() : 0;
			const shapes = session.shapes();
			const connection = findWireConnection(
				shapes,
				point,
				8 / (cameraView.getSnapshot()?.camera.scale ?? 1),
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
		[getWire, snapEnabled, cameraView, session],
	);
	const finishWire = useCallback(() => {
		if (gesture.current.kind === "wire") gesture.current = { kind: "idle" };
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
	const updateDrag = (event: ReactPointerEvent) => {
		const active = getDrag();
		if (!active || active.pointerId !== event.pointerId) return;
		stop(event);
		const point = pointAt(event, active.canvas);
		if (!point) return;
		const rect = active.canvas.getBoundingClientRect();
		const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		const step = canvasDragStep(active, point, end, {
			shapes,
			allowLocked,
			cameraScale: () => cameraView.getSnapshot()?.camera.scale ?? 1,
			nextId: session.nextId,
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
						: original.kind;
				const createdIds = new Set(active.originals.map((shape) => shape.id));
				session.place(
					session.shapes().filter((shape) => createdIds.has(shape.id)),
					active.mode === "duplicate" ? `Duplicate ${kind}` : `Draw ${kind}`,
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
				session.replace(
					session.shapes().filter((shape) => shape !== initial.get(shape.id)),
					active.mode === "symbol-child"
						? active.handle
							? "Resize symbol child"
							: "Move symbol child"
						: active.mode === "move"
							? "Move selection"
							: `Resize ${active.originals[0].kind}`,
				);
			}
			if (active.canvas.hasPointerCapture(active.pointerId))
				active.canvas.releasePointerCapture(active.pointerId);
		},
		[getDrag, session, setTool, startWire],
	);
	const selectShape = (id: number, additive: boolean) => {
		const ids = new Set(additive ? selectedIds : []);
		if (additive && ids.has(id)) ids.delete(id);
		else ids.add(id);
		session.select(ids);
	};

	const placementHandler = (kind: PlacementTool): ToolHandler => ({
		press: (_event, point, start) => {
			const placed = {
				...createPlacementShape(
					kind,
					session.nextId(),
					placementAnchor(kind, point, start),
					measureText,
				),
				rotation: placementRotation,
			};
			session.place([placed], placementLabel(kind));
			setTool("select");
			if (placed.kind === "text") setTextFocusId(placed.id);
			return;
		},
		hover: (_event, point) => {
			setPlacementPreview({
				tool,
				symbolDefinition,
				shape: createPlacementShape(
					kind,
					session.nextId(),
					placementAnchor(
						kind,
						point,
						snapPoint(point, snapEnabled ? gridStep : 0),
					),
					measureText,
				),
			});
			return true;
		},
	});
	const drawingHandler = (
		kind: "rectangle" | "circle" | "triangle" | "line",
	): ToolHandler => ({
		create: (start) => drawShape(session.nextId(), kind, start, start),
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
		symbol: {
			press: (_event, _point, start) => {
				if (!symbolDefinition || (isSymbol && symbolDefinition.netSymbol))
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
						snapPoint(point, snapEnabled ? gridStep : 0),
					),
				});
				return true;
			},
		},
		wire: {
			press: (event, point) => {
				const active = getWire();
				if (!active) {
					const connection = findWireConnection(
						session.shapes(),
						point,
						8 / (cameraView.getSnapshot()?.camera.scale ?? 1),
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
						(cameraView.getSnapshot()?.camera.scale ?? 1) <
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
				if (getWire()) return false;

				const connection = findWireConnection(
					session.shapes(),
					point,
					8 / (cameraView.getSnapshot()?.camera.scale ?? 1),
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
			const point = pointAt(event, event.target);
			const shape =
				point &&
				shapeAt(shapes, point, 0, (shape) =>
					canSelectShape(shape, allowLocked),
				);
			if (shape?.kind !== "text") return;
			event.preventDefault();
			event.stopPropagation();
			session.select(new Set([shape.id]));
			setTextFocusId(shape.id);
		},
		onPointerDownCapture: (event) => {
			const canvas = event.target;
			if (!(canvas instanceof HTMLCanvasElement) || !ready) return;
			if (getDrag()) {
				stop(event);
				return;
			}
			if (
				!event.isPrimary ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				tool === "pan"
			)
				return;
			const point = pointAt(event, canvas);
			if (!point) return;
			const hit =
				tool === "select"
					? shapeAt(
							shapes,
							point,
							6 / (cameraView.getSnapshot()?.camera.scale ?? 1),
							(candidate) => canSelectShape(candidate, allowLocked),
						)
					: undefined;
			const duplicate =
				event.altKey && (hit?.kind === "symbol" || hit?.kind === "text")
					? hit
					: undefined;
			if (event.altKey && !duplicate) return;
			stop(event);
			canvas.focus({ preventScroll: true });
			const resize = duplicate ? undefined : handleAt(point);
			canvas.style.cursor = resize?.handle.cursor ?? "";
			let shape: EditorShape | undefined;
			const created = tool !== "select";
			const snapStep = snapEnabled ? cameraView.getGridStep() : 0;
			const start = created ? snapPoint(point, snapStep) : point;
			let wireStart: Point | undefined;
			const childHit =
				!created &&
				!resize &&
				!duplicate &&
				!event.shiftKey &&
				selectedSymbol &&
				hit?.id === selectedSymbol.id
					? [...symbolChildren(selectedSymbol)]
							.reverse()
							.find((child) =>
								hitShape(
									symbolChildWorld(selectedSymbol, child.shape),
									point,
									0,
								),
							)
					: undefined;
			if (childHit) shape = selectedSymbol;
			const editableChild =
				childHit &&
				selectedSymbol &&
				canSelectSymbolChild(selectedSymbol, childHit, allowLocked)
					? childHit
					: undefined;

			if (
				tool === "select" &&
				!event.shiftKey &&
				!resize &&
				!duplicate &&
				(!childHit || childHit.shape.kind === "pin")
			) {
				let connection: ReturnType<typeof openPins>[number] | undefined;
				let distance = 8 / (cameraView.getSnapshot()?.camera.scale ?? 1);
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
			if (duplicate) {
				shape = pasteSelection([duplicate], shapes, session.nextId(), {
					x: 0,
					y: 0,
				})[0];
				session.preview([...session.shapes(), shape]);
			} else if (created) {
				const create = handler.create;
				if (!create) return;
				shape = create(start);
				session.preview([...session.shapes(), shape]);
			} else if (resize) shape = resize.shape;
			else if (!shape) shape = hit;
			if (shape && event.shiftKey && !created && !resize && !duplicate) {
				selectShape(shape.id, true);
				return;
			}
			const childKey = resize?.childKey ?? editableChild?.key;

			const originals = shape
				? childKey === undefined &&
					!created &&
					!resize &&
					!duplicate &&
					selectedIds.has(shape.id)
					? selected
					: [shape]
				: [];
			session.select(
				resize
					? selectedIds
					: shape
						? new Set(originals.map((item) => item.id))
						: event.shiftKey
							? selectedIds
							: new Set(),
			);
			session.selectChild(childKey ?? null);
			const rect = canvas.getBoundingClientRect();
			gesture.current = {
				kind: "drag",
				drag: {
					pointerId: event.pointerId,
					canvas,
					start,
					startScreen: {
						x: event.clientX - rect.left,
						y: event.clientY - rect.top,
					},
					previousSelection: selectedIds,
					childKey,
					previousChild: selectedChildKey,
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
					moved: false,
					originals,
					initialShapes: session.shapes(),
					created: created || !!duplicate,
					valid: false,
					additive: event.shiftKey,
					wireStart,
				},
			};
			canvas.setPointerCapture(event.pointerId);
		},
		onPointerMoveCapture: (event) => {
			if (getDrag()) {
				updateDrag(event);
				return;
			}
			if (!(event.target instanceof HTMLCanvasElement)) return;
			const point = pointAt(event, event.target);
			if (point && toolHandlers[tool].hover?.(event.target, point)) return;
			if (
				getWire() &&
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
			event.target.style.cursor = point
				? (handleAt(point)?.handle.cursor ?? "")
				: "";
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
		rotatePlacement,
		connectionHover,
		finishDrag,
		finishWire,
		pointerHandlers,
	};
}
