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
import type { CanvasView } from "#/components/editor/canvasView.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
import { isNetLabel } from "#/drawing/named-nets.ts";
import {
	createPlacementShape,
	isPlacementTool,
	type PlacementTool,
	placementLabel,
	placementSnapsToConnection,
} from "#/drawing/placement.ts";
import {
	canSelectShape,
	canSelectSymbolChild,
	constrainWireEndpoint,
	containsSelection,
	drawShape,
	type EditorShape,
	type EditorSymbol,
	findWireConnection,
	hitShape,
	intersectsSelection,
	moveShapes,
	moveSymbolChild,
	openPins,
	type ResizeHandle,
	resizeShape,
	resizeSymbolChild,
	routeWire,
	type ShapeKind,
	shapeAt,
	snapPoint,
	symbolChildren,
	symbolChildWorld,
} from "#/drawing/shapes.ts";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import type { Point } from "#/drawing/types.ts";
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
interface Drag {
	pointerId: number;
	canvas: HTMLCanvasElement;
	start: Point;
	startScreen: Point;
	previousSelection: ReadonlySet<number>;
	mode: "move" | "duplicate" | "marquee" | "draw" | "resize" | "symbol-child";
	childKey?: string;
	previousChild: string | null;
	handle?: ResizeHandle;
	anchorShape?: EditorShape;
	gridStep: number;
	moved: boolean;
	originals: EditorShape[];
	initialShapes: EditorShape[];
	created: boolean;
	valid: boolean;
	additive: boolean;
	wireStart?: Point;
}
interface Marquee {
	start: Point;
	end: Point;
	mode: "window" | "crossing";
}
interface WireChain {
	start: Point;
	pointerId: number;
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
	const [marquee, setMarquee] = useState<Marquee | null>(null);
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
	const previewWire = useCallback(
		(point: Point) => {
			const active = getWire();
			if (!active) return null;
			const snapStep = snapEnabled ? cameraView.getGridStep() : 0;
			const connection = findWireConnection(
				session.shapes(),
				point,
				8 / (cameraView.getSnapshot()?.camera.scale ?? 1),
				active.start,
			);
			const end =
				connection ?? constrainWireEndpoint(active.start, point, snapStep);
			setConnectionHover(connection ?? null);

			const segments = routeWire(session.nextId(), active.start, end);
			setWirePreview(segments);
			return { segments, end, connected: !!connection };
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
				wire: { start: connection, pointerId },
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
		active.moved ||=
			Math.hypot(end.x - active.startScreen.x, end.y - active.startScreen.y) >=
			3;
		if (active.wireStart && !active.moved) return;
		if (active.mode === "duplicate") {
			if (!active.moved) return;
			active.valid = true;
		}

		if (active.gridStep > 0 && !active.moved && active.mode !== "marquee")
			return;
		if (active.mode === "symbol-child") {
			const original = active.originals[0];
			if (
				!active.moved ||
				original.kind !== "symbol" ||
				active.childKey === undefined
			)
				return;
			const delta = {
				x: point.x - active.start.x,
				y: point.y - active.start.y,
			};
			previewReplacements([
				active.handle
					? resizeSymbolChild(
							original,
							active.childKey,
							active.handle,
							delta,
							active.gridStep,
							allowLocked,
						)
					: moveSymbolChild(
							original,
							active.childKey,
							delta,
							active.gridStep,
							allowLocked,
						),
			]);
			return;
		}
		if (active.mode === "resize" && active.handle) {
			previewReplacements([
				resizeShape(
					active.originals[0],
					active.handle,
					{
						x: point.x - active.start.x,
						y: point.y - active.start.y,
					},
					active.gridStep,
				),
			]);
			return;
		}
		if (active.mode === "draw") {
			const original = active.originals[0];
			if (original.kind === "symbol" || original.kind === "text") return;
			const draft = drawShape(
				original.id,
				original.kind,
				active.start,
				point,
				active.gridStep,
			);
			const scale = cameraView.getSnapshot()?.camera.scale ?? 1;
			active.valid =
				draft.width > 0 &&
				draft.height > 0 &&
				(draft.kind === "line"
					? draft.width
					: Math.min(draft.width, draft.height)) *
					scale >=
					3;
			setMovingShapeId(draft.id);
			previewReplacements([draft]);
			return;
		}
		if (active.mode === "move" || active.mode === "duplicate") {
			if (!active.moved) return;
			setMovingShapeId(active.anchorShape?.id ?? active.originals[0].id);
			previewReplacements(
				moveShapes(
					active.originals,
					{
						x: point.x - active.start.x,
						y: point.y - active.start.y,
					},
					active.gridStep,
					active.anchorShape,
					active.mode === "duplicate" ? active.originals : active.initialShapes,
					session.nextId(),
					allowLocked,
				),
				active.initialShapes,
			);
			return;
		}
		if (
			Math.hypot(end.x - active.startScreen.x, end.y - active.startScreen.y) < 3
		) {
			setMarquee(null);
			session.select(active.additive ? active.previousSelection : new Set());
			return;
		}
		const mode = end.x < active.startScreen.x ? "crossing" : "window";
		setMarquee({ start: active.startScreen, end, mode });
		const bounds = {
			minX: Math.min(active.start.x, point.x),
			maxX: Math.max(active.start.x, point.x),
			minY: Math.min(active.start.y, point.y),
			maxY: Math.max(active.start.y, point.y),
		};
		const ids = new Set(active.additive ? active.previousSelection : []);
		const matches = mode === "window" ? containsSelection : intersectsSelection;
		for (const shape of shapes) if (matches(shape, bounds)) ids.add(shape.id);
		session.select(ids);
	};
	const finishDrag = useCallback(
		(cancel = false) => {
			const active = getDrag();
			if (!active) return;
			gesture.current = { kind: "idle" };
			setMovingShapeId(null);
			active.canvas.style.cursor = "";
			setMarquee(null);
			if (cancel || (active.created && !active.valid)) {
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
				active.start = next.end;
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
			updateDrag(event);
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
