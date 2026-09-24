import { Effect, Either } from "effect";
import {
	Circle,
	Hand,
	Magnet,
	MapPin,
	MousePointer2,
	Slash,
	Square,
	Trash2,
	Triangle,
	Type,
} from "lucide-react";
import {
	Fragment,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type CommandResult,
	type InvalidDrawingCommand,
	jumpHistoryEffect,
	placeShapesEffect,
	redoEffect,
	removeShapesEffect,
	replaceShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store";
import {
	constrainWireEndpoint,
	drawShape,
	type EditorShape,
	editShapeAttribute,
	findWireConnection,
	hitShape,
	intersectsSelection,
	moveShapes,
	type ResizeHandle,
	resizeHandles,
	resizeShape,
	routeWire,
	type ShapeKind,
	snapPoint,
} from "#/drawing/shapes";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols";
import type { Point } from "#/drawing/types";
import { defaultSheet, type SheetSize } from "#/drawing/worksheet";
import { screenToWorld, worldToScreen } from "#/engine/camera";
import { rulerSpacing } from "#/engine/ruler";
import { OrthographicViewer2D } from "../viewer/OrthographicViewer2D";
import type { Viewer2DSnapshot } from "../viewer/types/Viewer2DSnapshot";
import { viewControlButtonClassName } from "../viewer/ViewControls3D";
import { HistoryControls } from "./HistoryControls";
import { SelectionAttributes } from "./SelectionAttributes";
import { SymbolPicker } from "./SymbolPicker";
import { createTextShape, updateText } from "./text";
import { useEditorScene } from "./useEditorScene";

const tools = [
	{ kind: "select", label: "Select", icon: MousePointer2 },
	{ kind: "pan", label: "Pan", icon: Hand },
	{ kind: "rectangle", label: "Rectangle", icon: Square },
	{ kind: "circle", label: "Circle", icon: Circle },
	{ kind: "triangle", label: "Triangle", icon: Triangle },
	{ kind: "wire", label: "Wire", icon: Slash },
	{ kind: "pin", label: "Pin", icon: MapPin },
	{ kind: "text", label: "Text", icon: Type },
] as const;
type Tool = ShapeKind | "select" | "pan" | "symbol";
interface Drag {
	pointerId: number;
	canvas: HTMLCanvasElement;
	start: Point;
	startScreen: Point;
	previousSelection: Set<number>;
	mode: "move" | "marquee" | "draw" | "resize";
	handle?: ResizeHandle;
	anchorShape?: EditorShape;
	gridStep: number;
	moved: boolean;
	originals: EditorShape[];
	initialShapes: EditorShape[];
	created: boolean;
	valid: boolean;
	additive: boolean;
}
interface Marquee {
	start: Point;
	end: Point;
}
interface WireChain {
	start: Point;
	pointerId: number;
}
export interface Editor2DProps {
	sheet?: SheetSize;
	/** Supply a store to run commands from outside the editor as well. */
	store?: ReturnType<typeof createDrawingStore>;
}

export function Editor2D({
	sheet = defaultSheet,
	store: suppliedStore,
}: Editor2DProps = {}) {
	const [ownedStore] = useState(() => createDrawingStore());
	const store = suppliedStore ?? ownedStore;
	const drawing = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const history = drawing.history;
	const executingCommand = useRef(false);
	// A gesture changes only this preview. Commands receive the completed geometry.
	const [draftShapes, setDraftShapes] = useState<EditorShape[] | null>(null);
	const currentDraft = useRef<EditorShape[] | null>(null);
	const shapes = draftShapes ?? drawing.shapes;
	const currentShapes = {
		get current() {
			return currentDraft.current ?? store.getSnapshot().shapes;
		},
	};
	const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
	const currentSelection = useRef(selectedIds);
	// Selection restoration is an editor preference, separate from document history.
	const historySelection = useRef(new Map<number, number[]>([[0, []]]));
	const [marquee, setMarquee] = useState<Marquee | null>(null);
	const [tool, setTool] = useState<Tool>("select");
	const [symbolDefinition, setSymbolDefinition] =
		useState<SymbolDefinition | null>(null);
	const [symbolPreview, setSymbolPreview] = useState<EditorShape | null>(null);
	const [textFocusId, setTextFocusId] = useState<number | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(true);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState("");
	const snapshot = useRef<Viewer2DSnapshot | null>(null);
	const [view, setView] = useState<Viewer2DSnapshot | null>(null);
	const drag = useRef<Drag | null>(null);
	const wireChain = useRef<WireChain | null>(null);
	const [wirePreview, setWirePreview] = useState<EditorShape[] | null>(null);
	const [connectionHover, setConnectionHover] = useState<Point | null>(null);
	const nextId = {
		get current() {
			return store.getSnapshot().nextShapeId;
		},
	};
	const { scene, updateScene } = useEditorScene(
		shapes,
		selectedIds,
		wirePreview ?? (symbolPreview ? [symbolPreview] : []),
		sheet,
	);
	const selected = shapes.filter((shape) => selectedIds.has(shape.id));
	const gridStep = view ? rulerSpacing(view.camera.scale).minor : 0;
	const handles =
		tool === "select"
			? selected.flatMap((shape) =>
					resizeHandles(shape).map((handle) => ({ shape, handle })),
				)
			: [];
	const handleAt = (point: Point) => {
		const tolerance = 7 / (snapshot.current?.camera.scale ?? 1);
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
		const view = snapshot.current;
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
	const setPreviewShapes = (next: EditorShape[] | null) => {
		currentDraft.current = next;
		setDraftShapes(next);
	};
	const applySelection = (ids: Set<number>) => {
		currentSelection.current = ids;
		setSelectedIds(ids);
	};
	const execute = <A,>(
		program: Effect.Effect<A, InvalidDrawingCommand, DrawingStore>,
	): A | undefined => {
		executingCommand.current = true;
		try {
			const result = Effect.runSync(
				program.pipe(Effect.provideService(DrawingStore, store), Effect.either),
			);
			if (Either.isLeft(result)) {
				setError(result.left.message);
				return undefined;
			}
			return result.right;
		} finally {
			executingCommand.current = false;
		}
	};
	const acceptEdit = (
		result: CommandResult,
		previousHistoryId: number,
		ids = currentSelection.current,
	) => {
		setPreviewShapes(null);
		const committed = store.getSnapshot();
		const existingIds = new Set(committed.shapes.map((shape) => shape.id));
		const selection = new Set<number>();
		for (const id of ids) {
			const survivor = result.idMap.get(id);
			if (survivor !== undefined && existingIds.has(survivor))
				selection.add(survivor);
		}
		applySelection(selection);
		const historyId = committed.history.currentId;
		if (historyId !== previousHistoryId)
			historySelection.current.set(historyId, [...selection]);
	};
	const placeShapes = (next: EditorShape[], label: string) => {
		const previousHistoryId = store.getSnapshot().history.currentId;
		const result = execute(placeShapesEffect(next, label));
		if (result) acceptEdit(result, previousHistoryId, new Set(result.ids));
		else setPreviewShapes(null);
	};
	const commitReplacements = (replacements: EditorShape[], label: string) => {
		const previousHistoryId = store.getSnapshot().history.currentId;
		const result = execute(
			replaceShapesEffect(replacements, label, [...currentSelection.current]),
		);
		if (result) acceptEdit(result, previousHistoryId);
		else setPreviewShapes(null);
	};
	const previewReplacements = (replacements: EditorShape[]) => {
		const byId = new Map(replacements.map((shape) => [shape.id, shape]));
		setPreviewShapes(
			currentShapes.current.map((shape) => byId.get(shape.id) ?? shape),
		);
	};
	const previewWire = (point: Point) => {
		const active = wireChain.current;
		if (!active) return null;
		const snapStep =
			snapEnabled && snapshot.current
				? rulerSpacing(snapshot.current.camera.scale).minor
				: 0;
		const connection = findWireConnection(
			currentShapes.current,
			point,
			8 / (snapshot.current?.camera.scale ?? 1),
			active.start,
		);
		const end =
			connection ?? constrainWireEndpoint(active.start, point, snapStep);
		setConnectionHover(connection ?? null);
		// Only snap the new endpoint so changing the grid never separates corners.
		const segments = routeWire(nextId.current, active.start, end);
		setWirePreview(segments);
		return { segments, end, connected: !!connection };
	};
	const finishWire = () => {
		wireChain.current = null;
		setWirePreview(null);
		setConnectionHover(null);
		setSymbolPreview(null);
	};
	const updateDrag = (event: ReactPointerEvent) => {
		const active = drag.current;
		if (!active || active.pointerId !== event.pointerId) return;
		stop(event);
		const point = pointAt(event, active.canvas);
		if (!point) return;
		const rect = active.canvas.getBoundingClientRect();
		const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		active.moved ||=
			Math.hypot(end.x - active.startScreen.x, end.y - active.startScreen.y) >=
			3;
		// Selecting an off-grid shape must not move or resize it.
		if (active.gridStep > 0 && !active.moved && active.mode !== "marquee")
			return;
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
			const scale = snapshot.current?.camera.scale ?? 1;
			active.valid =
				draft.width > 0 &&
				draft.height > 0 &&
				Math.min(draft.width, draft.height) * scale >= 3;
			previewReplacements([draft]);
			return;
		}
		if (active.mode === "move") {
			previewReplacements(
				moveShapes(
					active.originals,
					{
						x: point.x - active.start.x,
						y: point.y - active.start.y,
					},
					active.gridStep,
					active.anchorShape,
					active.initialShapes,
				),
			);
			return;
		}
		if (
			Math.hypot(end.x - active.startScreen.x, end.y - active.startScreen.y) < 3
		) {
			setMarquee(null);
			applySelection(active.additive ? active.previousSelection : new Set());
			return;
		}
		setMarquee({ start: active.startScreen, end });
		const bounds = {
			minX: Math.min(active.start.x, point.x),
			maxX: Math.max(active.start.x, point.x),
			minY: Math.min(active.start.y, point.y),
			maxY: Math.max(active.start.y, point.y),
		};
		const ids = new Set(active.additive ? active.previousSelection : []);
		for (const shape of shapes)
			if (intersectsSelection(shape, bounds)) ids.add(shape.id);
		applySelection(ids);
	};
	const finishDrag = (cancel = false) => {
		const active = drag.current;
		if (!active) return;
		drag.current = null;
		active.canvas.style.cursor = "";
		setMarquee(null);
		if (cancel || (active.created && !active.valid)) {
			setPreviewShapes(null);
			applySelection(active.previousSelection);
		} else if (active.created) {
			const createdIds = new Set(active.originals.map((shape) => shape.id));
			placeShapes(
				currentShapes.current.filter((shape) => createdIds.has(shape.id)),
				`Draw ${active.originals[0].kind}`,
			);
			setTool("select");
		} else if (active.mode === "move" || active.mode === "resize") {
			const initial = new Map(
				active.initialShapes.map((shape) => [shape.id, shape]),
			);
			commitReplacements(
				currentShapes.current.filter(
					(shape) => shape !== initial.get(shape.id),
				),
				active.mode === "move"
					? "Move selection"
					: `Resize ${active.originals[0].kind}`,
			);
		}
		if (active.canvas.hasPointerCapture(active.pointerId))
			active.canvas.releasePointerCapture(active.pointerId);
	};
	const restoreHistory = (
		program: Effect.Effect<unknown, InvalidDrawingCommand, DrawingStore>,
	) => {
		finishDrag(true);
		finishWire();
		if (tool === "symbol") setTool("select");
		execute(program);
		const restored = store.getSnapshot();
		setPreviewShapes(null);
		const existing = new Set(restored.shapes.map((shape) => shape.id));
		applySelection(
			new Set(
				(historySelection.current.get(restored.history.currentId) ?? []).filter(
					(id) => existing.has(id),
				),
			),
		);
	};
	const undo = () => restoreHistory(undoEffect);
	const redo = () => restoreHistory(redoEffect);
	const removeSelected = () => {
		finishDrag();
		if (wireChain.current) {
			finishWire();
			setTool("select");
		}
		const previousHistoryId = store.getSnapshot().history.currentId;
		const result = execute(removeShapesEffect([...currentSelection.current]));
		if (result) acceptEdit(result, previousHistoryId, new Set());
	};
	const selectShape = (id: number, additive: boolean) => {
		const ids = new Set(additive ? selectedIds : []);
		if (additive && ids.has(id)) ids.delete(id);
		else ids.add(id);
		applySelection(ids);
	};

	const reconcileExternalEdit = useEffectEvent(() => {
		if (executingCommand.current) return;
		// Another caller changed the document. A stale gesture must not overwrite it.
		finishDrag(true);
		finishWire();
		const existing = new Set(
			store.getSnapshot().shapes.map((shape) => shape.id),
		);
		applySelection(
			new Set([...currentSelection.current].filter((id) => existing.has(id))),
		);
	});
	useEffect(() => {
		historySelection.current = new Map([[0, []]]);
		reconcileExternalEdit();
		return store.subscribe(reconcileExternalEdit);
	}, [store]);

	return (
		<main
			className="relative flex h-dvh flex-col overflow-hidden"
			onKeyDownCapture={(event) => {
				const target = event.target;
				if (event.key === "Escape" && tool === "symbol") {
					setSymbolPreview(null);
					setTool("select");
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				if (
					!(event.ctrlKey || event.metaKey) ||
					event.altKey ||
					(target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest("input, textarea, select")))
				)
					return;
				const key = event.key.toLowerCase();
				if (key === "z") {
					if (event.shiftKey) redo();
					else undo();
				} else if (key === "y" && !event.shiftKey) redo();
				else return;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<h1 className="sr-only">
				2D editor · {sheet.name ? `${sheet.name} · ` : ""}
				{sheet.width} × {sheet.height} mm
			</h1>
			<header className="absolute top-10 left-10 z-2 flex items-center gap-2 max-[600px]:top-9 max-[600px]:left-9">
				<a
					href="/"
					className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] no-underline shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] focus-visible:outline-2 focus-visible:outline-amber-200"
				>
					Gerber viewer
				</a>
				<a
					href="/step"
					className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] no-underline shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] focus-visible:outline-2 focus-visible:outline-amber-200"
				>
					STEP viewer
				</a>
			</header>
			<div className="relative flex min-h-0 flex-1">
				<div
					className={`relative min-w-0 flex-1 touch-none ${tool === "pan" ? "[&_canvas]:cursor-grab" : tool === "select" ? "" : "[&_canvas]:cursor-crosshair"}`}
					data-tool={tool}
					onPointerLeave={() => {
						setSymbolPreview(null);
						setConnectionHover(null);
					}}
					onDoubleClickCapture={(event) => {
						if (
							!(event.target instanceof HTMLCanvasElement) ||
							tool !== "select"
						)
							return;
						const point = pointAt(event, event.target);
						const shape =
							point &&
							[...shapes].reverse().find((shape) => hitShape(shape, point, 0));
						if (shape?.kind !== "text") return;
						event.preventDefault();
						event.stopPropagation();
						applySelection(new Set([shape.id]));
						setTextFocusId(shape.id);
					}}
					onPointerDownCapture={(event) => {
						const canvas = event.target;
						if (!(canvas instanceof HTMLCanvasElement) || !ready) return;
						if (drag.current) {
							stop(event);
							return;
						}
						if (
							!event.isPrimary ||
							event.button !== 0 ||
							event.ctrlKey ||
							event.metaKey ||
							event.altKey ||
							tool === "pan"
						)
							return;
						const point = pointAt(event, canvas);
						if (!point) return;
						stop(event);
						canvas.focus({ preventScroll: true });
						const resize = handleAt(point);
						canvas.style.cursor = resize?.handle.cursor ?? "";
						let shape: EditorShape | undefined;
						const created = tool !== "select";
						const snapStep =
							snapEnabled && snapshot.current
								? rulerSpacing(snapshot.current.camera.scale).minor
								: 0;
						const start = created ? snapPoint(point, snapStep) : point;
						if (tool === "text") {
							const text = createTextShape(nextId.current, start);
							placeShapes([text], "Draw text");
							setTool("select");
							setTextFocusId(text.id);
							return;
						}
						if (tool === "symbol") {
							if (!symbolDefinition) return;
							const symbol = createSymbol(
								nextId.current,
								symbolDefinition,
								start,
							);
							placeShapes([symbol], `Insert ${symbol.attributes.name}`);
							setSymbolPreview(null);
							setTool("select");
							return;
						}
						if (tool === "pin") {
							const pin = drawShape(nextId.current, "pin", start, start);
							placeShapes([pin], "Place pin");
							setTool("select");
							return;
						}
						if (tool === "wire") {
							const active = wireChain.current;
							if (!active) {
								const connection = findWireConnection(
									currentShapes.current,
									point,
									8 / (snapshot.current?.camera.scale ?? 1),
								);
								if (!connection) return;
								wireChain.current = {
									start: connection,
									pointerId: event.pointerId,
								};
								previewWire(connection);
								return;
							}
							const next = previewWire(point);
							if (
								!next ||
								next.segments.reduce((sum, segment) => sum + segment.width, 0) *
									(snapshot.current?.camera.scale ?? 1) <
									3
							)
								return;
							placeShapes(next.segments, "Draw wire");
							if (next.connected) {
								finishWire();
								setTool("select");
								return;
							}
							active.start = next.end;
							active.pointerId = event.pointerId;
							setWirePreview(null);
							return;
						}
						if (created) {
							shape = drawShape(nextId.current, tool, start, start);
							setPreviewShapes([...currentShapes.current, shape]);
						} else if (resize) shape = resize.shape;
						else
							shape = [...shapes]
								.reverse()
								.find((candidate) =>
									hitShape(
										candidate,
										point,
										6 / (snapshot.current?.camera.scale ?? 1),
									),
								);
						if (shape && event.shiftKey && !created && !resize) {
							selectShape(shape.id, true);
							return;
						}
						const originals = shape
							? !created && !resize && selectedIds.has(shape.id)
								? selected
								: [shape]
							: [];
						applySelection(
							resize
								? selectedIds
								: shape
									? new Set(originals.map((item) => item.id))
									: event.shiftKey
										? selectedIds
										: new Set(),
						);
						const rect = canvas.getBoundingClientRect();
						drag.current = {
							pointerId: event.pointerId,
							canvas,
							start,
							startScreen: {
								x: event.clientX - rect.left,
								y: event.clientY - rect.top,
							},
							previousSelection: selectedIds,
							mode: created
								? "draw"
								: resize
									? "resize"
									: shape
										? "move"
										: "marquee",
							handle: resize?.handle,
							anchorShape: shape,
							gridStep: snapStep,
							moved: false,
							originals,
							initialShapes: currentShapes.current,
							created,
							valid: false,
							additive: event.shiftKey,
						};
						canvas.setPointerCapture(event.pointerId);
					}}
					onPointerMoveCapture={(event) => {
						if (drag.current) {
							updateDrag(event);
							return;
						}
						if (!(event.target instanceof HTMLCanvasElement)) return;
						const point = pointAt(event, event.target);
						if (tool === "wire" && !wireChain.current && point) {
							const connection = findWireConnection(
								currentShapes.current,
								point,
								8 / (snapshot.current?.camera.scale ?? 1),
							);
							setConnectionHover(connection ?? null);
							event.target.style.cursor = connection
								? "crosshair"
								: "not-allowed";
							return;
						}
						if (tool === "symbol" && symbolDefinition && point) {
							setSymbolPreview(
								createSymbol(
									nextId.current,
									symbolDefinition,
									snapPoint(point, snapEnabled ? gridStep : 0),
								),
							);
							return;
						}
						if (
							wireChain.current &&
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
					}}
					onPointerUpCapture={(event) => {
						if (drag.current?.pointerId !== event.pointerId) return;
						updateDrag(event);
						finishDrag();
					}}
					onPointerCancelCapture={(event) => {
						if (tool === "symbol") {
							setSymbolPreview(null);
							setTool("select");
							return;
						}
						if (wireChain.current?.pointerId === event.pointerId) {
							stop(event);
							finishWire();
							setTool("select");
							return;
						}
						if (drag.current?.pointerId !== event.pointerId) return;
						stop(event);
						finishDrag(true);
					}}
					onLostPointerCapture={(event) => {
						if (drag.current?.pointerId === event.pointerId) finishDrag(true);
					}}
					onKeyDownCapture={(event) => {
						if (!(event.target instanceof HTMLCanvasElement)) return;
						if (
							wireChain.current &&
							(event.key === "Escape" || event.key === "Enter")
						) {
							finishWire();
							setTool("select");
							event.preventDefault();
							event.stopPropagation();
							return;
						}
						if (event.key === "Escape") {
							if (drag.current) finishDrag(true);
							else applySelection(new Set());
						} else if (
							selected.length > 0 &&
							(event.key === "Delete" || event.key === "Backspace")
						) {
							finishDrag();
							removeSelected();
						} else if (selected.length > 0 && event.key.startsWith("Arrow")) {
							if (drag.current) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (wireChain.current) {
								finishWire();
								setTool("select");
							}
							const snapStep = snapEnabled ? gridStep : 0;
							const step = (snapStep || 1) * (event.shiftKey ? 10 : 1);
							commitReplacements(
								moveShapes(
									selected,
									{
										x:
											event.key === "ArrowRight"
												? step
												: event.key === "ArrowLeft"
													? -step
													: 0,
										y:
											event.key === "ArrowUp"
												? step
												: event.key === "ArrowDown"
													? -step
													: 0,
									},
									snapStep,
									selected[0],
									currentShapes.current,
								),
								"Move selection",
							);
						} else return;
						event.preventDefault();
						event.stopPropagation();
					}}
				>
					{scene && (
						<OrthographicViewer2D
							scene={scene}
							fitZoom={1.1}
							gridBounds={{
								minX: -sheet.width / 2,
								maxX: sheet.width / 2,
								minY: -sheet.height / 2,
								maxY: sheet.height / 2,
							}}
							updateScene={updateScene}
							selectionEnabled={false}
							onReady={setReady}
							onError={setError}
							onChange={(value) => {
								snapshot.current = value;
								setView((current) =>
									current &&
									current.camera.x === value.camera.x &&
									current.camera.y === value.camera.y &&
									current.camera.scale === value.camera.scale &&
									current.viewport.width === value.viewport.width &&
									current.viewport.height === value.viewport.height
										? current
										: value,
								);
							}}
							extraControls={
								<fieldset aria-label="Drawing tools" className="contents">
									<HistoryControls
										history={history}
										disabled={!ready}
										onUndo={undo}
										onRedo={redo}
										onRestore={(id) => restoreHistory(jumpHistoryEffect(id))}
									/>
									{tools.map(({ kind, label, icon: Icon }) => (
										<Fragment key={kind}>
											{(kind === "select" || kind === "rectangle") && (
												<span
													aria-hidden="true"
													className="mx-1 h-6 w-px self-center bg-white/20"
												/>
											)}
											<button
												type="button"
												className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
												disabled={!ready}
												aria-label={label}
												title={label}
												aria-pressed={tool === kind}
												onClick={() => {
													finishWire();
													setTool(kind);
												}}
											>
												<Icon size={18} aria-hidden="true" />
											</button>
										</Fragment>
									))}
									<SymbolPicker
										disabled={!ready}
										active={tool === "symbol"}
										onChoose={(definition) => {
											finishDrag();
											finishWire();
											setSymbolDefinition(definition);
											setTool("symbol");
										}}
									/>
									<button
										type="button"
										className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
										disabled={!ready}
										aria-label="Snap to grid"
										aria-pressed={snapEnabled}
										title={`Snap to grid (${gridStep} mm)`}
										onClick={() => setSnapEnabled((enabled) => !enabled)}
									>
										<Magnet size={18} aria-hidden="true" />
									</button>
									<button
										type="button"
										className={viewControlButtonClassName}
										disabled={!selected.length}
										aria-label="Delete"
										title="Delete selected shapes"
										onClick={removeSelected}
									>
										<Trash2 size={18} aria-hidden="true" />
									</button>
								</fieldset>
							}
							ariaLabel="2D shape editor"
							interactionHint="Choose Symbols in the toolbar, pick a symbol, then click to place it. Escape cancels placement. Select any part of a symbol to move or delete it as one object; edit its name, reference and value in Attributes. Drag to draw rectangles, triangles and circles. Rectangles and triangles use two opposite corners; circles use a center and radius. Release to finish or press Escape to cancel. For text, choose Text and click to place it, then type in the Attributes panel. Double-click text to edit it again. Text handles resize proportionally. For wires, start at a pin or an open wire endpoint, then click to place each corner. Click another pin or open wire endpoint to connect and finish. Choose Pin and click to place a single connection point. Each click places a horizontal or vertical segment. Press Escape or Enter to end the chain and keep placed segments. Moving a segment also moves attached endpoints and keeps neighboring segments horizontal or vertical. When you finish an edit, zero-length segments are removed and touching or overlapping segments on the same straight line merge. Segments meeting at corners remain separate objects. Drag selected shapes' handles to resize; circle handles change the radius and wire handles move endpoints. Enable Snap to grid to align placement and resizing with the visible grid; arrow keys then move by one grid step, or ten with Shift. Drag empty space to select shapes. Shift + drag adds to the selection. Use the Pan tool or middle-drag to pan; pinch or Ctrl + scroll to zoom. With snapping off, arrow keys move selected shapes by 1 mm, Shift + arrows by 10 mm. Delete removes the selection. Undo with Ctrl or Cmd + Z; redo with Ctrl or Cmd + Shift + Z, or Ctrl + Y. Open History to return to any saved edit, including alternate branches. Selection, tools, snapping and navigation do not add history steps. F6 fits the sheet."
						/>
					)}
					{view && (
						<div
							className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
							aria-hidden="true"
						>
							{connectionHover &&
								tool === "wire" &&
								(() => {
									const point = worldToScreen(
										connectionHover,
										view.camera,
										view.viewport.width,
										view.viewport.height,
									);
									return (
										<span
											data-testid="wire-connection"
											className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#e8b77e]"
											style={{ left: point.x, top: point.y }}
										/>
									);
								})()}
							{handles.map(({ shape, handle }) => {
								const point = worldToScreen(
									handle,
									view.camera,
									view.viewport.width,
									view.viewport.height,
								);
								return (
									<span
										key={`${shape.id}:${handle.id}`}
										className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border border-[#e8b77e] bg-[#19212e]"
										data-testid="resize-handle"
										data-shape-id={shape.id}
										data-handle={handle.id}
										style={{ left: point.x, top: point.y }}
									/>
								);
							})}
						</div>
					)}
					{marquee && (
						<div
							className="pointer-events-none absolute z-2 border border-[#e8b77e] bg-[#e8b77e25]"
							data-testid="selection-rectangle"
							aria-hidden="true"
							style={{
								left: Math.min(marquee.start.x, marquee.end.x),
								top: Math.min(marquee.start.y, marquee.end.y),
								width: Math.abs(marquee.end.x - marquee.start.x),
								height: Math.abs(marquee.end.y - marquee.start.y),
							}}
						/>
					)}
					{(tool === "wire" || tool === "pin") && (
						<output className="pointer-events-none absolute bottom-32 left-1/2 z-2 -translate-x-1/2 rounded-lg border border-[#414955] bg-[#191c22] px-3 py-2 text-sm text-[#e8b77e]">
							{tool === "pin"
								? "Click to place a pin."
								: wireChain.current
									? "Click for a corner or connect to a pin or open wire end. Enter finishes."
									: "Start at a pin or an open wire end."}
						</output>
					)}
					{tool === "symbol" && symbolDefinition && (
						<output className="pointer-events-none absolute bottom-32 left-1/2 z-2 -translate-x-1/2 rounded-lg border border-[#414955] bg-[#191c22] px-3 py-2 text-sm text-[#e8b77e]">
							Click to place {symbolDefinition.name}. Escape cancels.
						</output>
					)}
					{error && (
						<p
							className="absolute top-22 left-10 z-3 m-0 max-h-25 max-w-[min(560px,calc(100%-56px))] overflow-auto rounded-lg border border-[#72543a] bg-[#392e25f5] px-3 py-2.5 text-[13px] text-[#edc49a]"
							role="alert"
						>
							{error}
						</p>
					)}
				</div>
				<SelectionAttributes
					shapes={selected}
					onSymbolAttributeChange={(attribute, value) => {
						commitReplacements(
							selected.map((shape) =>
								shape.kind === "symbol"
									? {
											...shape,
											attributes: { ...shape.attributes, [attribute]: value },
										}
									: shape,
							),
							`Change symbol ${attribute}`,
						);
					}}
					snapStep={snapEnabled ? gridStep : 0}
					onClear={() => applySelection(new Set())}
					textFocusId={textFocusId}
					onTextFocus={() => setTextFocusId(null)}
					onTextChange={(text) => {
						if (selected.length === 1 && selected[0].kind === "text")
							commitReplacements([updateText(selected[0], text)], "Edit text");
					}}
					onAttributeChange={(attribute, value) => {
						if (!Number.isFinite(value)) return;
						const replacements =
							attribute === "x" || attribute === "y"
								? moveShapes(
										selected,
										{
											x: attribute === "x" ? value - selected[0].x : 0,
											y: attribute === "y" ? value - selected[0].y : 0,
										},
										0,
										selected[0],
										currentShapes.current,
									)
								: selected.map((shape) =>
										editShapeAttribute(shape, attribute, value),
									);
						commitReplacements(
							replacements,
							`Change ${attribute === "lineWidth" ? "wire width" : attribute === "fontSize" ? "font size" : attribute}`,
						);
					}}
				/>
			</div>
		</main>
	);
}
