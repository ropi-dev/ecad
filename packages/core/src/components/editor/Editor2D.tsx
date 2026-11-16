import {
	setPagesEffect,
	setSheetEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	drawingPages,
	resolvePage,
	shapesOnPage,
} from "@ecad/drawing-core/drawing/pages.ts";
import {
	type EditorShape,
	shapeBounds,
	symbolTextMoved,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type SheetSettings,
	sheetPaper,
} from "@ecad/drawing-core/drawing/sheet.ts";
import {
	formatInches,
	SCHEMATIC_STEP,
} from "@ecad/drawing-core/drawing/units.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	footprintFitBounds,
	footprintLayerView,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { ArrowLeft, CircuitBoard, Component, Cpu, Grid2x2 } from "lucide-react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { announceBoardSync } from "#/board/sync-document.ts";
import { boardDisplay, boardLayerView } from "#/board/view.ts";
import {
	BoardChecksPanel,
	BoardSetupPanel,
	BoardStatus,
} from "#/components/board/BoardPanels.tsx";
import { useBoardEditor } from "#/components/board/useBoardEditor.ts";
import { CanvasOverlay } from "#/components/editor/CanvasOverlay.tsx";
import { CreateSymbolDialog } from "#/components/editor/CreateSymbolDialog.tsx";
import { CursorReadout } from "#/components/editor/CursorReadout.tsx";
import {
	EditorMessages,
	useEditorMessages,
} from "#/components/editor/EditorMessages.tsx";
import { EditorToolbar } from "#/components/editor/EditorToolbar.tsx";
import {
	editorInteractionHint,
	footprintInteractionHint,
} from "#/components/editor/editorInteractionHint.ts";
import {
	handleCanvasKeyDown,
	handleEditorShortcut,
} from "#/components/editor/editorKeyHandlers.ts";
import { editorIssues } from "#/components/editor/editorMessages.ts";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { PageBar, type PageEdit } from "#/components/editor/PageBar.tsx";
import { SchematicSettingsDialog } from "#/components/editor/SchematicSettingsDialog.tsx";
import { SelectionAttributes } from "#/components/editor/SelectionAttributes.tsx";
import { SymbolAttributesButton } from "#/components/editor/SymbolAttributesDialog.tsx";
import type { FootprintChoices } from "#/components/editor/SymbolFootprintField.tsx";
import { fitTextShapes } from "#/components/editor/text.ts";
import {
	type CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { useDrawingClipboard } from "#/components/editor/useDrawingClipboard.ts";
import { useDrawingSelectionSync } from "#/components/editor/useDrawingSelectionSync.ts";
import { useEditorCommands } from "#/components/editor/useEditorCommands.ts";
import { useEditorScene } from "#/components/editor/useEditorScene.ts";
import {
	selectionFitBounds,
	useEditorSelection,
} from "#/components/editor/useEditorSelection.ts";
import { useEditorViewport } from "#/components/editor/useEditorViewport.ts";
import { useLegacyWireReroute } from "#/components/editor/useLegacyWireReroute.ts";
import { useLibrarySymbolSave } from "#/components/editor/useLibrarySymbolSave.ts";
import { useSymbolDefinitionEditing } from "#/components/editor/useSymbolDefinitionEditing.ts";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { FootprintBoardView } from "#/components/footprint/FootprintBoardView.tsx";
import {
	FootprintLayerPanel,
	useFootprintLayers,
} from "#/components/footprint/FootprintLayerPanel.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import { downloadPng } from "#/components/viewer/exportPng.ts";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import { Viewer2D } from "#/components/viewer/Viewer2D.tsx";
import { buildStaticDisplay } from "#/drawing/display.ts";
import type { SelectionEdit } from "#/drawing/selection-edit.ts";
import { resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import { boardEdgeBounds, layerSurfaceZ } from "#/footprint/board.ts";
import { loadBuiltinFootprints } from "#/footprint/library.ts";
import { isEditableTarget } from "#/lib/keyboard.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import { EditorDocument } from "#/projects/EditorDocument.tsx";
import { EditorHeader } from "#/projects/EditorHeader.tsx";
import {
	useLatestProjectSnapshot,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import type { BoardDocument } from "#/projects/ProjectSession.ts";
import { projectIndex } from "#/projects/project-index.ts";
import { useEditorControlsRegistration } from "#/projects/WorkspaceControls.tsx";
import type { SymbolEditTarget } from "#/symbol-library/storage.tsx";

const SchematicErcPanel = lazy(() =>
	import("#/components/editor/SchematicErcPanel.tsx").then((module) => ({
		default: module.SchematicErcPanel,
	})),
);

export interface Editor2DProps {
	sheet?: SheetSize;

	store?: ReturnType<typeof createDrawingStore>;

	enableMcp?: boolean;
}

const noLayers: ReadonlySet<FootprintLayer> = new Set();
const footprintPixelsPerMmAt100 = 100;

export type EditorCanvasProps = Editor2DProps & {
	symbolName?: string;
	footprintName?: string;
	board?: BoardDocument;
	drawingName?: string;
	headerControls?: ReactNode;
	viewSwitch?: ReactNode;
	/** Id of the open file among the project's file selections. */
	documentSelection?: string;
	syncSelection?: boolean;
	active?: boolean;
};

const NO_SHAPES: EditorShape[] = [];
const NO_SELECTION: ReadonlySet<number> = new Set();
const flatBoard = (shapes: readonly EditorShape[]) =>
	boardDisplay(shapes, NO_SELECTION, noLayers, "F.Cu").shapes;

export function Editor2D(props: Editor2DProps = {}) {
	return <EditorDocument {...props} Canvas={EditorCanvas} />;
}

function EditorCanvas({
	sheet: sheetOverride,
	store: suppliedStore,
	enableMcp = true,
	symbolName,
	footprintName,
	board,
	drawingName,
	headerControls,
	viewSwitch,
	documentSelection,
	syncSelection = false,
	active = true,
}: EditorCanvasProps) {
	const isBoard = board !== undefined;
	const isFootprint = footprintName !== undefined || isBoard;
	const sheetless = symbolName !== undefined || isFootprint;
	const editorKind = isBoard
		? "PCB"
		: isFootprint
			? "Footprint"
			: sheetless
				? "Symbol"
				: "Schematic";
	const unit = isFootprint ? "mm" : "mil";
	const layers = useFootprintLayers();
	const [boardView, setBoardView] = useState<"closed" | "open" | "closing">(
		"closed",
	);
	const flatShown = boardView === "closed";
	const [boardError, setBoardError] = useState("");
	const [boardBuildError, setBoardBuildError] = useState("");
	const [boardMount, setBoardMount] = useState(0);
	const [ownedStore] = useState(() => createDrawingStore());
	const project = useProjectSelection(
		({
			store,
			error,
			libraryErrors,
			selectEditorFile,
			createFootprint,
			project,
		}) => ({
			store,
			error,
			libraryErrors,
			selectEditorFile,
			createFootprint,
			footprints: project?.footprints,
			snapshot: project,
		}),
	);
	const latestProject = useLatestProjectSnapshot();
	const store = suppliedStore ?? project?.store ?? ownedStore;
	const viewport = useEditorViewport(store, unit);
	const { cameraView, gridStep } = viewport;
	const ready = viewport.ready && boardView !== "closing";
	const registerEditor = useEditorControlsRegistration();
	useEffect(
		() =>
			active ? registerEditor?.(store, enableMcp && !isFootprint) : undefined,
		[active, registerEditor, store, enableMcp, isFootprint],
	);
	const drawing = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const history = drawing.history;
	const sheetSettings = drawing.sheet;
	const sheet = useMemo(
		() => sheetOverride ?? sheetPaper(sheetSettings),
		[sheetOverride, sheetSettings],
	);
	const symbolLibrary = useSymbolLibrary();
	const { definitions, byReference } = symbolLibrary;
	const resolveDocument = useCallback(
		(shapes: EditorShape[]) => {
			if (isBoard)
				return {
					shapes: boardLayerView(
						fitTextShapes(shapes),
						layers.hidden,
						layers.active,
					),
					errors: [] as string[],
				};
			const result = resolveDrawingSymbols(
				fitTextShapes(shapes),
				definitions,
				byReference,
			);
			return isFootprint
				? {
						...result,
						shapes: footprintLayerView(
							result.shapes,
							layers.hidden,
							layers.active,
						),
					}
				: result;
		},
		[
			definitions,
			byReference,
			isBoard,
			isFootprint,
			layers.hidden,
			layers.active,
		],
	);
	const resolveShapes = useCallback(
		(shapes: EditorShape[]) => resolveDocument(shapes).shapes,
		[resolveDocument],
	);
	const resolved = useMemo(
		() => resolveDocument(drawing.shapes),
		[resolveDocument, drawing.shapes],
	);
	const layerItemCounts = useMemo(() => {
		const counts = new Map<FootprintLayer, number>();
		if (isFootprint)
			for (const shape of isBoard ? flatBoard(drawing.shapes) : drawing.shapes)
				for (const layer of shapeLayers(shape))
					counts.set(layer, (counts.get(layer) ?? 0) + 1);
		return counts;
	}, [isBoard, isFootprint, drawing.shapes]);
	const everyLayerShapes = useMemo(
		() =>
			isBoard
				? flatBoard(fitTextShapes(drawing.shapes))
				: isFootprint
					? footprintLayerView(fitTextShapes(drawing.shapes), noLayers)
					: [],
		[isBoard, isFootprint, drawing.shapes],
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
	const boardEditor = useBoardEditor({
		board,
		store,
		session,
		snapshot: project?.snapshot,
		committed: drawing.shapes,
		draft: editor.draft,
		hidden: layers.hidden,
		active: layers.active,
		focused: layers.focused,
		setActive: layers.activate,
		selection: selectedIds,
		ratsnestShown: flatShown,
	});
	const pages = drawingPages(drawing.pages);
	const pageIndex = pages.findIndex(
		(page) => page.id === resolvePage(drawing.pages, editor.page),
	);
	const page = pages[pageIndex];
	const pageShapes = useMemo(
		() => shapesOnPage(resolved.shapes, page.id, drawing.pages),
		[resolved.shapes, page.id, drawing.pages],
	);
	const pageShapeCounts = useMemo(() => {
		const counts = new Map<number, number>();
		for (const shape of drawing.shapes) {
			const id = shape.page ?? pages[0].id;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		return counts;
	}, [drawing.shapes, pages]);
	const pageSheet = useMemo(
		() =>
			sheetless
				? sheet
				: {
						...sheet,
						page: {
							name: page.name,
							number: pageIndex + 1,
							count: pages.length,
						},
						titleBlock: {
							file: drawingName,
							title: sheetSettings?.title,
							date: sheetSettings?.date,
							revision: sheetSettings?.revision,
							company: sheetSettings?.company,
							comments: sheetSettings?.comments,
						},
					},
		[
			sheetless,
			sheet,
			page.name,
			pageIndex,
			pages.length,
			drawingName,
			sheetSettings,
		],
	);
	const shapes = editor.draft ?? pageShapes;
	const boardShapes = useMemo(() => {
		const draft = editor.draft;
		let shapes: EditorShape[];
		if (boardView === "closed" || !draft)
			shapes = fitTextShapes(drawing.shapes);
		else {
			const drafted = new Map(draft.map((shape) => [shape.id, shape]));
			const stored = new Set(drawing.shapes.map((shape) => shape.id));
			shapes = fitTextShapes([
				...drawing.shapes.map((shape) => drafted.get(shape.id) ?? shape),
				...draft.filter((shape) => !stored.has(shape.id)),
			]);
		}
		return isBoard ? flatBoard(shapes) : shapes;
	}, [editor.draft, boardView, drawing.shapes, isBoard]);
	useLayoutEffect(() => {
		if (!isFootprint) return;
		cameraView.setSurfaces((onLayers, eyeZ) =>
			layerSurfaceZ(onLayers, layers.hidden, eyeZ),
		);
		return () => cameraView.setSurfaces(null);
	}, [isFootprint, layers.hidden, cameraView]);
	const [tool, setTool] = useState<Tool>("select");
	const [symbolDefinition, setSymbolDefinition] =
		useState<SymbolDefinition | null>(null);
	const [textFocusId, setTextFocusId] = useState<number | null>(null);
	const [attributesFor, setAttributesFor] = useState<{
		selection: ReadonlySet<number>;
		childKey: string | null;
	} | null>(null);
	const openAttributes = useCallback(() => {
		const { selection, childKey } = session.getState();
		setAttributesFor({ selection, childKey });
	}, [session]);
	const [creatingSymbol, setCreatingSymbol] = useState(false);
	const [ercOpen, setErcOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [boardPanel, setBoardPanel] = useState<"checks" | "setup" | null>(null);
	const [exporting, setExporting] = useState(false);
	const canvasArea = useRef<HTMLDivElement>(null);
	const {
		selected,
		selectedSymbol,
		selectedChild,
		selectedChildFixed,
		selectionLocked,
		selectionSnapStep,
		handles,
	} = useEditorSelection({
		shapes,
		selectedIds,
		selectedChildKey,
		allowLocked,
		tool,
		gridStep,
	});
	const {
		copyToProject,
		definitionId,
		editTarget,
		editingDefinition,
		setEditingDefinition,
		symbolPath,
	} = useSymbolDefinitionEditing({ session, selectedSymbol, symbolLibrary });
	const gestures = useCanvasGestures({
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
		footprintLayer: isFootprint ? layers.active : undefined,
		board: boardEditor.gestures,
		setTextFocusId,
		openAttributes,
	});
	const {
		getDrag,
		getWire,
		marquee,
		movingShapeId,
		wirePreview,
		placementPreview,
		clearPlacementPreview,
		canRotatePlacement,
		placing,
		connectionHover,
		finishDrag,
		finishWire,
		pointerHandlers,
	} = gestures;
	const previews = useMemo(
		() => wirePreview ?? (placementPreview ? [placementPreview] : []),
		[wirePreview, placementPreview],
	);
	const focusedLayer = isFootprint ? layers.focused : undefined;
	const buildFootprintDisplay = useCallback(
		(
			shapes: EditorShape[],
			selected: ReadonlySet<number>,
			measure: Parameters<typeof buildStaticDisplay>[2],
		) => buildStaticDisplay(shapes, selected, measure, focusedLayer),
		[focusedLayer],
	);
	const { scene, updateScene: updateDrawingScene } = useEditorScene(
		flatShown ? shapes : NO_SHAPES,
		flatShown ? selectedIds : NO_SELECTION,
		flatShown ? previews : NO_SHAPES,
		sheetless ? null : pageSheet,
		isBoard
			? boardEditor.buildDisplay
			: focusedLayer
				? buildFootprintDisplay
				: undefined,
	);
	const { updateZones } = boardEditor;
	const updateScene = useCallback(
		(root: Parameters<typeof updateDrawingScene>[0]) => {
			updateDrawingScene(root);
			updateZones(root);
		},
		[updateDrawingScene, updateZones],
	);
	const movingShape = shapes.find((shape) => shape.id === movingShapeId);
	const guideShape = movingShape ?? placementPreview;
	const guideBounds = guideShape ? shapeBounds(guideShape) : null;
	const guideCenter = guideBounds
		? {
				x: (guideBounds.minX + guideBounds.maxX) / 2,
				y: (guideBounds.minY + guideBounds.maxY) / 2,
			}
		: null;
	const {
		editSelection,
		restoreHistory,
		undo,
		redo,
		rotateItems,
		removeSelected,
		createSelectionSymbol,
	} = useEditorCommands({
		session,
		gestures,
		tool,
		setTool,
		ready,
		selectedChildKey,
		symbolLibrary,
		setCreatingSymbol,
	});

	const { syncReport, clearSyncReport } = boardEditor;
	useEffect(() => {
		if (!syncReport) return;
		clearSyncReport();
		announceBoardSync(syncReport);
	}, [syncReport, clearSyncReport]);
	const cancelGestures = useEffectEvent(() => {
		finishDrag(true);
		finishWire();
	});
	useEffect(() => session.connect(store, cancelGestures), [session, store]);
	useDrawingSelectionSync({
		enabled: syncSelection && active,
		view: isBoard ? "pcb" : "schematic",
		store,
		session,
		selection: selectedIds,
		childKey: selectedChildKey,
	});

	const rerouteNotice = useLegacyWireReroute({
		store,
		session,
		sheetless,
		ready: symbolLibrary.ready,
		resolved,
	});
	const issues = editorIssues([
		viewport.viewerError,
		boardError,
		boardBuildError,
		boardEditor.analysisError &&
			`Unable to analyse the board: ${boardEditor.analysisError}`,
		rerouteNotice?.historyId === drawing.history.currentId
			? rerouteNotice.text
			: "",
		...(symbolLibrary.loading ? [] : resolved.errors),
		project?.error,
		...(project?.libraryErrors ?? []),
	]);
	const messages = useEditorMessages({
		session,
		commandError,
		issues,
		loading: symbolLibrary.loading,
	});

	const hasSelection = selected.length > 0;
	const editPages = useCallback<PageEdit>(
		(next, label) => {
			finishDrag(true);
			finishWire();
			clearPlacementPreview();
			setTextFocusId(null);
			return !!session.commit(setPagesEffect(next, label), new Set());
		},
		[session, finishDrag, finishWire, clearPlacementPreview],
	);
	const saveSheet = useCallback(
		(next: SheetSettings) => {
			finishDrag(true);
			finishWire();
			clearPlacementPreview();
			return !!session.commit(
				setSheetEffect(next, "Edit schematic settings"),
				new Set(),
			);
		},
		[session, finishDrag, finishWire, clearPlacementPreview],
	);
	const selectPage = useCallback(
		(id: number) => {
			session.setPage(id);
			canvasArea.current
				?.querySelector("canvas")
				?.focus({ preventScroll: true });
		},
		[session],
	);
	const pickerLibrary = useMemo(
		() => ({ definitions, error: symbolLibrary.error }),
		[definitions, symbolLibrary.error],
	);
	const clipboard = useDrawingClipboard({
		session,
		enabled: () => ready && !creatingSymbol && !getDrag() && !getWire(),
		target: isFootprint
			? { footprintLayer: layers.active }
			: sheetless
				? "symbol"
				: "drawing",
		pasteStep: gridStep || SCHEMATIC_STEP,
		beforePaste: () => {
			finishWire();
			setTool("select");
			clearPlacementPreview();
		},
	});
	const viewToggle = useRef<HTMLButtonElement>(null);
	const refocusToggle = useRef(false);
	useEffect(() => {
		const button = viewToggle.current;
		if (!refocusToggle.current || !button || button.disabled) return;
		refocusToggle.current = false;
		if (document.activeElement === document.body) quietFocus(button);
	});
	const toggleBoard = useCallback(() => {
		refocusToggle.current = true;
		finishDrag(true);
		finishWire();
		clearPlacementPreview();
		setBoardError("");
		setBoardView((current) => (current === "closed" ? "open" : "closing"));
	}, [finishDrag, finishWire, clearPlacementPreview]);
	const showBoardFlat = useCallback(
		(flat: boolean) => {
			if (!flat) {
				finishDrag(true);
				finishWire();
				clearPlacementPreview();
				setBoardError("");
			}
			setBoardView(flat ? "closed" : "open");
		},
		[finishDrag, finishWire, clearPlacementPreview],
	);
	const reportBoardBuild = useCallback((message: string) => {
		setBoardBuildError(message);
		if (message) setBoardView("closed");
	}, []);
	const reportBoardError = (message: string) => {
		if (boardView === "closed") {
			viewport.onError(message);
			return;
		}
		setBoardError(message);
		setBoardView("closed");
		setBoardMount((count) => count + 1);
	};
	const toggleLayer = (layer: FootprintLayer) => {
		if (!layers.hidden.has(layer)) {
			finishDrag(true);
			session.select(new Set());
		}
		layers.toggle(layer);
	};
	const footprintControls = useMemo(
		() =>
			isFootprint
				? {
						flat: boardView !== "open",
						available: !boardBuildError,
						onToggleFlat: toggleBoard,
						toggle: viewToggle,
					}
				: undefined,
		[isFootprint, boardView, boardBuildError, toggleBoard],
	);

	const editAttributes = useCallback(
		(edit: SelectionEdit) => {
			editSelection(edit);
			openAttributes();
		},
		[editSelection, openAttributes],
	);
	const attributesShown =
		attributesFor?.selection === selectedIds &&
		attributesFor.childKey === selectedChildKey;
	const footprintChoices = useMemo((): FootprintChoices | undefined => {
		if (sheetless) return undefined;
		if (!project || (suppliedStore && documentSelection === undefined))
			return { project: [] };
		const { selectEditorFile, createFootprint } = project;
		return {
			project: project.footprints ?? [],
			onOpen: (id) => {
				const snapshot = latestProject();
				const path = snapshot
					? projectIndex(snapshot).footprintsById.get(id)?.path
					: undefined;
				if (path) void selectEditorFile(path);
			},
			onCopy: async (id) => {
				const source = (await loadBuiltinFootprints()).byId.get(id);
				if (!source)
					throw new Error("This footprint is not in the built-in library.");
				const path = await createFootprint(source.file.name, source.file);
				const snapshot = latestProject();
				const copy = snapshot
					? projectIndex(snapshot).footprintsByPath.get(path)
					: undefined;
				if (!copy) throw new Error("The copied footprint could not be found.");
				return copy.id;
			},
		};
	}, [sheetless, project, suppliedStore, documentSelection, latestProject]);
	const childTextMoved =
		!!selectedSymbol &&
		selectedChild?.shape.kind === "text" &&
		symbolTextMoved(selectedSymbol, selectedChild.key);
	const boardNets = useMemo(
		() => (isBoard ? [...boardEditor.netlist.nets.values()] : undefined),
		[isBoard, boardEditor.netlist],
	);
	const selectionAttributes = useMemo(
		() => (
			<SelectionAttributes
				shapes={selectedChild ? [selectedChild.shape] : selected}
				isSymbolChild={selectedChild !== undefined}
				symbolTextMoved={childTextMoved}
				readOnly={selectedChildFixed}
				onEdit={editAttributes}
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
				onCopySymbol={copyToProject}
				onCreateSymbol={sheetless ? undefined : () => setCreatingSymbol(true)}
				allowNetEdits={!sheetless}
				footprint={isFootprint}
				footprintChoices={footprintChoices}
				hiddenLayers={layers.hidden}
				boardNets={boardNets}
				unit={unit}
				snapStep={
					selectedChild
						? gridStep / (selectedChild.shape.kind === "text" ? 10 : 1)
						: selectionSnapStep
				}
				onClear={() => session.select(new Set())}
				textFocusId={textFocusId}
				onTextFocus={() => setTextFocusId(null)}
			/>
		),
		[
			selectedChild,
			selectedChildFixed,
			childTextMoved,
			selected,
			editAttributes,
			editTarget,
			copyToProject,
			symbolPath,
			suppliedStore,
			definitionId,
			project,
			sheetless,
			isFootprint,
			footprintChoices,
			layers.hidden,
			boardNets,
			unit,
			gridStep,
			selectionSnapStep,
			session,
			textFocusId,
			setEditingDefinition,
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

	// In a project the page tabs share the document bar's row. Standalone,
	// they float at the top centre of the canvas.
	const pageBar = (floating: boolean) =>
		!sheetless && scene ? (
			<PageBar
				pages={pages}
				current={page.id}
				shapeCounts={pageShapeCounts}
				disabled={!ready}
				floating={floating}
				onSelect={selectPage}
				onEdit={editPages}
			/>
		) : undefined;

	const boardToolbar = isBoard
		? {
				onSync: () => {
					finishDrag(true);
					finishWire();
					boardEditor.synchronize().catch((cause: unknown) => {
						const title = "Unable to update the board from its schematic.";
						toastManager.add({
							type: "error",
							title,
							description: errorMessage(cause, title),
						});
					});
				},
				checksOpen: boardPanel === "checks",
				onChecks: () =>
					setBoardPanel((open) => (open === "checks" ? null : "checks")),
				setupOpen: boardPanel === "setup",
				onSetup: () =>
					setBoardPanel((open) => (open === "setup" ? null : "setup")),
				canFlip:
					flatShown &&
					selected.some((shape) => shape.kind === "symbol" && !shape.locked),
				onFlip: () => {
					finishDrag(true);
					boardEditor.flipSelection();
				},
				onExport: () => {
					if (!board) return;
					setExporting(true);
					const exported = store.getSnapshot().shapes;
					void Promise.all([
						import("#/board/gerber.ts"),
						import("fflate"),
						boardEditor.fillsOf(exported),
						boardEditor.runChecks(exported),
					])
						.then(
							([
								{ exportFabrication },
								{ zipSync, strToU8 },
								fills,
								checks,
							]) => {
								const stem =
									board.file.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "board";
								const files = exportFabrication(stem, exported, fills);
								const zip = zipSync(
									Object.fromEntries(
										files.map((file) => [file.name, strToU8(file.content)]),
									),
								);
								downloadPng(
									new Blob([zip], { type: "application/zip" }),
									`${board.file.name} gerber`,
									"zip",
								);
								const findings = checks.length;
								toastManager.add({
									type: findings ? "warning" : "success",
									title: "Fabrication files exported",
									description: findings
										? `${files.length} Gerber and drill files in a ZIP archive. The design rules check has ${findings} ${findings === 1 ? "finding" : "findings"}. Run it before ordering boards.`
										: `${files.length} Gerber and drill files in a ZIP archive.`,
								});
							},
						)
						.catch((cause: unknown) =>
							toastManager.add({
								type: "error",
								title: "Unable to export fabrication files",
								description: errorMessage(
									cause,
									"Unable to export fabrication files",
								),
							}),
						)
						.finally(() => setExporting(false));
				},
				exporting,
			}
		: undefined;
	const toolbar = (
		<EditorToolbar
			shapes={
				isFootprint
					? everyLayerShapes
					: sheetless
						? resolved.shapes
						: pageShapes
			}
			sheet={pageSheet}
			drawingName={drawingName}
			ready={ready}
			history={history}
			undo={undo}
			redo={redo}
			restoreHistory={restoreHistory}
			tool={tool}
			sheetless={sheetless}
			footprint={footprintControls}
			symbolLibrary={pickerLibrary}
			finishDrag={finishDrag}
			finishWire={finishWire}
			setSymbolDefinition={setSymbolDefinition}
			setTool={setTool}
			clearPlacementPreview={clearPlacementPreview}
			canRotatePlacement={canRotatePlacement}
			allowLocked={allowLocked}
			session={session}
			hasSelection={hasSelection}
			rotateItems={rotateItems}
			selectionLocked={selectionLocked}
			lockDisabled={selectedChildFixed}
			editSelection={editSelection}
			removeSelected={removeSelected}
			ercOpen={ercOpen}
			onErc={sheetless ? undefined : () => setErcOpen((open) => !open)}
			settingsOpen={settingsOpen}
			onSettings={sheetless ? undefined : () => setSettingsOpen(true)}
			board={boardToolbar}
		/>
	);

	return (
		<main
			className="relative flex h-dvh flex-col overflow-hidden"
			{...clipboard}
			onKeyDownCapture={(event) => {
				if (
					isBoard &&
					ready &&
					!creatingSymbol &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.altKey &&
					!isEditableTarget(event)
				) {
					const key = event.key.toLowerCase();
					const handled =
						key === "v"
							? gestures.placeTrackVia()
							: key === "/"
								? gestures.flipTrackPosture()
								: key === "f" && flatShown && !getDrag()
									? boardEditor.flipSelection()
									: false;
					if (handled) {
						event.preventDefault();
						event.stopPropagation();
						return;
					}
				}
				handleEditorShortcut(event, {
					dialogOpen: creatingSymbol || settingsOpen,
					ready,
					session,
					canRotatePlacement,
					placing,
					clearPlacementPreview,
					finishWire,
					finishDrag,
					setTool,
					rotateItems,
					undo,
					redo,
				});
			}}
		>
			<h1 className="sr-only">
				{sheetless
					? `${editorKind} editor · ${board?.file.name ?? footprintName ?? symbolName}`
					: `Schematic editor · ${drawingName ? `${drawingName} · ` : ""}${pages.length > 1 ? `${page.name} (page ${pageIndex + 1} of ${pages.length}) · ` : ""}${sheet.name ? `${sheet.name} · ` : ""}${formatInches(sheet.width)} × ${formatInches(sheet.height)} in`}
			</h1>
			{registerEditor ? (
				<DocumentBar
					icon={
						isBoard
							? Grid2x2
							: isFootprint
								? Cpu
								: sheetless
									? Component
									: CircuitBoard
					}
					title={board?.file.name ?? footprintName ?? symbolName ?? drawingName}
					selection={documentSelection}
					view={isBoard ? "pcb" : undefined}
					center={pageBar(false)}
					active={active}
				>
					{headerControls ?? viewSwitch}
				</DocumentBar>
			) : (
				<EditorHeader headerControls={headerControls} />
			)}
			<div className="relative flex min-h-0 flex-1">
				<div
					ref={canvasArea}
					className={`relative min-w-0 flex-1 touch-none ${sheetless ? "bg-paper" : "bg-desk"} ${tool === "pan" ? "[&_canvas]:cursor-grab" : tool === "select" ? "" : "[&_canvas]:cursor-crosshair"}`}
					data-tool={tool}
					data-view={
						isFootprint ? (boardView === "closed" ? "2d" : "3d") : undefined
					}
					{...pointerHandlers}
					onKeyDownCapture={(event) => {
						handleCanvasKeyDown(event, {
							session,
							gestures,
							setTool,
							selected,
							selectedSymbol,
							selectedChild,
							selectedChildFixed,
							gridStep,
							selectionSnapStep,
							allowLocked,
							removeSelected,
						});
					}}
				>
					{isFootprint && (
						<FootprintBoardView
							key={boardMount}
							shapes={boardShapes}
							regions={isBoard ? boardEditor.fills : undefined}
							ariaLabel={`${editorKind} editor`}
							controlsLabel={`${editorKind} tools`}
							hiddenLayers={layers.hidden}
							focusedLayer={layers.focused}
							flat={boardView !== "open"}
							onFlatChange={showBoardFlat}
							orbitGesture="alt-shift"
							updateFlatScene={updateScene}
							cameraState={viewport.cameraState}
							pixelsPerMmAt100={footprintPixelsPerMmAt100}
							fitZoom={1.1}
							getFitBounds={() =>
								selectionFitBounds(selected, selectedSymbol, selectedChild) ??
								(boardView === "closed" && !isBoard
									? footprintFitBounds(drawing.shapes)
									: boardEdgeBounds(boardShapes))
							}
							onBuildError={reportBoardBuild}
							onError={reportBoardError}
							onReady={viewport.onReady}
							onChange={cameraView.update}
							controls={toolbar}
							interactionHint={footprintInteractionHint}
						/>
					)}
					{scene && !isFootprint && (
						<Viewer2D
							projection="orthographic"
							lockProjection
							focusOutline={false}
							rulerUnit={unit}
							scene={scene}
							cameraState={viewport.cameraState}
							fitZoom={1.1}
							physicalSizeZoom
							getFitBounds={() =>
								selectionFitBounds(selected, selectedSymbol, selectedChild)
							}
							groupedControls
							controlsLabel={`${editorKind} tools`}
							gridBounds={
								sheetless
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
							onReady={viewport.onReady}
							onError={viewport.onError}
							onChange={cameraView.update}
							extraControls={toolbar}
							ariaLabel={`${editorKind} editor`}
							interactionHint={editorInteractionHint}
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
						canvasArea={canvasArea}
						connectionHover={connectionHover}
						marquee={marquee}
						placementPreview={placementPreview}
					/>
					<EditorMessages
						{...messages}
						besidePanel={isFootprint || (ercOpen && !sheetless)}
					/>
					{isFootprint && (
						<FootprintLayerPanel
							active={layers.active}
							hidden={layers.hidden}
							itemCounts={layerItemCounts}
							focused={layers.focused}
							onSelect={layers.select}
							onToggle={toggleLayer}
						/>
					)}
					{isBoard && boardEditor.rules && (
						<BoardStatus
							unrouted={boardEditor.unrouted}
							failed={boardEditor.analysisError !== ""}
							layer={layers.active}
						/>
					)}
					{isBoard && boardPanel === "checks" && (
						<BoardChecksPanel
							revision={drawing.shapes}
							run={() => boardEditor.runChecks()}
							onClose={() => setBoardPanel(null)}
							onSelect={(finding) => {
								if (!finding.shapeIds.length) return;
								finishDrag(true);
								session.reveal(new Set(finding.shapeIds));
							}}
						/>
					)}
					{isBoard && boardPanel === "setup" && board && boardEditor.rules && (
						<BoardSetupPanel
							rules={boardEditor.rules}
							onChange={(rules) => board.rules.set(rules)}
							onClose={() => setBoardPanel(null)}
						/>
					)}
					{!registerEditor && pageBar(true)}
					{ercOpen && !sheetless && (
						<Suspense
							fallback={
								<FloatingPanel
									label="Electrical rules check"
									as="section"
									position="top-left"
									raised
								>
									<output className="p-3 text-xs text-fg-muted">
										Loading electrical checks...
									</output>
								</FloatingPanel>
							}
						>
							<SchematicErcPanel
								shapes={resolved.shapes}
								definitions={definitions}
								onClose={() => {
									setErcOpen(false);
									canvasArea.current
										?.querySelector("canvas")
										?.focus({ preventScroll: true });
								}}
								onSelect={(ids) => {
									// A finding can point at a locked symbol. Allow selecting
									// locked items, as the toolbar toggle does, so it shows.
									if (
										!allowLocked &&
										resolved.shapes.some(
											(shape) => ids.has(shape.id) && shape.locked,
										)
									) {
										finishDrag(true);
										session.setAllowLocked(true);
									}
									session.reveal(ids);
								}}
							/>
						</Suspense>
					)}
					<CursorReadout
						ready={ready}
						cameraView={cameraView}
						canvasArea={canvasArea}
						unit={unit}
						layer={isFootprint ? layers.active : undefined}
						besideAxes={boardView !== "closed"}
					/>
				</div>
				{attributesShown && selectionAttributes}
			</div>
			{settingsOpen && !sheetless && (
				<SchematicSettingsDialog
					sheet={sheetSettings}
					onSave={saveSheet}
					onClose={() => setSettingsOpen(false)}
				/>
			)}
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
	const { store, save, saving, error, attributes, changeAttributes } =
		useLibrarySymbolSave(target);
	return (
		<EditorCanvas
			store={store}
			symbolName={target.file.name}
			enableMcp={false}
			headerControls={
				<>
					<button
						type="button"
						className="ui-button"
						data-variant="secondary"
						disabled={saving}
						onClick={() =>
							void save()
								.then(onClose)
								.catch(() => undefined)
						}
					>
						<ArrowLeft size={14} aria-hidden="true" />
						Back to schematic
					</button>
					<SymbolAttributesButton
						attributes={attributes}
						onSave={changeAttributes}
					/>
					{error && (
						<p
							role="alert"
							className="m-0 max-w-md truncate text-xs text-danger"
							title={error}
						>
							{error}
						</p>
					)}
				</>
			}
		/>
	);
}
