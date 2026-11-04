import {
	Cable,
	Circle,
	Hand,
	History as HistoryIcon,
	Lock,
	LockKeyhole,
	Magnet,
	MapPin,
	Minus,
	MousePointer2,
	RotateCcw,
	RotateCw,
	Shapes,
	Square,
	Trash2,
	Triangle,
	TriangleAlert,
	Type,
	Unlock,
	X,
} from "lucide-react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	createSymbolFromSelectionEffect,
	jumpHistoryEffect,
	redoEffect,
	removeShapesEffect,
	replaceAndPlaceShapesEffect,
	rotateShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore } from "#/commands/drawing-store.ts";
import { CreateSymbolDialog } from "#/components/editor/CreateSymbolDialog.tsx";
import { DrawingExport } from "#/components/editor/DrawingExport.tsx";
import {
	canvasKeyCommand,
	editorShortcut,
} from "#/components/editor/editorKeymap.ts";
import {
	dismissEditorIssues,
	editorIssues,
	retainDismissedIssues,
	visibleEditorMessages,
} from "#/components/editor/editorMessages.ts";
import {
	createEditorSession,
	type DrawingCommand,
} from "#/components/editor/editorSession.ts";
import { McpControls } from "#/components/editor/McpControls.tsx";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import {
	type CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { useDrawingClipboard } from "#/components/editor/useDrawingClipboard.ts";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { ToolbarGroup } from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { rerouteLegacyWires } from "#/drawing/diagonal-wires.ts";
import { isNetLabel } from "#/drawing/named-nets.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import {
	applySelectionEdit,
	type SelectionEdit,
} from "#/drawing/selection-edit.ts";
import {
	canSelectShape,
	canSelectSymbolChild,
	type EditorShape,
	moveShapes,
	moveSymbolChild,
	replaceSymbolChild,
	resizeHandles,
	shapeBounds,
	symbolChildren,
	symbolChildWorld,
	symbolShapes,
	symbolTextShapes,
} from "#/drawing/shapes.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import {
	createSymbolFromShapes,
	type SymbolDefinition,
} from "#/drawing/symbols.ts";
import { formatInches, formatMils, SCHEMATIC_STEP } from "#/drawing/units.ts";
import { defaultSheet, type SheetSize } from "#/drawing/worksheet.ts";
import { worldToScreen } from "#/engine/camera.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { rulerSpacing } from "#/engine/ruler.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { isEditableTarget } from "#/lib/keyboard.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";
import { isProjectError } from "#/projects/errors.ts";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import {
	useProjectActions,
	useProjectEditor,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import { projectIndex } from "#/projects/project-index.ts";
import { useEditorControlsRegistration } from "#/projects/WorkspaceControls.tsx";
import type { SymbolEditTarget } from "#/symbol-library/storage.tsx";
import { OrthographicViewer2D } from "../viewer/OrthographicViewer2D";
import { viewControlButtonClassName } from "../viewer/ViewControls3D";
import { HistoryControls } from "./HistoryControls";
import { SelectionAttributes } from "./SelectionAttributes";
import { SymbolPicker } from "./SymbolPicker";
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
	{ kind: "no-connect", label: "No connect", icon: X },
	{ kind: "net", label: "Net label", icon: Type },
	{ kind: "supply", label: "Supply label", icon: Type },
	{ kind: "text", label: "Text", icon: Type },
] as const;
export interface Editor2DProps {
	sheet?: SheetSize;
	/** Supply a store to run commands from outside the editor as well. */
	store?: ReturnType<typeof createDrawingStore>;
	/** Enable when the host provides the editor MCP endpoints. */
	enableMcp?: boolean;
}

const CircuitEditor = lazy(() =>
	import("#/components/circuit/CircuitEditor.tsx").then((module) => ({
		default: module.CircuitEditor,
	})),
);

const cameraStates = new WeakMap<
	object,
	{ camera?: Viewer2DSnapshot["camera"] }
>();

/** Drawing stores whose legacy diagonal wires were already redrawn. */
const reroutedStores = new WeakSet<object>();

export function Editor2D(props: Editor2DProps = {}) {
	const project = useProjectEditor();
	if (!props.store && project?.editorCircuit)
		return (
			<Suspense
				fallback={<output className="block p-6">Opening circuit...</output>}
			>
				<CircuitEditor
					key={`${project.session}:${project.editorCircuit.file.circuit.id}`}
					document={project.editorCircuit}
				/>
			</Suspense>
		);
	const symbol = props.store ? null : project?.editorSymbol;
	const drawing = props.store ? null : project?.editorDrawing;
	return (
		<EditorCanvas
			key={`${project?.session ?? 0}:${
				symbol
					? `symbol:${symbol.file.id}`
					: drawing
						? `drawing:${drawing.file.id}`
						: "schematic"
			}`}
			{...props}
			store={symbol?.store ?? drawing?.store ?? props.store}
			symbolName={symbol?.file.name}
			drawingName={drawing?.file.name}
			viewSwitch={
				!props.store && !symbol ? (
					<EditorViewSwitch view="schematic" />
				) : undefined
			}
		/>
	);
}

function messageButtonRef(target: { current: HTMLButtonElement | null }) {
	return (button: HTMLButtonElement) => {
		target.current = button;
		return () => {
			if (target.current === button) target.current = null;
			const owner = button.ownerDocument;
			if (owner.activeElement !== button) return;
			const canvas = button.closest("main")?.querySelector("canvas");
			queueMicrotask(() => {
				if (
					!button.isConnected &&
					(!owner.activeElement || owner.activeElement === owner.body)
				)
					canvas?.focus({ preventScroll: true });
			});
		};
	};
}

function EditorCanvas({
	sheet = defaultSheet,
	store: suppliedStore,
	enableMcp = true,
	symbolName,
	drawingName,
	headerControls,
	viewSwitch,
}: Editor2DProps & {
	symbolName?: string;
	drawingName?: string;
	headerControls?: ReactNode;
	viewSwitch?: ReactNode;
}) {
	const isSymbol = symbolName !== undefined;
	const [ownedStore] = useState(() => createDrawingStore());
	const project = useProjectSelection(
		({ store, error, libraryErrors, selectEditorFile }) => ({
			store,
			error,
			libraryErrors,
			selectEditorFile,
		}),
	);
	const store = suppliedStore ?? project?.store ?? ownedStore;
	let cameraState = cameraStates.get(store);
	if (!cameraState) {
		cameraState = {};
		cameraStates.set(store, cameraState);
	}
	const registerEditor = useEditorControlsRegistration();
	useEffect(
		() => registerEditor?.(store, enableMcp),
		[registerEditor, store, enableMcp],
	);
	const drawing = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const history = drawing.history;
	const symbolLibrary = useSymbolLibrary();
	const { definitions, byReference } = symbolLibrary;
	const resolveShapes = useCallback(
		(shapes: EditorShape[]) =>
			resolveDrawingSymbols(shapes, definitions, byReference).shapes,
		[definitions, byReference],
	);
	const resolved = useMemo(
		() => resolveDrawingSymbols(drawing.shapes, definitions, byReference),
		[drawing.shapes, definitions, byReference],
	);
	const [session] = useState(() => createEditorSession(store, resolveShapes));
	useLayoutEffect(
		() =>
			session.setResolver(resolveShapes, {
				input: drawing.shapes,
				output: resolved.shapes,
			}),
		[session, resolveShapes, drawing.shapes, resolved.shapes],
	);
	const editor = useSyncExternalStore(
		session.subscribe,
		session.getState,
		session.getState,
	);
	const {
		selection: selectedIds,
		childKey: selectedChildKey,
		error: commandError,
		allowLocked,
	} = editor;
	const shapes = editor.draft ?? resolved.shapes;
	const [tool, setTool] = useState<Tool>("select");
	const [symbolDefinition, setSymbolDefinition] =
		useState<SymbolDefinition | null>(null);
	const [textFocusId, setTextFocusId] = useState<number | null>(null);
	const [creatingSymbol, setCreatingSymbol] = useState(false);
	const [editTarget, setEditTarget] = useState<SymbolEditTarget | null>(null);
	const [editingDefinition, setEditingDefinition] =
		useState<SymbolEditTarget | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(true);
	const [ready, setReady] = useState(false);
	const [viewerError, setViewerError] = useState("");
	// Shown while the drawing is at the redraw's history entry.
	const [rerouteNotice, setRerouteNotice] = useState<{
		text: string;
		historyId: number;
	} | null>(null);
	const issues = editorIssues([
		viewerError,
		rerouteNotice?.historyId === drawing.history.currentId
			? rerouteNotice.text
			: "",
		...(symbolLibrary.loading ? [] : resolved.errors),
		project?.error,
		...(project?.libraryErrors ?? []),
	]);
	const [dismissedIssues, setDismissedIssues] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	if (!symbolLibrary.loading) {
		const retained = retainDismissedIssues(dismissedIssues, issues);
		if (retained !== dismissedIssues) setDismissedIssues(retained);
	}
	const hiddenIssues = issues.filter((issue) => dismissedIssues.has(issue));
	const messages = visibleEditorMessages(commandError, issues, dismissedIssues);
	const dismissMessages = () => {
		session.setError("");
		setDismissedIssues((dismissed) => dismissEditorIssues(dismissed, issues));
	};
	const dismissButton = useRef<HTMLButtonElement>(null);
	const issuesButton = useRef<HTMLButtonElement>(null);
	const [dismissButtonRef] = useState(() => messageButtonRef(dismissButton));
	const [issuesButtonRef] = useState(() => messageButtonRef(issuesButton));
	const pendingFocus = useRef<"issues" | "messages" | null>(null);
	useEffect(() => {
		const target = pendingFocus.current;
		if (!target) return;
		pendingFocus.current = null;
		(target === "issues" ? issuesButton : dismissButton).current?.focus({
			preventScroll: true,
		});
	});
	const snapshot = useRef<Viewer2DSnapshot | null>(null);
	const [view, setView] = useState<Viewer2DSnapshot | null>(null);
	const selected = shapes.filter(
		(shape) => selectedIds.has(shape.id) && canSelectShape(shape, allowLocked),
	);
	const textAnchors = [
		...shapes.filter(isNetLabel),
		...selected.filter((shape) => !isNetLabel(shape)),
	].flatMap((shape) => {
		if (shape.kind === "text")
			return [{ key: `${shape.id}`, x: shape.x, y: shape.y }];
		if (shape.kind !== "symbol") return [];
		return [
			...symbolTextShapes(shape).map((text) => ({
				key: `${shape.id}:label:${text.id}`,
				x: text.x,
				y: text.y,
			})),
			...symbolShapes(shape)
				.filter((child) => child.kind === "text")
				.map((text) => ({
					key: `${shape.id}:text:${text.id}`,
					x: text.x,
					y: text.y,
				})),
		];
	});
	const selectedSymbol =
		selected.length === 1 && selected[0].kind === "symbol"
			? selected[0]
			: undefined;
	const selectedChild =
		selectedSymbol && selectedChildKey
			? symbolChildren(selectedSymbol).find(
					(child) =>
						child.key === selectedChildKey &&
						canSelectSymbolChild(selectedSymbol, child, allowLocked),
				)
			: undefined;

	const selectionLocked = selectedChild
		? selectedChild.shape.locked === true
		: selected.length > 0 && selected.every((shape) => shape.locked === true);

	const symbolPath = useProjectSelection(({ project }) => {
		if (!project || !selectedSymbol) return undefined;
		if (
			selectedSymbol.library &&
			(selectedSymbol.library.scope !== "project" ||
				selectedSymbol.library.id !== "project-symbols")
		)
			return undefined;
		return projectIndex(project).symbolsById.get(selectedSymbol.definitionId)
			?.path;
	});

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
						session.setError(
							errorMessage(cause, "Unable to open the symbol definition."),
						);
				},
			);
		}
		return () => {
			active = false;
		};
	}, [session, definitionId, definitionLibrary, symbolLibrary.loading]);
	const gridStep = view ? rulerSpacing(view.camera.scale, "mil").minor : 0;
	const selectionSnapStep = snapEnabled
		? selected.length > 0 &&
			selected.every((shape) => shape.kind === "text" && !isNetLabel(shape))
			? gridStep / 10
			: gridStep
		: 0;
	const handles =
		tool === "select"
			? selectedSymbol && selectedChild
				? resizeHandles(
						symbolChildWorld(selectedSymbol, selectedChild.shape),
					).map((handle) => ({
						shape: selectedSymbol,
						handle,
						childKey: selectedChild.key,
					}))
				: selected.flatMap((shape) =>
						resizeHandles(shape).map((handle) => ({
							shape,
							handle,
							childKey: undefined,
						})),
					)
			: [];
	const {
		getDrag,
		getWire,
		marquee,
		movingShapeId,
		placementGuide,
		wirePreview,
		symbolPreview,
		setSymbolPreview,
		setPlacementGuide,
		connectionHover,
		finishDrag,
		finishWire,
		pointerHandlers,
	} = useCanvasGestures({
		session,
		snapshot,
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
	});
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
	const movingShape = shapes.find((shape) => shape.id === movingShapeId);
	const guideShape = movingShape ?? (tool === "symbol" ? symbolPreview : null);
	const guideBounds = guideShape ? shapeBounds(guideShape) : null;
	const guideCenter = guideBounds
		? {
				x: (guideBounds.minX + guideBounds.maxX) / 2,
				y: (guideBounds.minY + guideBounds.maxY) / 2,
			}
		: placementGuide?.tool === tool
			? placementGuide.center
			: null;
	const rulerPosition =
		guideCenter && view
			? worldToScreen(
					guideCenter,
					view.camera,
					view.viewport.width,
					view.viewport.height,
				)
			: null;

	const editSelection = (edit: SelectionEdit) => {
		const result = applySelectionEdit(edit, {
			selection: selected,
			child:
				selectedSymbol && selectedChild
					? { symbol: selectedSymbol, child: selectedChild }
					: undefined,
			shapes: session.shapes(),
			nextId: session.nextId(),
			allowLocked,
			measureText,
		});
		if (result) session.replace(result.replacements, result.label);
		if (edit.kind === "lock" && selectedChild) session.selectChild(null);
	};

	const restoreHistory = (program: DrawingCommand<unknown>) => {
		finishDrag(true);
		finishWire();
		if (tool === "symbol") setTool("select");
		session.restore(program);
	};
	const undo = () => restoreHistory(undoEffect);
	const redo = () => restoreHistory(redoEffect);
	const rotateSelected = (angle: number) => {
		if (!ready || !session.getState().selection.size) return;
		const active = getDrag();
		const childKey = active ? active.previousChild : selectedChildKey;
		finishDrag(true);
		finishWire();
		setTool("select");
		// Cancelling a drag can restore the selection from before it started.
		const { selection } = session.getState();
		const parent = session.shapes().find((shape) => selection.has(shape.id));
		if (childKey && parent?.kind === "symbol") {
			const child = symbolChildren(parent).find(
				(item) => item.key === childKey,
			);
			if (child)
				session.replace(
					[
						replaceSymbolChild(parent, childKey, {
							...child.shape,
							rotation: child.shape.rotation + angle,
						}),
					],
					"Rotate symbol child",
				);
			return;
		}

		session.commit(rotateShapesEffect([...selection], angle));
	};
	const removeSelected = () => {
		finishDrag();
		if (getWire()) {
			finishWire();
			setTool("select");
		}
		session.commit(
			removeShapesEffect([...session.getState().selection]),
			new Set(),
		);
	};
	const createSelectionSymbol = async (
		name: string,
	): Promise<string | undefined> => {
		finishDrag();
		finishWire();
		const originalDrawing = session.drawing();
		const previousHistoryId = originalDrawing.history.currentId;
		const { selection } = session.getState();
		const ids = [...selection];
		const primitives = originalDrawing.shapes
			.filter((shape) => selection.has(shape.id))
			.filter((shape) => shape.kind !== "symbol");
		if (primitives.length !== ids.length || ids.length < 2)
			return "Select at least two drawing shapes to create a symbol.";
		try {
			const options: Parameters<typeof createSymbolFromShapes>[2] = {
				name,
				definitionId: `custom.${crypto.randomUUID()}`,
			};
			const draft = createSymbolFromShapes(
				session.nextId(),
				primitives,
				options,
			);
			const saveSymbol = symbolLibrary.prepareAddition(
				symbolFileFromSymbol(draft),
			);
			const library = await saveSymbol();
			options.library = library;
			if (session.drawing() !== originalDrawing)
				return "The drawing changed while saving. The symbol is in your library; select the shapes and try again.";
			const result = session.commit(
				createSymbolFromSelectionEffect(ids, options),
			);
			if (!result) return "Unable to create a symbol from this selection.";
			session.rememberSelection(previousHistoryId, ids);
			setTool("select");
			setCreatingSymbol(false);
		} catch (cause) {
			return errorMessage(cause, "Unable to save this symbol.");
		}
	};

	// Another caller changed the document. A stale gesture must not overwrite it.
	const cancelGestures = useEffectEvent(() => {
		finishDrag(true);
		finishWire();
	});
	useEffect(() => session.connect(store, cancelGestures), [session, store]);

	useEffect(() => {
		if (
			isSymbol ||
			!symbolLibrary.ready ||
			resolved.errors.length ||
			reroutedStores.has(store)
		)
			return;
		reroutedStores.add(store);
		const reroute = rerouteLegacyWires(resolved.shapes);
		if (
			reroute &&
			session.execute(
				replaceAndPlaceShapesEffect(
					reroute.replacements,
					reroute.additions,
					"Redraw diagonal wires",
				),
			)
		)
			setRerouteNotice({
				text: reroute.notice,
				historyId: store.getSnapshot().history.currentId,
			});
	});

	const renderTool = ({ kind, label, icon: Icon }: (typeof tools)[number]) => (
		<TooltipButton
			key={kind}
			type="button"
			className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
			disabled={!ready}
			aria-label={label}
			tooltip={label}
			aria-pressed={tool === kind}
			onClick={() => {
				finishWire();
				setPlacementGuide(null);
				setTool(kind);
			}}
		>
			<Icon size={18} aria-hidden="true" />
		</TooltipButton>
	);
	const clipboard = useDrawingClipboard({
		session,
		enabled: () => ready && !creatingSymbol && !getDrag() && !getWire(),
		target: isSymbol ? "symbol" : "drawing",
		pasteStep: snapEnabled ? gridStep || SCHEMATIC_STEP : SCHEMATIC_STEP,
		beforePaste: () => {
			finishWire();
			setTool("select");
			setSymbolPreview(null);
		},
	});

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
			{...clipboard}
			onKeyDownCapture={(event) => {
				const shortcut = editorShortcut(event, {
					dialogOpen: creatingSymbol,
					placingSymbol: tool === "symbol",
					editable: isEditableTarget(event),
					canRotate: ready && session.getState().selection.size > 0,
				});
				if (!shortcut) return;
				if (shortcut.kind === "cancel-placement") {
					setSymbolPreview(null);
					setTool("select");
				} else if (shortcut.kind === "rotate") rotateSelected(shortcut.angle);
				else if (shortcut.kind === "undo") undo();
				else redo();
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<h1 className="sr-only">
				{isSymbol
					? `Symbol editor · ${symbolName}`
					: `Schematic editor · ${drawingName ? `${drawingName} · ` : ""}${sheet.name ? `${sheet.name} · ` : ""}${formatInches(sheet.width)} × ${formatInches(sheet.height)} in`}
			</h1>
			{(headerControls || !registerEditor) && (
				<header className="absolute top-10 left-10 z-4 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-2 max-[600px]:top-9 max-[600px]:left-9 max-[600px]:max-w-[calc(100%-4.5rem)]">
					{headerControls ?? (
						<>
							<ProjectLink
								href="/gerber"
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
								href="/"
								className="inline-flex min-h-10 items-center rounded-lg border border-white/20 bg-slate-900 px-3 text-sm text-white/90 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-white"
							>
								Workspace
							</ProjectLink>
							{enableMcp && <McpControls store={store} />}
						</>
					)}
				</header>
			)}
			<div className="relative flex min-h-0 flex-1">
				<div
					className={`relative min-w-0 flex-1 touch-none ${tool === "pan" ? "[&_canvas]:cursor-grab" : tool === "select" ? "" : "[&_canvas]:cursor-crosshair"}`}
					style={{
						backgroundColor: isSymbol
							? darkSchematicTheme.paper
							: darkSchematicTheme.desk,
					}}
					data-tool={tool}
					{...pointerHandlers}
					onKeyDownCapture={(event) => {
						if (!(event.target instanceof HTMLCanvasElement)) return;
						const command = canvasKeyCommand(event, {
							wiring: !!getWire(),
							dragging: !!getDrag(),
							hasSelection: selected.length > 0,
							childSelected: selectedChild !== undefined,
							childStep: snapEnabled
								? gridStep / (selectedChild?.shape.kind === "text" ? 10 : 1)
								: SCHEMATIC_STEP,
							selectionStep: selectionSnapStep || SCHEMATIC_STEP,
						});
						if (!command) return;
						switch (command.kind) {
							case "end-wire":
								finishWire();
								setTool("select");
								break;
							case "cancel-drag":
								finishDrag(true);
								break;
							case "deselect-child":
								session.selectChild(null);
								break;
							case "deselect":
								session.select(new Set());
								break;
							case "delete":
								finishDrag();
								removeSelected();
								break;
							case "move-child":
								if (selectedSymbol && selectedChild)
									session.replace(
										[
											moveSymbolChild(
												selectedSymbol,
												selectedChild.key,
												command.delta,
												0,
												allowLocked,
											),
										],
										"Move symbol child",
									);
								break;
							case "move-selection":
								if (command.endWire) {
									finishWire();
									setTool("select");
								}
								session.replace(
									moveShapes(
										selected,
										command.delta,
										selectionSnapStep,
										selected[0],
										session.shapes(),
										session.nextId(),
										allowLocked,
									),
									"Move selection",
								);
								break;
						}
						event.preventDefault();
						event.stopPropagation();
					}}
				>
					{scene && (
						<OrthographicViewer2D
							rulerUnit="mil"
							scene={scene}
							cameraState={cameraState}
							fitZoom={1.1}
							physicalSizeZoom
							getFitBounds={() => {
								const targets =
									selectedSymbol && selectedChild
										? [symbolChildWorld(selectedSymbol, selectedChild.shape)]
										: selected;
								if (!targets.length) return null;
								const bounds = targets.map(shapeBounds);
								return {
									minX: Math.min(...bounds.map((box) => box.minX)),
									minY: Math.min(...bounds.map((box) => box.minY)),
									maxX: Math.max(...bounds.map((box) => box.maxX)),
									maxY: Math.max(...bounds.map((box) => box.maxY)),
								};
							}}
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
							onReady={(value) => {
								setReady(value);
								if (value) setViewerError("");
							}}
							onError={setViewerError}
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
									<DrawingExport
										shapes={shapes}
										sheet={sheet}
										label={drawingName || "Schematic drawing"}
										disabled={!ready}
									/>
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
										active={[
											"wire",
											"pin",
											"no-connect",
											"net",
											"supply",
										].includes(tool)}
									>
										{tools
											.filter(
												({ kind }) =>
													[
														"wire",
														"pin",
														"no-connect",
														"net",
														"supply",
													].includes(kind) &&
													(!isSymbol || (kind !== "net" && kind !== "supply")),
											)
											.map(renderTool)}
									</ToolbarGroup>
									<SymbolPicker
										library={symbolLibrary}
										allowNetSymbols={!isSymbol}
										disabled={!ready}
										active={tool === "symbol"}
										onChoose={(definition) => {
											if (isSymbol && definition.netSymbol) return;
											finishDrag();
											finishWire();
											setSymbolDefinition(definition);
											setTool("symbol");
										}}
									/>
									<TooltipButton
										type="button"
										className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
										disabled={!ready}
										aria-label="Snap to grid"
										aria-pressed={snapEnabled}
										tooltip={`Snap to grid, ${formatMils(gridStep)}`}
										onClick={() => setSnapEnabled((enabled) => !enabled)}
									>
										<Magnet size={18} aria-hidden="true" />
									</TooltipButton>
									<TooltipButton
										type="button"
										aria-label="Select locked items"
										aria-pressed={allowLocked}
										tooltip="Select locked items"
										disabled={!ready}
										className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
										onClick={() => {
											finishDrag(true);
											session.setAllowLocked(!allowLocked);
										}}
									>
										<LockKeyhole size={18} aria-hidden="true" />
									</TooltipButton>

									{[
										{
											label: "Rotate counterclockwise",
											shortcut: "R",
											angle: Math.PI / 2,
											icon: RotateCcw,
										},
										{
											label: "Rotate clockwise",
											shortcut: "Shift+R",
											angle: -Math.PI / 2,
											icon: RotateCw,
										},
									].map(({ label, shortcut, angle, icon: Icon }) => (
										<TooltipButton
											key={label}
											type="button"
											className={viewControlButtonClassName}
											disabled={!ready || !selected.length}
											aria-label={label}
											aria-keyshortcuts={shortcut}
											tooltip={`${label} 90°`}
											shortcut={shortcut}
											onClick={() => rotateSelected(angle)}
										>
											<Icon size={18} aria-hidden="true" />
										</TooltipButton>
									))}
									<TooltipButton
										type="button"
										className={viewControlButtonClassName}
										disabled={!ready || !selected.length}
										aria-label={
											selectionLocked ? "Unlock selection" : "Lock selection"
										}
										tooltip={
											selectionLocked ? "Unlock selection" : "Lock selection"
										}
										onClick={() =>
											editSelection({ kind: "lock", locked: !selectionLocked })
										}
									>
										{selectionLocked ? (
											<Unlock size={18} aria-hidden="true" />
										) : (
											<Lock size={18} aria-hidden="true" />
										)}
									</TooltipButton>

									<TooltipButton
										type="button"
										className={viewControlButtonClassName}
										disabled={!selected.length}
										aria-label="Delete"
										tooltip="Delete selected shapes"
										shortcut="Delete"
										onClick={removeSelected}
									>
										<Trash2 size={18} aria-hidden="true" />
									</TooltipButton>
									{viewSwitch}
								</fieldset>
							}
							ariaLabel={isSymbol ? "Symbol editor" : "Schematic editor"}
							interactionHint="Open Shapes for rectangles, circles, triangles, lines and text. Open Connections for wires, pins, no-connect markers, net labels and supply labels. Choose No connect and click a pin to mark it with an X. Matching label names connect across the drawing. The cross marks the electrical anchor. Edit the net name in Attributes. Open History tools for undo and redo, or View tools for PNG export. Zoom and fit controls are in the main toolbar. Choose Symbols in the toolbar, pick a symbol, then click to place it. Escape cancels placement. Drag any item on an unselected symbol to move the whole symbol. Select a symbol first, then drag a child to customize it. Select a child on the canvas to edit its position, size or content in Attributes relative to the symbol center. Locked items cannot be selected or moved. Select locked items allows selecting and moving locked symbols and standalone items while keeping locked symbol children unselectable. Press R to rotate selected components 90 degrees counterclockwise, or Shift + R clockwise. The rotation buttons do the same. Delete removes the whole selected symbol. Hold Alt and drag a symbol, net label, supply label or text to duplicate it. Dragging a symbol label duplicates the whole symbol. Release to place the copy or press Escape to cancel. Drag to draw rectangles, triangles, circles and lines. Lines use two endpoints at any angle and stay independent of wire connections. Rectangles and triangles use two opposite corners; circles use a center and radius. Release to finish or press Escape to cancel. For text, choose Text and click to place it, then type in the Attributes panel. Double-click text to edit it again. Text handles resize proportionally. Click an unconnected pin to start a wire. Shift-click selects the pin instead. With the Wire tool, start at any pin or an open wire endpoint, then click to place each corner. Click another pin or open wire endpoint to connect and finish. Choose Pin and click to place a pin with a 100 mil lead. Edit its name, number, lead length and angle in Attributes. Labels follow the lead, and wires connect to the exposed terminal. Each click places a horizontal or vertical segment. Press Escape or Enter to end the chain and keep placed segments. Moving a symbol or pin keeps existing wires in place and adds horizontal or vertical segments from each original connection to the moved pin. Diagonal moves add a right-angle bend. Moving a segment also moves attached endpoints and keeps neighboring segments horizontal or vertical. When you finish an edit, zero-length segments are removed and touching or overlapping segments on the same straight line merge. Segments meeting at corners remain separate objects. Drag selected shapes' handles to resize; circle handles change the radius; line and wire handles move endpoints. Enable Snap to grid to align placement and resizing with the visible grid; net and supply labels use the visible grid spacing. Ordinary text moves at one-tenth of the visible grid spacing. Arrow keys move by one snapping step, or ten with Shift. Drag empty space to select shapes. Shift + drag adds to the selection. Use the Pan tool or middle-drag to pan; pinch or Ctrl + scroll to zoom. With snapping off, arrow keys move selected shapes by 50 mil, Shift + arrows by 500 mil. Delete removes the selection. Copy with Ctrl or Cmd + C, cut with Ctrl or Cmd + X, and paste with Ctrl or Cmd + V. Each paste offsets the group by one grid step and assigns new component references. Copy and cut act on whole selected items, including a selected symbol child's parent symbol. Undo with Ctrl or Cmd + Z; redo with Ctrl or Cmd + Shift + Z, or Ctrl + Y. Open History to return to any saved edit, including alternate branches. Selection, tools, snapping and navigation do not add history steps. F6 fits the selection, or the drawing when nothing is selected."
						/>
					)}
					{view && (
						<div
							className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
							aria-hidden="true"
						>
							{rulerPosition && (
								<svg
									data-testid="ruler-position-guide"
									aria-hidden="true"
									className="absolute inset-0 size-full stroke-gray-400/60 stroke-1"
								>
									{rulerPosition.y >= 24 &&
										rulerPosition.y <= view.viewport.height && (
											<line
												data-axis="y"
												x1={view.viewport.width - 24}
												y1={rulerPosition.y}
												x2={view.viewport.width}
												y2={rulerPosition.y}
											/>
										)}
									{rulerPosition.x >= 0 &&
										rulerPosition.x < view.viewport.width - 24 && (
											<line
												data-axis="x"
												x1={rulerPosition.x}
												y1={0}
												x2={rulerPosition.x}
												y2={24}
											/>
										)}
								</svg>
							)}
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

							{selectedSymbol &&
								selectedChild &&
								(() => {
									const bounds = shapeBounds(
										symbolChildWorld(selectedSymbol, selectedChild.shape),
									);
									const topLeft = worldToScreen(
										{ x: bounds.minX, y: bounds.maxY },
										view.camera,
										view.viewport.width,
										view.viewport.height,
									);
									const bottomRight = worldToScreen(
										{ x: bounds.maxX, y: bounds.minY },
										view.camera,
										view.viewport.width,
										view.viewport.height,
									);
									return (
										<span
											data-testid="symbol-child-selection"
											className="absolute border border-dashed border-[#e8b77e]"
											style={{
												left: topLeft.x - 3,
												top: topLeft.y - 3,
												width: bottomRight.x - topLeft.x + 6,
												height: bottomRight.y - topLeft.y + 6,
											}}
										/>
									);
								})()}
							{textAnchors.map((anchor) => {
								const point = worldToScreen(
									anchor,
									view.camera,
									view.viewport.width,
									view.viewport.height,
								);
								return (
									<span
										key={anchor.key}
										data-testid="text-anchor"
										data-anchor-id={anchor.key}
										className="pointer-events-none absolute z-1 size-[9px] -translate-x-1/2 -translate-y-1/2 text-[#e8b77e] drop-shadow-[0_0_1px_#19212e] before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-current"
										style={{ left: point.x, top: point.y }}
									/>
								);
							})}
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
					{["wire", "pin", "no-connect", "net", "supply"].includes(tool) && (
						<output className="pointer-events-none absolute bottom-32 left-1/2 z-2 -translate-x-1/2 rounded-lg border border-[#414955] bg-[#191c22] px-3 py-2 text-sm text-[#e8b77e]">
							{tool === "no-connect"
								? "Click a pin to mark it as no connect."
								: tool === "pin"
									? "Click to place a pin."
									: tool === "net" || tool === "supply"
										? "Click to place a label anchor, then edit its net name in Attributes."
										: getWire()
											? "Click for a corner or connect to a pin or open wire end. Enter finishes."
											: "Start at a pin or an open wire end."}
						</output>
					)}
					{tool === "symbol" && symbolDefinition && (
						<output className="pointer-events-none absolute bottom-32 left-1/2 z-2 -translate-x-1/2 rounded-lg border border-[#414955] bg-[#191c22] px-3 py-2 text-sm text-[#e8b77e]">
							Click to place {symbolDefinition.name}. Escape cancels.
						</output>
					)}
					{(messages.length > 0 || hiddenIssues.length > 0) && (
						<div className="pointer-events-none absolute top-22 left-10 z-3 flex max-w-[min(560px,calc(100%-56px))] flex-col items-start gap-2 *:pointer-events-auto">
							{messages.length > 0 && (
								<div className="flex max-w-full items-start gap-1 rounded-lg border border-[#72543a] bg-[#392e25f5] py-1.5 pr-1.5 pl-3 text-[13px] text-[#edc49a]">
									<div
										role="alert"
										className="max-h-25 min-w-0 flex-1 overflow-auto py-1 break-words"
									>
										{messages.map((message) => (
											<p key={message} className="m-0">
												{message}
											</p>
										))}
									</div>
									<button
										ref={dismissButtonRef}
										type="button"
										aria-label="Dismiss editor messages"
										title="Dismiss"
										className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-[#edc49a] hover:bg-[#edc49a1f] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
										onClick={(event) => {
											const canvas = event.currentTarget
												.closest("main")
												?.querySelector("canvas");
											dismissMessages();
											if (issues.length) pendingFocus.current = "issues";
											else canvas?.focus({ preventScroll: true });
										}}
									>
										<X size={15} aria-hidden="true" />
									</button>
								</div>
							)}
							{hiddenIssues.length > 0 && (
								<button
									ref={issuesButtonRef}
									type="button"
									className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#72543a] bg-[#392e25f5] px-2.5 py-1.5 text-[12px] text-[#edc49a] hover:bg-[#4a3b2ff5] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
									onClick={() => {
										pendingFocus.current = "messages";
										setDismissedIssues(new Set());
									}}
								>
									<TriangleAlert size={14} aria-hidden="true" />
									Show {hiddenIssues.length}{" "}
									{hiddenIssues.length === 1 ? "issue" : "issues"}
								</button>
							)}
						</div>
					)}
				</div>
				<SelectionAttributes
					shapes={selectedChild ? [selectedChild.shape] : selected}
					isSymbolChild={selectedChild !== undefined}
					onEdit={editSelection}
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
					allowNetEdits={!isSymbol}
					snapStep={
						selectedChild
							? snapEnabled
								? gridStep / (selectedChild.shape.kind === "text" ? 10 : 1)
								: 0
							: selectionSnapStep
					}
					onClear={() => session.select(new Set())}
					textFocusId={textFocusId}
					onTextFocus={() => setTextFocusId(null)}
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
	const reportUnsavedEdits = useProjectActions()?.reportUnsavedEdits;
	const editorKey = useId();
	useEffect(() => {
		reportUnsavedEdits?.(editorKey, dirty);
	}, [reportUnsavedEdits, editorKey, dirty]);
	useEffect(
		() => () => reportUnsavedEdits?.(editorKey, false),
		[reportUnsavedEdits, editorKey],
	);
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
					if (!isProjectError(cause, "ProjectConflict"))
						setError(
							errorMessage(cause, "Unable to save the symbol definition."),
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
		void save().catch(() => undefined);
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
