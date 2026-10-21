import { Effect, Either } from "effect";
import {
	Cable,
	Circle,
	Hand,
	History as HistoryIcon,
	Magnet,
	MapPin,
	Minus,
	MousePointer2,
	Shapes,
	Square,
	Trash2,
	Triangle,
	Type,
} from "lucide-react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type CommandResult,
	createSymbolFromSelectionEffect,
	type InvalidDrawingCommand,
	jumpHistoryEffect,
	placeShapesEffect,
	redoEffect,
	removeShapesEffect,
	replaceShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { CreateSymbolDialog } from "#/components/editor/CreateSymbolDialog.tsx";
import { McpControls } from "#/components/editor/McpControls.tsx";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { ToolbarGroup } from "#/components/viewer/ToolbarGroup.tsx";
import {
	constrainWireEndpoint,
	containsSelection,
	drawShape,
	type EditorShape,
	editShapeAttribute,
	findWireConnection,
	hitShape,
	intersectsSelection,
	moveShapes,
	openPins,
	type ResizeHandle,
	resizeHandles,
	resizeShape,
	routeWire,
	type ShapeKind,
	snapPoint,
} from "#/drawing/shapes.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import {
	createSymbol,
	createSymbolFromShapes,
	duplicateSymbol,
	type SymbolDefinition,
} from "#/drawing/symbols.ts";
import type { Point } from "#/drawing/types.ts";
import { defaultSheet, type SheetSize } from "#/drawing/worksheet.ts";
import { screenToWorld, worldToScreen } from "#/engine/camera.ts";
import { rulerSpacing } from "#/engine/ruler.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import { useProject } from "#/projects/ProjectProvider.tsx";
import type { SymbolEditTarget } from "#/symbol-library/storage.tsx";
import { OrthographicViewer2D } from "../viewer/OrthographicViewer2D";
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
	{ kind: "line", label: "Line", icon: Minus },
	{ kind: "wire", label: "Wire", icon: Cable },
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
	mode: "move" | "duplicate" | "marquee" | "draw" | "resize";
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
export interface Editor2DProps {
	sheet?: SheetSize;
	/** Supply a store to run commands from outside the editor as well. */
	store?: ReturnType<typeof createDrawingStore>;
	/** Enable when the host provides the editor MCP endpoints. */
	enableMcp?: boolean;
}

export function Editor2D(props: Editor2DProps = {}) {
	const project = useProject();
	const symbol = props.store ? null : project?.editorSymbol;
	return (
		<EditorCanvas
			key={symbol ? `symbol:${symbol.file.id}` : "schematic"}
			{...props}
			store={symbol?.store ?? props.store}
			symbolName={symbol?.file.name}
		/>
	);
}

function EditorCanvas({
	sheet = defaultSheet,
	store: suppliedStore,
	enableMcp = true,
	symbolName,
	headerControls,
}: Editor2DProps & { symbolName?: string; headerControls?: ReactNode }) {
	const isSymbol = symbolName !== undefined;
	const [ownedStore] = useState(() => createDrawingStore());
	const project = useProject();
	const store = suppliedStore ?? project?.store ?? ownedStore;
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
	const symbolLibrary = useSymbolLibrary();
	const resolved = useMemo(
		() =>
			resolveDrawingSymbols(
				drawing.shapes,
				symbolLibrary.definitions,
				symbolLibrary.byReference,
			),
		[drawing.shapes, symbolLibrary.definitions, symbolLibrary.byReference],
	);
	const shapes = draftShapes ?? resolved.shapes;
	const currentShapes = {
		get current() {
			return (
				currentDraft.current ??
				(store.getSnapshot().shapes === drawing.shapes
					? resolved.shapes
					: resolveDrawingSymbols(
							store.getSnapshot().shapes,
							symbolLibrary.definitions,
							symbolLibrary.byReference,
						).shapes)
			);
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
	const [creatingSymbol, setCreatingSymbol] = useState(false);
	const [editTarget, setEditTarget] = useState<SymbolEditTarget | null>(null);
	const [editingDefinition, setEditingDefinition] =
		useState<SymbolEditTarget | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(true);
	const [ready, setReady] = useState(false);
	const [commandError, setError] = useState("");
	const error = [
		commandError,
		...(symbolLibrary.loading ? [] : resolved.errors),
	]
		.filter(Boolean)
		.join("\n");
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
	const previews = useMemo(
		() => wirePreview ?? (symbolPreview ? [symbolPreview] : []),
		[wirePreview, symbolPreview],
	);
	const { scene, updateScene } = useEditorScene(
		shapes,
		selectedIds,
		previews,
		isSymbol ? null : sheet,
	);
	const selected = shapes.filter((shape) => selectedIds.has(shape.id));
	const selectedSymbol =
		selected.length === 1 && selected[0].kind === "symbol"
			? selected[0]
			: undefined;
	const symbolIndex =
		selectedSymbol &&
		(!selectedSymbol.library ||
			(selectedSymbol.library.scope === "project" &&
				selectedSymbol.library.id === "project-symbols"))
			? project?.project?.symbols.findIndex(
					(symbol) => symbol.id === selectedSymbol.definitionId,
				)
			: undefined;
	const symbolPath =
		symbolIndex !== undefined && symbolIndex >= 0
			? project?.project?.manifest.symbols[symbolIndex]
			: undefined;
	const definitionId = selectedSymbol?.definitionId;
	const definitionLibrary = selectedSymbol?.library;
	const prepareEdit = useEffectEvent(symbolLibrary.prepareEdit);
	useEffect(() => {
		let active = true;
		setEditTarget(null);
		if (definitionId && !symbolLibrary.loading) {
			void prepareEdit(definitionId, definitionLibrary).then(
				(target) => {
					if (active) setEditTarget(target);
				},
				(cause) => {
					if (active)
						setError(
							cause instanceof Error
								? cause.message
								: "Unable to open the symbol definition.",
						);
				},
			);
		}
		return () => {
			active = false;
		};
	}, [definitionId, definitionLibrary, symbolLibrary.loading]);
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
		if (
			ids.size === currentSelection.current.size &&
			[...ids].every((id) => currentSelection.current.has(id))
		)
			return;
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
	const startWire = (connection: Point, pointerId: number) => {
		wireChain.current = { start: connection, pointerId };
		previewWire(connection);
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
		if (active.wireStart && !active.moved) return;
		if (active.mode === "duplicate") {
			if (!active.moved) return;
			active.valid = true;
		}
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
				(draft.kind === "line"
					? draft.width
					: Math.min(draft.width, draft.height)) *
					scale >=
					3;
			previewReplacements([draft]);
			return;
		}
		if (active.mode === "move" || active.mode === "duplicate") {
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
		} else if (active.wireStart && !active.moved) {
			setPreviewShapes(null);
			applySelection(new Set());
			setTool("wire");
			startWire(active.wireStart, active.pointerId);
		} else if (active.created) {
			const createdIds = new Set(active.originals.map((shape) => shape.id));
			placeShapes(
				currentShapes.current.filter((shape) => createdIds.has(shape.id)),
				active.mode === "duplicate"
					? "Duplicate symbol"
					: `Draw ${active.originals[0].kind}`,
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
	const createSelectionSymbol = async (
		name: string,
	): Promise<string | undefined> => {
		finishDrag();
		finishWire();
		const previousHistoryId = store.getSnapshot().history.currentId;
		const originalDrawing = store.getSnapshot();
		const ids = [...currentSelection.current];
		const primitives = store
			.getSnapshot()
			.shapes.filter((shape) => currentSelection.current.has(shape.id))
			.filter((shape) => shape.kind !== "text" && shape.kind !== "symbol");
		if (primitives.length !== ids.length || ids.length < 2)
			return "Select at least two drawing shapes to create a symbol.";
		try {
			const options: Parameters<typeof createSymbolFromShapes>[2] = {
				name,
				definitionId: `custom.${crypto.randomUUID()}`,
			};
			const draft = createSymbolFromShapes(nextId.current, primitives, options);
			const saveSymbol = symbolLibrary.prepareAddition(
				symbolFileFromSymbol(draft),
			);
			const library = await saveSymbol();
			options.library = library;
			if (store.getSnapshot() !== originalDrawing)
				return "The drawing changed while saving. The symbol is in your library; select the shapes and try again.";
			const result = execute(createSymbolFromSelectionEffect(ids, options));
			if (!result) return "Unable to create a symbol from this selection.";
			historySelection.current.set(previousHistoryId, ids);
			acceptEdit(result, previousHistoryId);
			setTool("select");
			setCreatingSymbol(false);
		} catch (cause) {
			return cause instanceof Error
				? cause.message
				: "Unable to save this symbol.";
		}
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

	const renderTool = ({ kind, label, icon: Icon }: (typeof tools)[number]) => (
		<button
			key={kind}
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
	);

	if (editingDefinition) {
		return (
			<LibrarySymbolEditor
				target={editingDefinition}
				onClose={() => setEditingDefinition(null)}
			/>
		);
	}

	return (
		<main
			className="relative flex h-dvh flex-col overflow-hidden"
			onKeyDownCapture={(event) => {
				if (creatingSymbol) return;
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
				{isSymbol
					? `Symbol editor · ${symbolName}`
					: `Schematic editor · ${sheet.name ? `${sheet.name} · ` : ""}${sheet.width} × ${sheet.height} mm`}
			</h1>
			<header className="absolute top-10 left-10 z-2 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-2 max-[600px]:top-9 max-[600px]:left-9 max-[600px]:max-w-[calc(100%-4.5rem)]">
				{headerControls ?? (
					<>
						<ProjectLink
							href="/"
							className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] no-underline shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] focus-visible:outline-2 focus-visible:outline-amber-200"
						>
							Gerber viewer
						</ProjectLink>
						<ProjectLink
							href="/step"
							className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] no-underline shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] focus-visible:outline-2 focus-visible:outline-amber-200"
						>
							STEP viewer
						</ProjectLink>
						<ProjectLink
							href="/projects"
							className="inline-flex min-h-10 items-center rounded-lg border border-white/20 bg-slate-900 px-3 text-sm text-white/90 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-white"
						>
							Projects
						</ProjectLink>
						{enableMcp && <McpControls store={store} />}
					</>
				)}
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
							tool === "pan"
						)
							return;
						const point = pointAt(event, canvas);
						if (!point) return;
						const duplicate =
							event.altKey && tool === "select"
								? [...shapes]
										.reverse()
										.find(
											(candidate) =>
												candidate.kind === "symbol" &&
												hitShape(
													candidate,
													point,
													6 / (snapshot.current?.camera.scale ?? 1),
												),
										)
								: undefined;
						if (event.altKey && duplicate?.kind !== "symbol") return;
						stop(event);
						canvas.focus({ preventScroll: true });
						const resize = duplicate ? undefined : handleAt(point);
						canvas.style.cursor = resize?.handle.cursor ?? "";
						let shape: EditorShape | undefined;
						const created = tool !== "select";
						const snapStep =
							snapEnabled && snapshot.current
								? rulerSpacing(snapshot.current.camera.scale).minor
								: 0;
						const start = created ? snapPoint(point, snapStep) : point;
						let wireStart: Point | undefined;
						if (tool === "select" && !event.shiftKey && !resize && !duplicate) {
							let connection: ReturnType<typeof openPins>[number] | undefined;
							let distance = 8 / (snapshot.current?.camera.scale ?? 1);
							const candidates = measurePerformance(
								"editor.pin-hit-test",
								() =>
									openPins(currentShapes.current, {
										point,
										tolerance: distance,
									}),
								{ shapes: currentShapes.current.length },
							);
							for (const candidate of candidates) {
								const terminal = candidate.point;
								const next = Math.hypot(
									terminal.x - point.x,
									terminal.y - point.y,
								);
								if (next <= distance) {
									connection = candidate;
									distance = next;
								}
							}
							if (connection) {
								wireStart = connection.point;
								shape = connection.shape;
							}
						}
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
								startWire(connection, event.pointerId);
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
						if (duplicate?.kind === "symbol") {
							shape = duplicateSymbol(duplicate, nextId.current, shapes);
							setPreviewShapes([...currentShapes.current, shape]);
						} else if (created) {
							shape = drawShape(nextId.current, tool, start, start);
							setPreviewShapes([...currentShapes.current, shape]);
						} else if (resize) shape = resize.shape;
						else if (!shape)
							shape = [...shapes]
								.reverse()
								.find((candidate) =>
									hitShape(
										candidate,
										point,
										6 / (snapshot.current?.camera.scale ?? 1),
									),
								);
						if (shape && event.shiftKey && !created && !resize && !duplicate) {
							selectShape(shape.id, true);
							return;
						}
						const originals = shape
							? !created && !resize && !duplicate && selectedIds.has(shape.id)
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
							mode: duplicate
								? "duplicate"
								: created
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
							created: created || !!duplicate,
							valid: false,
							additive: event.shiftKey,
							wireStart,
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
							groupedControls
							gridBounds={
								isSymbol
									? undefined
									: {
											minX: -sheet.width / 2,
											maxX: sheet.width / 2,
											minY: -sheet.height / 2,
											maxY: sheet.height / 2,
										}
							}
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
									<ToolbarGroup
										label="History tools"
										icon={HistoryIcon}
										disabled={!ready}
									>
										<HistoryControls
											history={history}
											disabled={!ready}
											onUndo={undo}
											onRedo={redo}
											onRestore={(id) => restoreHistory(jumpHistoryEffect(id))}
										/>
									</ToolbarGroup>
									{tools
										.filter(({ kind }) => kind === "select" || kind === "pan")
										.map(renderTool)}
									<ToolbarGroup
										label="Shapes"
										icon={Shapes}
										disabled={!ready}
										active={[
											"rectangle",
											"circle",
											"triangle",
											"line",
											"text",
										].includes(tool)}
									>
										{tools
											.filter(({ kind }) => !isSymbol || kind !== "text")
											.filter(({ kind }) =>
												[
													"rectangle",
													"circle",
													"triangle",
													"line",
													"text",
												].includes(kind),
											)
											.map(renderTool)}
									</ToolbarGroup>
									<ToolbarGroup
										label="Connections"
										icon={Cable}
										disabled={!ready}
										active={tool === "wire" || tool === "pin"}
									>
										{tools
											.filter(({ kind }) => kind === "wire" || kind === "pin")
											.map(renderTool)}
									</ToolbarGroup>
									<SymbolPicker
										library={symbolLibrary}
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
							ariaLabel={isSymbol ? "Symbol editor" : "Schematic editor"}
							interactionHint="Open Shapes for rectangles, circles, triangles, lines and text. Open Connections for wires and pins, History tools for undo and redo, or View tools for PNG export. Zoom and fit controls are in the main toolbar. Choose Symbols in the toolbar, pick a symbol, then click to place it. Escape cancels placement. Select any part of a symbol to move or delete it as one object; edit its name, reference and value in Attributes. Hold Alt and drag a symbol to duplicate it. Release to place the copy or press Escape to cancel. Drag to draw rectangles, triangles, circles and lines. Lines use two endpoints at any angle and stay independent of wire connections. Rectangles and triangles use two opposite corners; circles use a center and radius. Release to finish or press Escape to cancel. For text, choose Text and click to place it, then type in the Attributes panel. Double-click text to edit it again. Text handles resize proportionally. Click an unconnected pin to start a wire. Shift-click selects the pin instead. With the Wire tool, start at any pin or an open wire endpoint, then click to place each corner. Click another pin or open wire endpoint to connect and finish. Choose Pin and click to place a single connection point. Each click places a horizontal or vertical segment. Press Escape or Enter to end the chain and keep placed segments. Moving a segment also moves attached endpoints and keeps neighboring segments horizontal or vertical. When you finish an edit, zero-length segments are removed and touching or overlapping segments on the same straight line merge. Segments meeting at corners remain separate objects. Drag selected shapes' handles to resize; circle handles change the radius; line and wire handles move endpoints. Enable Snap to grid to align placement and resizing with the visible grid; arrow keys then move by one grid step, or ten with Shift. Drag empty space to select shapes. Shift + drag adds to the selection. Use the Pan tool or middle-drag to pan; pinch or Ctrl + scroll to zoom. With snapping off, arrow keys move selected shapes by 1 mm, Shift + arrows by 10 mm. Delete removes the selection. Undo with Ctrl or Cmd + Z; redo with Ctrl or Cmd + Shift + Z, or Ctrl + Y. Open History to return to any saved edit, including alternate branches. Selection, tools, snapping and navigation do not add history steps. F6 fits the drawing."
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
							className={`pointer-events-none absolute z-2 border ${
								marquee.mode === "window"
									? "border-[#60a5fa] bg-[#60a5fa25]"
									: "border-dashed border-[#4ade80] bg-[#4ade8025]"
							}`}
							data-testid="selection-rectangle"
							data-selection-mode={marquee.mode}
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
					{(error || project?.error) && (
						<p
							className="absolute top-22 left-10 z-3 m-0 max-h-25 max-w-[min(560px,calc(100%-56px))] overflow-auto rounded-lg border border-[#72543a] bg-[#392e25f5] px-3 py-2.5 text-[13px] text-[#edc49a]"
							role="alert"
						>
							{error || project?.error}
						</p>
					)}
				</div>
				<SelectionAttributes
					shapes={selected}
					onEditSymbol={
						editTarget
							? () => {
									if (
										symbolPath &&
										!suppliedStore &&
										editTarget.key === `project:project-symbols:${definitionId}`
									)
										project?.selectEditorFile(symbolPath);
									else setEditingDefinition(editTarget);
								}
							: undefined
					}
					onCreateSymbol={isSymbol ? undefined : () => setCreatingSymbol(true)}
					onPinNameChange={(name) => {
						if (selected.length === 1 && selected[0].kind === "pin")
							commitReplacements([{ ...selected[0], name }], "Change pin name");
					}}
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
							`Change ${attribute === "lineWidth" ? "line width" : attribute === "fontSize" ? "font size" : attribute}`,
						);
					}}
				/>
			</div>
			{creatingSymbol && (
				<CreateSymbolDialog
					onClose={() => setCreatingSymbol(false)}
					onCreate={createSelectionSymbol}
				/>
			)}
		</main>
	);
}

function LibrarySymbolEditor({
	target,
	onClose,
}: {
	target: SymbolEditTarget;
	onClose: () => void;
}) {
	const [store] = useState(() =>
		measurePerformance(
			"editor.open-library-symbol",
			() => createDrawingStore(symbolFileShapes(target.file)),
			{ shapes: target.file.shapes.length },
		),
	);
	const drawing = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const saved = useRef(drawing.shapes);
	const [savedShapes, setSavedShapes] = useState(drawing.shapes);
	const pending = useRef<Promise<void> | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const dirty = drawing.shapes !== savedShapes;
	const save = useCallback(
		async function persist(): Promise<void> {
			while (pending.current) await pending.current;
			const shapes = store.getSnapshot().shapes;
			if (shapes === saved.current) return;
			setSaving(true);
			const work = Promise.resolve().then(async () => {
				try {
					await target.save(
						parseSymbolFile(
							JSON.stringify(symbolFileWithShapes(target.file, shapes)),
						),
					);
					saved.current = shapes;
					setSavedShapes(shapes);
					setError("");
				} catch (cause) {
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to save the symbol definition.",
					);
					throw cause;
				} finally {
					pending.current = null;
					setSaving(false);
				}
			});
			pending.current = work;
			await work;
			if (store.getSnapshot().shapes !== saved.current) await persist();
		},
		[store, target],
	);
	useEffect(() => {
		if (drawing.shapes === saved.current) return;
		const timer = setTimeout(() => void save().catch(() => undefined), 400);
		return () => clearTimeout(timer);
	}, [drawing.shapes, save]);
	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
	const buttonClass =
		"cursor-pointer rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm text-white/90 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-50";
	return (
		<EditorCanvas
			store={store}
			symbolName={target.file.name}
			enableMcp={false}
			headerControls={
				<>
					<button
						type="button"
						className={buttonClass}
						disabled={saving}
						onClick={() =>
							void save()
								.then(onClose)
								.catch(() => undefined)
						}
					>
						Back to schematic
					</button>
					<button
						type="button"
						className={buttonClass}
						disabled={saving || !dirty}
						onClick={() => void save().catch(() => undefined)}
					>
						Save symbol
					</button>
					<output className="text-xs text-[#9ba7b8]">
						{saving ? "Saving..." : dirty ? "Unsaved changes" : "Saved"}
					</output>
					{error && (
						<p
							role="alert"
							className="max-w-md rounded bg-slate-900 p-2 text-sm text-[#edc49a]"
						>
							{error}
						</p>
					)}
				</>
			}
		/>
	);
}
