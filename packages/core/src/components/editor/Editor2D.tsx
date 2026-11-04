import { TriangleAlert, X } from "lucide-react";
import {
	type ReactNode,
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
	redoEffect,
	removeShapesEffect,
	replaceAndPlaceShapesEffect,
	rotateShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore } from "#/commands/drawing-store.ts";
import { CanvasOverlay } from "#/components/editor/CanvasOverlay.tsx";
import { CreateSymbolDialog } from "#/components/editor/CreateSymbolDialog.tsx";
import { createCanvasView } from "#/components/editor/canvasView.ts";
import {
	EditorToolbar,
	isConnectionTool,
} from "#/components/editor/EditorToolbar.tsx";
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
import { SelectionAttributes } from "#/components/editor/SelectionAttributes.tsx";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import {
	type CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { useDrawingClipboard } from "#/components/editor/useDrawingClipboard.ts";
import { useEditorScene } from "#/components/editor/useEditorScene.ts";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { OrthographicViewer2D } from "#/components/viewer/OrthographicViewer2D.tsx";
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
import { formatInches, SCHEMATIC_STEP } from "#/drawing/units.ts";
import { defaultSheet, type SheetSize } from "#/drawing/worksheet.ts";
import { measureText } from "#/engine/drawing/text.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { isEditableTarget } from "#/lib/keyboard.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { EditorDocument } from "#/projects/EditorDocument.tsx";
import { EditorHeader } from "#/projects/EditorHeader.tsx";
import { isProjectError } from "#/projects/errors.ts";
import { useProject } from "#/projects/ProjectProvider.tsx";
import { useEditorControlsRegistration } from "#/projects/WorkspaceControls.tsx";
import type { SymbolEditTarget } from "#/symbol-library/storage.tsx";

export interface Editor2DProps {
	sheet?: SheetSize;

	store?: ReturnType<typeof createDrawingStore>;

	enableMcp?: boolean;
}

const cameraStates = new WeakMap<
	object,
	{ camera?: Viewer2DSnapshot["camera"] }
>();

const reroutedStores = new WeakSet<object>();

export type EditorCanvasProps = Editor2DProps & {
	symbolName?: string;
	drawingName?: string;
	headerControls?: ReactNode;
	viewSwitch?: ReactNode;
};

export function Editor2D(props: Editor2DProps = {}) {
	return <EditorDocument {...props} Canvas={EditorCanvas} />;
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
}: EditorCanvasProps) {
	const isSymbol = symbolName !== undefined;
	const [ownedStore] = useState(() => createDrawingStore());
	const project = useProject();
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
	const [cameraView] = useState(createCanvasView);
	const gridStep = useSyncExternalStore(
		cameraView.subscribe,
		cameraView.getGridStep,
		cameraView.getGridStep,
	);
	const selected = useMemo(
		() =>
			shapes.filter(
				(shape) =>
					selectedIds.has(shape.id) && canSelectShape(shape, allowLocked),
			),
		[shapes, selectedIds, allowLocked],
	);
	const selectedSymbol =
		selected.length === 1 && selected[0].kind === "symbol"
			? selected[0]
			: undefined;
	const selectedChild = useMemo(
		() =>
			selectedSymbol && selectedChildKey
				? symbolChildren(selectedSymbol).find(
						(child) =>
							child.key === selectedChildKey &&
							canSelectSymbolChild(selectedSymbol, child, allowLocked),
					)
				: undefined,
		[selectedSymbol, selectedChildKey, allowLocked],
	);

	const selectionLocked = selectedChild
		? selectedChild.shape.locked === true
		: selected.length > 0 && selected.every((shape) => shape.locked === true);

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
	const selectionSnapStep = snapEnabled
		? selected.length > 0 &&
			selected.every((shape) => shape.kind === "text" && !isNetLabel(shape))
			? gridStep / 10
			: gridStep
		: 0;
	const handles = useMemo(
		() =>
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
				: [],
		[tool, selectedSymbol, selectedChild, selected],
	);
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
	const editSelection = useCallback(
		(edit: SelectionEdit) => {
			const current = session.getState();
			const shapes = session.shapes();
			const selection = shapes.filter(
				(shape) =>
					current.selection.has(shape.id) &&
					canSelectShape(shape, current.allowLocked),
			);
			const symbol =
				selection.length === 1 && selection[0].kind === "symbol"
					? selection[0]
					: undefined;
			const child =
				symbol && current.childKey
					? symbolChildren(symbol).find(
							(child) =>
								child.key === current.childKey &&
								canSelectSymbolChild(symbol, child, current.allowLocked),
						)
					: undefined;
			const result = applySelectionEdit(edit, {
				selection,
				child: symbol && child ? { symbol, child } : undefined,
				shapes,
				nextId: session.nextId(),
				allowLocked: current.allowLocked,
				measureText,
			});
			if (result) session.replace(result.replacements, result.label);
			if (edit.kind === "lock" && child) session.selectChild(null);
		},
		[session],
	);

	const restoreHistory = useCallback(
		(program: DrawingCommand<unknown>) => {
			finishDrag(true);
			finishWire();
			if (tool === "symbol") setTool("select");
			session.restore(program);
		},
		[finishDrag, finishWire, tool, session],
	);
	const undo = useCallback(() => restoreHistory(undoEffect), [restoreHistory]);
	const redo = useCallback(() => restoreHistory(redoEffect), [restoreHistory]);
	const rotateSelected = useCallback(
		(angle: number) => {
			if (!ready || !session.getState().selection.size) return;
			const active = getDrag();
			const childKey = active ? active.previousChild : selectedChildKey;
			finishDrag(true);
			finishWire();
			setTool("select");

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
		},
		[ready, session, getDrag, selectedChildKey, finishDrag, finishWire],
	);
	const removeSelected = useCallback(() => {
		finishDrag();
		if (getWire()) {
			finishWire();
			setTool("select");
		}
		session.commit(
			removeShapesEffect([...session.getState().selection]),
			new Set(),
		);
	}, [finishDrag, getWire, finishWire, session]);
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

	const hasSelection = selected.length > 0;
	const pickerLibrary = useMemo(
		() => ({ definitions, error: symbolLibrary.error }),
		[definitions, symbolLibrary.error],
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

	const selectionAttributes = useMemo(
		() => (
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
		),
		[
			selectedChild,
			selected,
			editSelection,
			editTarget,
			symbolPath,
			suppliedStore,
			definitionId,
			project,
			isSymbol,
			snapEnabled,
			gridStep,
			selectionSnapStep,
			session,
			textFocusId,
		],
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
			<EditorHeader
				headerControls={headerControls}
				registered={!!registerEditor}
				enableMcp={enableMcp}
				store={store}
			/>
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
							onChange={cameraView.update}
							extraControls={
								<EditorToolbar
									shapes={resolved.shapes}
									sheet={sheet}
									drawingName={drawingName}
									ready={ready}
									history={history}
									undo={undo}
									redo={redo}
									restoreHistory={restoreHistory}
									tool={tool}
									isSymbol={isSymbol}
									symbolLibrary={pickerLibrary}
									finishDrag={finishDrag}
									finishWire={finishWire}
									setSymbolDefinition={setSymbolDefinition}
									setTool={setTool}
									setPlacementGuide={setPlacementGuide}
									snapEnabled={snapEnabled}
									setSnapEnabled={setSnapEnabled}
									gridStep={gridStep}
									allowLocked={allowLocked}
									session={session}
									hasSelection={hasSelection}
									rotateSelected={rotateSelected}
									selectionLocked={selectionLocked}
									editSelection={editSelection}
									removeSelected={removeSelected}
									viewSwitch={viewSwitch}
								/>
							}
							ariaLabel={isSymbol ? "Symbol editor" : "Schematic editor"}
							interactionHint="Open Shapes for rectangles, circles, triangles, lines and text. Open Connections for wires, pins, no-connect markers, net labels and supply labels. Choose No connect and click a pin to mark it with an X. Matching label names connect across the drawing. The cross marks the electrical anchor. Edit the net name in Attributes. Open History tools for undo and redo, or View tools for PNG export. Zoom and fit controls are in the main toolbar. Choose Symbols in the toolbar, pick a symbol, then click to place it. Escape cancels placement. Drag any item on an unselected symbol to move the whole symbol. Select a symbol first, then drag a child to customize it. Select a child on the canvas to edit its position, size or content in Attributes relative to the symbol center. Locked items cannot be selected or moved. Select locked items allows selecting and moving locked symbols and standalone items while keeping locked symbol children unselectable. Press R to rotate selected components 90 degrees counterclockwise, or Shift + R clockwise. The rotation buttons do the same. Delete removes the whole selected symbol. Hold Alt and drag a symbol, net label, supply label or text to duplicate it. Dragging a symbol label duplicates the whole symbol. Release to place the copy or press Escape to cancel. Drag to draw rectangles, triangles, circles and lines. Lines use two endpoints at any angle and stay independent of wire connections. Rectangles and triangles use two opposite corners; circles use a center and radius. Release to finish or press Escape to cancel. For text, choose Text and click to place it, then type in the Attributes panel. Double-click text to edit it again. Text handles resize proportionally. Click an unconnected pin to start a wire. Shift-click selects the pin instead. With the Wire tool, start at any pin or an open wire endpoint, then click to place each corner. Click another pin or open wire endpoint to connect and finish. Choose Pin and click to place a pin with a 100 mil lead. Edit its name, number, lead length and angle in Attributes. Labels follow the lead, and wires connect to the exposed terminal. Each click places a horizontal or vertical segment. Press Escape or Enter to end the chain and keep placed segments. Moving a symbol or pin keeps existing wires in place and adds horizontal or vertical segments from each original connection to the moved pin. Diagonal moves add a right-angle bend. Moving a segment also moves attached endpoints and keeps neighboring segments horizontal or vertical. When you finish an edit, zero-length segments are removed and touching or overlapping segments on the same straight line merge. Segments meeting at corners remain separate objects. Drag selected shapes' handles to resize; circle handles change the radius; line and wire handles move endpoints. Enable Snap to grid to align placement and resizing with the visible grid; net and supply labels use the visible grid spacing. Ordinary text moves at one-tenth of the visible grid spacing. Arrow keys move by one snapping step, or ten with Shift. Drag empty space to select shapes. Shift + drag adds to the selection. Use the Pan tool or middle-drag to pan; pinch or Ctrl + scroll to zoom. With snapping off, arrow keys move selected shapes by 50 mil, Shift + arrows by 500 mil. Delete removes the selection. Copy with Ctrl or Cmd + C, cut with Ctrl or Cmd + X, and paste with Ctrl or Cmd + V. Each paste offsets the group by one grid step and assigns new component references. Copy and cut act on whole selected items, including a selected symbol child's parent symbol. Undo with Ctrl or Cmd + Z; redo with Ctrl or Cmd + Shift + Z, or Ctrl + Y. Open History to return to any saved edit, including alternate branches. Selection, tools, snapping and navigation do not add history steps. F6 fits the selection, or the drawing when nothing is selected."
						/>
					)}
					<CanvasOverlay
						cameraView={cameraView}
						tool={tool}
						shapes={shapes}
						selected={selected}
						selectedSymbol={selectedSymbol}
						selectedChild={selectedChild}
						handles={handles}
						guideCenter={guideCenter}
						connectionHover={connectionHover}
						marquee={marquee}
					/>
					{isConnectionTool(tool) && (
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
				{selectionAttributes}
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
	const reportUnsavedEdits = useProject()?.reportUnsavedEdits;
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
