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
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	formatInches,
	SCHEMATIC_STEP,
} from "@ecad/drawing-core/drawing/units.ts";
import {
	boardLayers,
	type FootprintLayer,
	footprintLayers,
} from "@ecad/drawing-core/footprint/layers.ts";
import type { ModelReference } from "@ecad/drawing-core/footprint/model.ts";
import {
	footprintFitBounds,
	footprintLayerView,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { JSX } from "@solidjs/web";
import { Dynamic } from "@solidjs/web";
import {
	createEffect,
	createMemo,
	createRenderEffect,
	createSignal,
	Loading,
	lazy,
	Show,
} from "solid-js";
import type { Object3D } from "three";
import { announceBoardSync } from "#/board/sync-document.ts";
import {
	boardDisplay,
	boardExportShapes,
	boardLayerView,
} from "#/board/view.ts";
import {
	BoardChecksPanel,
	BoardSetupPanel,
	BoardStatus,
} from "#/components/board/BoardPanels.tsx";
import { useBoardEditor } from "#/components/board/useBoardEditor.ts";
import { CanvasOverlay } from "#/components/editor/CanvasOverlay.tsx";
import { CreateSymbolDialog } from "#/components/editor/CreateSymbolDialog.tsx";
import { CursorReadout } from "#/components/editor/CursorReadout.tsx";
import type { SurfaceHeights } from "#/components/editor/canvasView.ts";
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
	type CanvasGesturesOptions,
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
import {
	ArrowLeft,
	CircuitBoard,
	Component,
	Cpu,
	Grid2x2,
} from "#/components/ui/icons.tsx";
import { Keyed } from "#/components/ui/Keyed.tsx";
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
import type { GridUnit } from "#/engine/ruler.ts";
import { boardEdgeBounds, layerSurfaceZ } from "#/footprint/board.ts";
import {
	loadBuiltinFootprints,
	useBuiltinFootprints,
} from "#/footprint/library.ts";
import {
	boardModelPlacements,
	footprintModelPlacements,
} from "#/footprint/models.ts";
import { fromExternalStore } from "#/lib/external-store.ts";
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
import { useWorkspaceRegistration } from "#/projects/WorkspaceControls.tsx";
import { setBoardUnit, useBoardUnit } from "#/settings/useBoardUnit.ts";
import type { SymbolEditTarget } from "#/symbol-library/storage.ts";

const SchematicErcPanel = lazy(() =>
	import("#/components/editor/SchematicErcPanel.tsx").then((module) => ({
		default: module.SchematicErcPanel,
	})),
);

export interface Editor2DProps {
	sheet?: SheetSize;

	store?: ReturnType<typeof createDrawingStore>;
}

const noLayers: ReadonlySet<FootprintLayer> = new Set();
const footprintPixelsPerMmAt100 = 100;

export type EditorCanvasProps = Editor2DProps & {
	symbolName?: string;
	footprintName?: string;
	footprintModel?: ModelReference;
	board?: BoardDocument;
	drawingName?: string;
	headerControls?: JSX.Element;
	viewSwitch?: JSX.Element;
	/** Id of the open file among the project's file selections. */
	documentSelection?: string;
	syncSelection?: boolean;
	active?: boolean;
	splitPane?: boolean;
	fillHeight?: boolean;
};

type ResolvedDocument = { shapes: EditorShape[]; errors: string[] };

const NO_SHAPES: EditorShape[] = [];
const NO_SELECTION: ReadonlySet<number> = new Set();
const NO_MODELS: ReturnType<typeof footprintModelPlacements> = [];
const NO_FOOTPRINTS: FootprintChoices["project"] = [];
const flatBoard = (shapes: readonly EditorShape[]) =>
	boardDisplay(shapes, NO_SELECTION, noLayers, "F.Cu").shapes;
const sameStrings = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((item, index) => item === b[index]);
const samePoint = (a: Point | null, b: Point | null) =>
	a === b || (!!a && !!b && a.x === b.x && a.y === b.y);

const listen =
	<K extends keyof HTMLElementEventMap>(
		type: K,
		handler: (event: HTMLElementEventMap[K]) => void,
		capture = false,
	) =>
	(element: HTMLElement) =>
		element.addEventListener(type, handler, { capture });

export function Editor2D(props: Editor2DProps) {
	return <EditorDocument {...props} Canvas={EditorCanvas} />;
}

function EditorCanvas(props: EditorCanvasProps) {
	const isBoard = createMemo(() => props.board !== undefined);
	const isFootprint = createMemo(
		() => props.footprintName !== undefined || isBoard(),
	);
	const sheetless = createMemo(
		() => props.symbolName !== undefined || isFootprint(),
	);
	const active = () => props.active ?? true;
	const editorKind = createMemo(() =>
		isBoard()
			? "PCB"
			: isFootprint()
				? "Footprint"
				: sheetless()
					? "Symbol"
					: "Schematic",
	);
	const boardUnit = useBoardUnit();
	const unit = createMemo(() => (isFootprint() ? boardUnit() : "mil"));
	const gridUnit = createMemo(
		(): GridUnit => (isFootprint() ? boardUnit() : "schematic"),
	);
	const boardRulesSource = createMemo(() => {
		const rules = props.board?.rules;
		return rules
			? fromExternalStore(
					(listener) => rules.subscribe(listener),
					() => rules.get(),
				)
			: undefined;
	});
	const copperLayerCount = createMemo(
		() => boardRulesSource()?.()?.copperLayers ?? 2,
	);
	const layerList = createMemo(() =>
		isBoard() ? boardLayers(copperLayerCount()) : footprintLayers,
	);
	const layers = useFootprintLayers(layerList);
	const [boardView, setBoardView] = createSignal<"closed" | "open" | "closing">(
		"closed",
	);
	const flatShown = createMemo(() => boardView() === "closed");
	const [boardError, setBoardError] = createSignal("");
	const [boardBuildError, setBoardBuildError] = createSignal("");
	const [boardMount, setBoardMount] = createSignal(0);
	const [realisticBoard, setRealisticBoard] = createSignal(false);
	const [modelsShown, setModelsShown] = createSignal(true);
	const ownedStore = createDrawingStore();
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
	const store = createMemo(() => props.store ?? project()?.store ?? ownedStore);
	const surfaces = createMemo((): SurfaceHeights | null => {
		if (!isFootprint()) return null;
		const hidden = layers.hidden;
		const copperLayers = copperLayerCount();
		return (onLayers, eyeZ) =>
			layerSurfaceZ(onLayers, hidden, eyeZ, copperLayers);
	});
	const viewport = useEditorViewport(store, gridUnit, surfaces);
	const cameraView = viewport.cameraView;
	const gridStep = () => viewport.gridStep;
	const ready = createMemo(() => viewport.ready && boardView() !== "closing");
	const inWorkspace = !!useWorkspaceRegistration();
	const drawingSource = createMemo(() => {
		const current = store();
		return fromExternalStore(current.subscribe, current.getSnapshot);
	});
	const drawing = () => drawingSource()();
	const history = createMemo(() => drawing().history);
	const sheetSettings = createMemo(() => drawing().sheet);
	const committedShapes = createMemo(() => drawing().shapes);
	const drawingPageList = createMemo(() => drawing().pages);
	const sheet = createMemo(() => props.sheet ?? sheetPaper(sheetSettings()));
	const symbolLibrary = useSymbolLibrary();
	const resolveDocument = createMemo(
		(): ((shapes: EditorShape[]) => ResolvedDocument) => {
			if (isBoard()) {
				const hidden = layers.hidden;
				const activeLayer = layers.active;
				return (shapes) => ({
					shapes: boardLayerView(fitTextShapes(shapes), hidden, activeLayer),
					errors: [],
				});
			}
			const definitions = symbolLibrary.definitions;
			const byReference = symbolLibrary.byReference;
			if (!isFootprint())
				return (shapes) =>
					resolveDrawingSymbols(
						fitTextShapes(shapes),
						definitions,
						byReference,
					);
			const hidden = layers.hidden;
			const activeLayer = layers.active;
			return (shapes) => {
				const result = resolveDrawingSymbols(
					fitTextShapes(shapes),
					definitions,
					byReference,
				);
				return {
					...result,
					shapes: footprintLayerView(result.shapes, hidden, activeLayer),
				};
			};
		},
	);
	const resolveShapes = createMemo(() => {
		const resolve = resolveDocument();
		return (shapes: EditorShape[]) => resolve(shapes).shapes;
	});
	const resolved = createMemo(() => resolveDocument()(committedShapes()));
	const resolvedShapes = createMemo(() => resolved().shapes);
	const layerItemCounts = createMemo(
		() => {
			const counts = new Map<FootprintLayer, number>();
			if (isFootprint()) {
				const shapes = committedShapes();
				for (const shape of isBoard() ? flatBoard(shapes) : shapes)
					for (const layer of shapeLayers(shape))
						counts.set(layer, (counts.get(layer) ?? 0) + 1);
			}
			return counts;
		},
		{ lazy: true },
	);
	const everyLayerShapes = createMemo(
		() =>
			isBoard()
				? boardExportShapes(fitTextShapes(committedShapes()))
				: isFootprint()
					? footprintLayerView(fitTextShapes(committedShapes()), noLayers)
					: NO_SHAPES,
		{ lazy: true },
	);
	const session = createEditorSession(ownedStore);
	createRenderEffect(
		() => ({
			resolve: resolveShapes(),
			input: committedShapes(),
			output: resolvedShapes(),
		}),
		(next) =>
			session.setResolver(next.resolve, {
				input: next.input,
				output: next.output,
			}),
	);
	const editor = fromExternalStore(session.subscribe, session.getState);
	const selectedIds = createMemo(() => editor().selection);
	const selectedChildKey = createMemo(() => editor().childKey);
	const commandError = createMemo(() => editor().error);
	const allowLocked = createMemo(() => editor().allowLocked);
	const draft = createMemo(() => editor().draft);
	const editorPage = createMemo(() => editor().page);
	const boardEditor = useBoardEditor(() => ({
		board: props.board,
		store: store(),
		session,
		snapshot: project()?.snapshot,
		committed: committedShapes(),
		draft: draft(),
		hidden: layers.hidden,
		active: layers.active,
		focused: layers.focused,
		setActive: layers.activate,
		selection: selectedIds(),
		ratsnestShown: flatShown(),
	}));
	const pages = createMemo(() => drawingPages(drawingPageList()));
	const pageIndex = createMemo(() => {
		const id = resolvePage(drawingPageList(), editorPage());
		return pages().findIndex((page) => page.id === id);
	});
	const page = () => pages()[pageIndex()];
	const pageId = createMemo(() => page().id);
	const pageShapes = createMemo(() =>
		shapesOnPage(resolvedShapes(), pageId(), drawingPageList()),
	);
	const pageShapeCounts = createMemo(() => {
		const counts = new Map<number, number>();
		const first = pages()[0].id;
		for (const shape of committedShapes()) {
			const id = shape.page ?? first;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		return counts;
	});
	const pageSheet = createMemo((): SheetSize => {
		if (sheetless()) return sheet();
		const settings = sheetSettings();
		return {
			...sheet(),
			page: {
				name: page().name,
				number: pageIndex() + 1,
				count: pages().length,
			},
			titleBlock: {
				file: props.drawingName,
				title: settings?.title,
				date: settings?.date,
				revision: settings?.revision,
				company: settings?.company,
				comments: settings?.comments,
			},
		};
	});
	const shapes = createMemo(() => draft() ?? pageShapes());
	const liveShapes = createMemo(
		() => {
			const committed = committedShapes();
			if (boardView() === "closed") return fitTextShapes(committed);
			const current = draft();
			if (!current) return fitTextShapes(committed);
			const drafted = new Map(current.map((shape) => [shape.id, shape]));
			const stored = new Set(committed.map((shape) => shape.id));
			return fitTextShapes([
				...committed.map((shape) => drafted.get(shape.id) ?? shape),
				...current.filter((shape) => !stored.has(shape.id)),
			]);
		},
		{ lazy: true },
	);
	const boardShapes = createMemo(
		() => (isBoard() ? flatBoard(liveShapes()) : liveShapes()),
		{ lazy: true },
	);
	const modelsWanted = createMemo(
		() => isFootprint() && realisticBoard() && modelsShown(),
	);
	const builtinFootprints = useBuiltinFootprints(
		() => isBoard() && modelsWanted(),
	);
	const modelPlacements = createMemo(
		() =>
			!modelsWanted()
				? NO_MODELS
				: isBoard()
					? boardModelPlacements(
							liveShapes(),
							builtinFootprints.library,
							project()?.footprints ?? NO_FOOTPRINTS,
						)
					: footprintModelPlacements(props.footprintModel),
		{ lazy: true },
	);
	const [tool, setTool] = createSignal<Tool>("select");
	const [symbolDefinition, setSymbolDefinition] =
		createSignal<SymbolDefinition | null>(null);
	const [textFocusId, setTextFocusId] = createSignal<number | null>(null);
	const [attributesFor, setAttributesFor] = createSignal<{
		selection: ReadonlySet<number>;
		childKey: string | null;
	} | null>(null);
	const openAttributes = () => {
		const { selection, childKey } = session.getState();
		setAttributesFor({ selection, childKey });
	};
	const [creatingSymbol, setCreatingSymbol] = createSignal(false);
	const [ercOpen, setErcOpen] = createSignal(false);
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const [boardPanel, setBoardPanel] = createSignal<"checks" | "setup" | null>(
		null,
	);
	const [exporting, setExporting] = createSignal(false);
	const [canvasArea, setCanvasArea] = createSignal<HTMLDivElement>();
	const focusCanvas = () =>
		canvasArea()?.querySelector("canvas")?.focus({ preventScroll: true });
	const selection = useEditorSelection(() => ({
		shapes: shapes(),
		selectedIds: selectedIds(),
		selectedChildKey: selectedChildKey(),
		allowLocked: allowLocked(),
		tool: tool(),
		gridStep: gridStep(),
	}));
	const definitionEditing = useSymbolDefinitionEditing(() => ({
		session,
		selectedSymbol: selection.selectedSymbol,
		symbolLibrary,
	}));
	const gestureOptions: CanvasGesturesOptions = {
		session,
		cameraView,
		get tool() {
			return tool();
		},
		setTool,
		get shapes() {
			return shapes();
		},
		get selected() {
			return selection.selected;
		},
		get selectedIds() {
			return selectedIds();
		},
		get selectedChildKey() {
			return selectedChildKey();
		},
		get selectedSymbol() {
			return selection.selectedSymbol;
		},
		get allowLocked() {
			return allowLocked();
		},
		get handles() {
			return selection.handles;
		},
		get ready() {
			return ready();
		},
		get gridStep() {
			return gridStep();
		},
		get symbolDefinition() {
			return symbolDefinition();
		},
		get sheetless() {
			return sheetless();
		},
		get footprintLayer() {
			return isFootprint() ? layers.active : undefined;
		},
		get board() {
			return boardEditor.gestures;
		},
		setTextFocusId,
		openAttributes,
	};
	const gestures = useCanvasGestures(() => gestureOptions);
	const previews = createMemo(() => {
		const wire = gestures.wirePreview;
		if (wire) return wire;
		const placement = gestures.placementPreview;
		return placement ? [placement] : NO_SHAPES;
	});
	const focusedLayer = () => (isFootprint() ? layers.focused : undefined);
	const buildFootprintDisplay = createMemo(() => {
		const focused = focusedLayer();
		return focused
			? (
					shapes: EditorShape[],
					selected: ReadonlySet<number>,
					measure: Parameters<typeof buildStaticDisplay>[2],
				) => buildStaticDisplay(shapes, selected, measure, focused)
			: undefined;
	});
	const drawingScene = useEditorScene(
		() => (flatShown() ? shapes() : NO_SHAPES),
		() => (flatShown() ? selectedIds() : NO_SELECTION),
		() => (flatShown() ? previews() : NO_SHAPES),
		() => (sheetless() ? null : pageSheet()),
		() => (isBoard() ? boardEditor.buildDisplay : buildFootprintDisplay()),
		() => (isBoard() ? boardEditor.buildPreview : undefined),
		isFootprint,
	);
	const updateScene = createMemo(() => {
		const updateDrawing = drawingScene.updateScene;
		const updateZones = boardEditor.updateZones;
		return (root: Object3D) => {
			updateDrawing(root);
			updateZones(root);
		};
	});
	const guideCenter = createMemo(
		(): Point | null => {
			const movingId = gestures.movingShapeId;
			const guide =
				(movingId == null
					? undefined
					: shapes().find((shape) => shape.id === movingId)) ??
				gestures.placementPreview;
			if (!guide) return null;
			const bounds = shapeBounds(guide);
			return {
				x: (bounds.minX + bounds.maxX) / 2,
				y: (bounds.minY + bounds.maxY) / 2,
			};
		},
		{ equals: samePoint },
	);
	const commands = useEditorCommands(() => ({
		session,
		gestures,
		tool: tool(),
		setTool,
		ready: ready(),
		selectedChildKey: selectedChildKey(),
		symbolLibrary,
		setCreatingSymbol,
	}));

	createEffect(
		() => boardEditor.syncReport,
		(report) => {
			if (!report) return;
			boardEditor.clearSyncReport();
			announceBoardSync(report);
		},
	);
	const cancelGestures = () => {
		gestures.finishDrag(true);
		gestures.finishWire();
	};
	createEffect(store, (current) => session.connect(current, cancelGestures));
	useDrawingSelectionSync(
		() => ({
			enabled: (props.syncSelection ?? false) && active(),
			view: isBoard() ? "pcb" : "schematic",
			store: store(),
			session,
		}),
		() => ({ shapeIds: selectedIds(), childKey: selectedChildKey() }),
	);

	const rerouteNotice = useLegacyWireReroute(() => ({
		store: store(),
		session,
		sheetless: sheetless(),
		ready: symbolLibrary.ready,
		resolved: resolved(),
	}));
	const issues = createMemo(
		() => {
			const notice = rerouteNotice();
			const analysisError = boardEditor.analysisError;
			const current = project();
			return editorIssues([
				viewport.viewerError,
				boardError(),
				boardBuildError(),
				analysisError && `Unable to analyse the board: ${analysisError}`,
				notice?.historyId === history().currentId ? notice.text : "",
				...(symbolLibrary.loading ? [] : resolved().errors),
				current?.error,
				...(current?.libraryErrors ?? []),
			]);
		},
		{ equals: sameStrings },
	);
	const messages = useEditorMessages(() => ({
		session,
		commandError: commandError(),
		issues: issues(),
		loading: symbolLibrary.loading,
	}));

	const endGestures = () => {
		gestures.finishDrag(true);
		gestures.finishWire();
		gestures.clearPlacementPreview();
	};
	const editPages: PageEdit = (next, label) => {
		endGestures();
		setTextFocusId(null);
		return !!session.commit(setPagesEffect(next, label), new Set());
	};
	const saveSheet = (next: SheetSettings) => {
		endGestures();
		return !!session.commit(
			setSheetEffect(next, "Edit schematic settings"),
			new Set(),
		);
	};
	const selectPage = (id: number) => {
		session.setPage(id);
		focusCanvas();
	};
	const pickerLibrary = createMemo(() => ({
		definitions: symbolLibrary.definitions,
		error: symbolLibrary.error,
	}));
	const clipboard = useDrawingClipboard(() => ({
		session,
		enabled: () =>
			ready() &&
			!creatingSymbol() &&
			!gestures.getDrag() &&
			!gestures.getWire(),
		target: isFootprint()
			? { footprintLayer: layers.active, layers: layers.layers }
			: sheetless()
				? "symbol"
				: "drawing",
		pasteStep: gridStep() || SCHEMATIC_STEP,
		beforePaste: () => {
			gestures.finishWire();
			setTool("select");
			gestures.clearPlacementPreview();
		},
	}));
	let viewToggle: HTMLButtonElement | undefined;
	let refocusToggle = false;
	const setViewToggle = (button: HTMLButtonElement) => {
		viewToggle = button;
	};
	createEffect(
		() => [ready(), boardView(), boardBuildError()],
		() => {
			const button = viewToggle;
			if (!refocusToggle || !button || button.disabled) return;
			refocusToggle = false;
			if (document.activeElement === document.body) quietFocus(button);
		},
	);
	const toggleBoard = () => {
		refocusToggle = true;
		endGestures();
		setBoardError("");
		setBoardView((current) => (current === "closed" ? "open" : "closing"));
	};
	const showBoardFlat = (flat: boolean) => {
		if (!flat) {
			endGestures();
			setBoardError("");
		}
		setBoardView(flat ? "closed" : "open");
	};
	const reportBoardBuild = (message: string) => {
		setBoardBuildError(message);
		if (message) setBoardView("closed");
	};
	const reportBoardError = (message: string) => {
		if (boardView() === "closed") {
			viewport.onError(message);
			return;
		}
		setBoardError(message);
		setBoardView("closed");
		setBoardMount((count) => count + 1);
	};
	const reportModelError = (message: string) => {
		toastManager.add({ type: "error", title: message });
	};
	const toggleLayer = (layer: FootprintLayer) => {
		if (!layers.hidden.has(layer)) {
			gestures.finishDrag(true);
			session.select(new Set());
		}
		layers.toggle(layer);
	};
	const footprintControls = createMemo(() =>
		isFootprint()
			? {
					flat: boardView() !== "open",
					available: !boardBuildError(),
					onToggleFlat: toggleBoard,
					toggle: setViewToggle,
					unit: boardUnit(),
					onUnitChange: setBoardUnit,
				}
			: undefined,
	);

	const editAttributes = (edit: SelectionEdit) => {
		commands.editSelection(edit);
		openAttributes();
	};
	const attributesShown = createMemo(() => {
		const shown = attributesFor();
		return (
			shown?.selection === selectedIds() &&
			shown.childKey === selectedChildKey()
		);
	});
	const hasProject = createMemo(() => project() !== null);
	const projectFootprints = createMemo(() => project()?.footprints);
	const footprintChoices = createMemo((): FootprintChoices | undefined => {
		if (sheetless()) return undefined;
		if (!hasProject() || (props.store && props.documentSelection === undefined))
			return { project: NO_FOOTPRINTS };
		return {
			project: projectFootprints() ?? NO_FOOTPRINTS,
			onOpen: (id) => {
				const snapshot = latestProject();
				const path = snapshot
					? projectIndex(snapshot).footprintsById.get(id)?.path
					: undefined;
				if (path) void project()?.selectEditorFile(path);
			},
			onCopy: async (id) => {
				const createFootprint = project()?.createFootprint;
				if (!createFootprint)
					throw new Error("The copied footprint could not be found.");
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
	});
	const childTextMoved = createMemo(() => {
		const symbol = selection.selectedSymbol;
		const child = selection.selectedChild;
		return (
			!!symbol &&
			child?.shape.kind === "text" &&
			symbolTextMoved(symbol, child.key)
		);
	});
	const attributeShapes = createMemo(() => {
		const child = selection.selectedChild;
		return child ? [child.shape] : selection.selected;
	});
	const boardNets = createMemo(() =>
		isBoard() ? [...boardEditor.netlist.nets.values()] : undefined,
	);
	const editSymbol = () => {
		const target = definitionEditing.editTarget;
		if (!target) return;
		const path = definitionEditing.symbolPath;
		if (
			path &&
			!props.store &&
			target.key === `project:project-symbols:${definitionEditing.definitionId}`
		)
			project()?.selectEditorFile(path);
		else definitionEditing.setEditingDefinition(target);
	};
	const gridBounds = createMemo(() => {
		if (sheetless()) return undefined;
		const { width, height } = sheet();
		return {
			minX: -width / 2,
			maxX: width / 2,
			minY: -height / 2,
			maxY: height / 2,
		};
	});
	const getDrawingFitBounds = () =>
		selectionFitBounds(
			selection.selected,
			selection.selectedSymbol,
			selection.selectedChild,
		);
	const getFootprintFitBounds = () =>
		getDrawingFitBounds() ??
		(boardView() === "closed" && !isBoard()
			? footprintFitBounds(committedShapes())
			: boardEdgeBounds(boardShapes()));

	const synchronizeBoard = () => {
		gestures.finishDrag(true);
		gestures.finishWire();
		boardEditor.synchronize().catch((cause: unknown) => {
			const title = "Unable to update the board from its schematic.";
			toastManager.add({
				type: "error",
				title,
				description: errorMessage(cause, title),
			});
		});
	};
	const exportBoard = () => {
		const board = props.board;
		if (!board) return;
		setExporting(true);
		const exported = store().getSnapshot().shapes;
		void Promise.all([
			boardEditor.fabricate(
				board.file.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "board",
				exported,
			),
			boardEditor.runChecks(unit(), exported),
		])
			.then(([{ archive, files }, checks]) => {
				downloadPng(
					new Blob([archive], { type: "application/zip" }),
					`${board.file.name} gerber`,
					"zip",
				);
				const findings = checks.length;
				toastManager.add({
					type: findings ? "warning" : "success",
					title: "Fabrication files exported",
					description: findings
						? `${files} Gerber and drill files in a ZIP archive. The design rules check has ${findings} ${findings === 1 ? "finding" : "findings"}. Run it before ordering boards.`
						: `${files} Gerber and drill files in a ZIP archive.`,
				});
			})
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
	};
	const boardToolbar = createMemo(() =>
		isBoard()
			? {
					onSync: synchronizeBoard,
					checksOpen: boardPanel() === "checks",
					onChecks: () =>
						setBoardPanel((open) => (open === "checks" ? null : "checks")),
					setupOpen: boardPanel() === "setup",
					onSetup: () =>
						setBoardPanel((open) => (open === "setup" ? null : "setup")),
					canFlip:
						flatShown() &&
						selection.selected.some(
							(shape) => shape.kind === "symbol" && !shape.locked,
						),
					onFlip: () => {
						gestures.finishDrag(true);
						boardEditor.flipSelection();
					},
					onExport: exportBoard,
					exporting: exporting(),
					zoneFills: () => boardEditor.drawingFills(committedShapes()),
					maskMargin: boardEditor.rules?.solderMaskMargin,
					copperLayers: boardEditor.rules?.copperLayers,
				}
			: undefined,
	);
	const toolbarShapes = () =>
		isFootprint()
			? everyLayerShapes()
			: sheetless()
				? resolvedShapes()
				: pageShapes();

	const editorKeyDown = (event: KeyboardEvent) => {
		if ((event.target as Node).ownerDocument !== document) return;
		if (
			isBoard() &&
			ready() &&
			!creatingSymbol() &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!isEditableTarget(event)
		) {
			const key = event.key.toLowerCase();
			const handled =
				key === "v"
					? gestures.placeTrackVia()
					: key === "pageup" || key === "pagedown"
						? gestures.stepCopperLayer(key === "pageup" ? -1 : 1)
						: key === "enter"
							? gestures.closeZone()
							: key === "/"
								? gestures.flipTrackPosture()
								: key === "f" && flatShown() && !gestures.getDrag()
									? boardEditor.flipSelection()
									: false;
			if (handled) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		}
		handleEditorShortcut(event, {
			dialogOpen: creatingSymbol() || settingsOpen(),
			ready: ready(),
			session,
			canRotatePlacement: gestures.canRotatePlacement,
			placing: gestures.placing,
			clearPlacementPreview: gestures.clearPlacementPreview,
			finishWire: gestures.finishWire,
			finishDrag: gestures.finishDrag,
			setTool,
			rotateItems: commands.rotateItems,
			undo: commands.undo,
			redo: commands.redo,
		});
	};
	const canvasKeyDown = (event: KeyboardEvent) =>
		handleCanvasKeyDown(event, {
			session,
			gestures,
			setTool,
			selected: selection.selected,
			selectedSymbol: selection.selectedSymbol,
			selectedChild: selection.selectedChild,
			selectedChildFixed: selection.selectedChildFixed,
			gridStep: gridStep(),
			selectionSnapStep: selection.selectionSnapStep,
			allowLocked: allowLocked(),
			removeSelected: commands.removeSelected,
		});

	// In a project the page tabs share the document bar's row. Standalone,
	// they float at the top centre of the canvas.
	const pageBar = (floating: boolean | "pane") => (
		<Show when={!sheetless()}>
			<PageBar
				pages={pages()}
				current={pageId()}
				shapeCounts={pageShapeCounts()}
				disabled={!ready()}
				floating={floating}
				onSelect={selectPage}
				onEdit={editPages}
			/>
		</Show>
	);

	const editorView = () => {
		const toolbar = () => (
			<EditorToolbar
				shapes={toolbarShapes()}
				sheet={pageSheet()}
				drawingName={
					props.board
						? `${props.board.file.name} PCB`
						: (props.footprintName ?? props.symbolName ?? props.drawingName)
				}
				ready={ready()}
				history={history()}
				undo={commands.undo}
				redo={commands.redo}
				restoreHistory={commands.restoreHistory}
				tool={tool()}
				sheetless={sheetless()}
				footprint={footprintControls()}
				symbolLibrary={pickerLibrary()}
				finishDrag={gestures.finishDrag}
				finishWire={gestures.finishWire}
				setSymbolDefinition={setSymbolDefinition}
				setTool={setTool}
				clearPlacementPreview={gestures.clearPlacementPreview}
				canRotatePlacement={gestures.canRotatePlacement}
				allowLocked={allowLocked()}
				session={session}
				hasSelection={selection.selected.length > 0}
				rotateItems={commands.rotateItems}
				selectionLocked={selection.selectionLocked}
				lockDisabled={selection.selectedChildFixed}
				editSelection={commands.editSelection}
				removeSelected={commands.removeSelected}
				ercOpen={ercOpen()}
				onErc={sheetless() ? undefined : () => setErcOpen((open) => !open)}
				settingsOpen={settingsOpen()}
				onSettings={sheetless() ? undefined : () => setSettingsOpen(true)}
				board={boardToolbar()}
			/>
		);
		return (
			<main
				class={[
					"relative flex min-h-0 flex-col overflow-hidden",
					props.fillHeight ? "h-full" : "h-dvh",
				]}
				ref={listen("keydown", editorKeyDown, true)}
				onCopy={clipboard.onCopy}
				onCut={clipboard.onCut}
				onPaste={clipboard.onPaste}
			>
				<Dynamic component={props.splitPane ? "h2" : "h1"} class="sr-only">
					{sheetless()
						? `${editorKind()} editor · ${props.board?.file.name ?? props.footprintName ?? props.symbolName}`
						: `Schematic editor · ${props.drawingName ? `${props.drawingName} · ` : ""}${pages().length > 1 ? `${page().name} (page ${pageIndex() + 1} of ${pages().length}) · ` : ""}${sheet().name ? `${sheet().name} · ` : ""}${formatInches(sheet().width)} × ${formatInches(sheet().height)} in`}
				</Dynamic>
				<Show when={!props.splitPane}>
					{inWorkspace ? (
						<DocumentBar
							icon={
								isBoard()
									? Grid2x2
									: isFootprint()
										? Cpu
										: sheetless()
											? Component
											: CircuitBoard
							}
							title={
								props.board?.file.name ??
								props.footprintName ??
								props.symbolName ??
								props.drawingName
							}
							selection={props.documentSelection}
							view={isBoard() ? "pcb" : undefined}
							center={pageBar(false)}
							active={active()}
						>
							{props.headerControls ?? props.viewSwitch}
						</DocumentBar>
					) : (
						<EditorHeader headerControls={props.headerControls} />
					)}
				</Show>
				<div class="relative flex min-h-0 flex-1">
					<div
						ref={[
							(element: HTMLDivElement) => setCanvasArea(element),
							gestures.pointerRef,
							listen("keydown", canvasKeyDown, true),
						]}
						class={[
							"relative min-w-0 flex-1 touch-none",
							sheetless() ? "bg-paper" : "bg-desk",
							{
								"[&_canvas]:cursor-grab": tool() === "pan",
								"[&_canvas]:cursor-crosshair":
									tool() !== "pan" && tool() !== "select",
							},
						]}
						data-tool={tool()}
						data-view={
							isFootprint()
								? boardView() === "closed"
									? "2d"
									: "3d"
								: undefined
						}
					>
						{isFootprint() && (
							<Keyed key={boardMount()}>
								<FootprintBoardView
									shapes={boardShapes()}
									regions={isBoard() ? boardEditor.fills : undefined}
									ariaLabel={`${editorKind()} editor`}
									controlsLabel={`${editorKind()} tools`}
									hiddenLayers={layers.hidden}
									focusedLayer={layers.focused}
									copperLayers={isBoard() ? copperLayerCount() : undefined}
									flat={boardView() !== "open"}
									onFlatChange={showBoardFlat}
									realistic={realisticBoard()}
									models={modelPlacements()}
									onModelError={reportModelError}
									maskMargin={
										isBoard() ? boardEditor.rules?.solderMaskMargin : undefined
									}
									orbitGesture="alt-shift"
									updateFlatScene={updateScene()}
									cameraState={viewport.cameraState}
									pixelsPerMmAt100={footprintPixelsPerMmAt100}
									fitZoom={1.1}
									getFitBounds={getFootprintFitBounds}
									onBuildError={reportBoardBuild}
									onError={reportBoardError}
									onReady={viewport.onReady}
									onChange={cameraView.update}
									controls={toolbar()}
									rulerUnit={gridUnit()}
									interactionHint={footprintInteractionHint}
								/>
							</Keyed>
						)}
						{!isFootprint() && (
							<Viewer2D
								projection="orthographic"
								lockProjection
								focusOutline={false}
								rulerUnit={gridUnit()}
								scene={drawingScene.scene}
								cameraState={viewport.cameraState}
								fitZoom={1.1}
								physicalSizeZoom
								getFitBounds={getDrawingFitBounds}
								groupedControls
								controlsLabel={`${editorKind()} tools`}
								gridBounds={gridBounds()}
								updateScene={updateScene()}
								selectionEnabled={false}
								onReady={viewport.onReady}
								onError={viewport.onError}
								onChange={cameraView.update}
								extraControls={toolbar()}
								ariaLabel={`${editorKind()} editor`}
								interactionHint={editorInteractionHint}
							/>
						)}
						<CanvasOverlay
							cameraView={cameraView}
							tool={tool()}
							shapes={shapes()}
							selected={selection.selected}
							selectedSymbol={selection.selectedSymbol}
							selectedChild={selection.selectedChild}
							handles={selection.handles}
							guideCenter={guideCenter()}
							canvasArea={canvasArea()}
							connectionHover={gestures.connectionHover}
							marquee={gestures.marquee}
							placementPreview={gestures.placementPreview}
							layered={isFootprint() && realisticBoard()}
						/>
						<EditorMessages
							{...messages}
							besidePanel={isFootprint() || (ercOpen() && !sheetless())}
						/>
						{isFootprint() && (
							<FootprintLayerPanel
								layers={layers.layers}
								active={layers.active}
								hidden={layers.hidden}
								itemCounts={layerItemCounts()}
								focused={layers.focused}
								onSelect={layers.select}
								onToggle={toggleLayer}
								compact={props.splitPane}
								realistic={{
									shown: realisticBoard(),
									onToggle: () => setRealisticBoard((shown) => !shown),
								}}
								models={{
									shown: modelsShown(),
									onToggle: () => setModelsShown((shown) => !shown),
								}}
							/>
						)}
						{isBoard() && boardEditor.rules && (
							<BoardStatus
								unrouted={boardEditor.unrouted}
								failed={boardEditor.analysisError !== ""}
								layer={layers.active}
							/>
						)}
						{isBoard() && boardPanel() === "checks" && (
							<BoardChecksPanel
								revision={committedShapes()}
								unit={unit()}
								run={boardEditor.runChecks}
								onClose={() => setBoardPanel(null)}
								onSelect={(finding) => {
									if (!finding.shapeIds.length) return;
									gestures.finishDrag(true);
									session.reveal(new Set(finding.shapeIds));
								}}
							/>
						)}
						<Show
							when={
								isBoard() &&
								boardPanel() === "setup" &&
								props.board &&
								boardEditor.rules
							}
						>
							{(rules) => (
								<BoardSetupPanel
									rules={rules()}
									shapes={committedShapes()}
									unit={unit()}
									onChange={(next) => props.board?.rules.set(next)}
									onClose={() => setBoardPanel(null)}
								/>
							)}
						</Show>
						{inWorkspace && !props.splitPane
							? undefined
							: pageBar(props.splitPane ? "pane" : true)}
						{ercOpen() && !sheetless() && (
							<Loading
								fallback={
									<FloatingPanel
										label="Electrical rules check"
										as="section"
										position="top-left"
										raised
									>
										<output class="p-3 text-xs text-fg-muted">
											Loading electrical checks...
										</output>
									</FloatingPanel>
								}
							>
								<SchematicErcPanel
									shapes={resolvedShapes()}
									definitions={symbolLibrary.definitions}
									onClose={() => {
										setErcOpen(false);
										focusCanvas();
									}}
									onSelect={(ids) => {
										// A finding can point at a locked symbol. Allow selecting
										// locked items, as the toolbar toggle does, so it shows.
										if (
											!allowLocked() &&
											resolvedShapes().some(
												(shape) => ids.has(shape.id) && shape.locked,
											)
										) {
											gestures.finishDrag(true);
											session.setAllowLocked(true);
										}
										session.reveal(ids);
									}}
								/>
							</Loading>
						)}
						<CursorReadout
							ready={ready()}
							cameraView={cameraView}
							canvasArea={canvasArea()}
							unit={gridUnit()}
							layer={isFootprint() ? layers.active : undefined}
							besideAxes={boardView() !== "closed"}
						/>
					</div>
					{attributesShown() && (
						<SelectionAttributes
							shapes={attributeShapes()}
							isSymbolChild={selection.selectedChild !== undefined}
							symbolTextMoved={childTextMoved()}
							readOnly={selection.selectedChildFixed}
							onEdit={editAttributes}
							onEditSymbol={
								definitionEditing.editTarget ? editSymbol : undefined
							}
							onCopySymbol={definitionEditing.copyToProject}
							onCreateSymbol={
								sheetless() ? undefined : () => setCreatingSymbol(true)
							}
							allowNetEdits={!sheetless()}
							footprint={isFootprint()}
							footprintChoices={footprintChoices()}
							hiddenLayers={layers.hidden}
							layers={layers.layers}
							boardNets={boardNets()}
							unit={unit()}
							snapStep={
								selection.selectedChild
									? gridStep() /
										(selection.selectedChild.shape.kind === "text" ? 10 : 1)
									: selection.selectionSnapStep
							}
							onClear={() => session.select(new Set())}
							textFocusId={textFocusId()}
							onTextFocus={() => setTextFocusId(null)}
						/>
					)}
				</div>
				{settingsOpen() && !sheetless() && (
					<SchematicSettingsDialog
						sheet={sheetSettings()}
						onSave={saveSheet}
						onClose={() => setSettingsOpen(false)}
					/>
				)}
				{creatingSymbol() && (
					<CreateSymbolDialog
						onClose={() => setCreatingSymbol(false)}
						onCreate={commands.createSelectionSymbol}
					/>
				)}
			</main>
		);
	};

	return (
		<Show when={definitionEditing.editingDefinition} fallback={editorView()}>
			{(target) => (
				<LibrarySymbolEditor
					target={target()}
					onClose={() => definitionEditing.setEditingDefinition(null)}
				/>
			)}
		</Show>
	);
}

function LibrarySymbolEditor(props: {
	target: SymbolEditTarget;
	onClose: () => void;
}) {
	const symbol = useLibrarySymbolSave(() => props.target);
	return (
		<EditorCanvas
			store={symbol.store}
			symbolName={props.target.file.name}
			headerControls={
				<>
					<button
						type="button"
						class="ui-button"
						data-variant="secondary"
						disabled={symbol.saving}
						onClick={() =>
							void symbol
								.save()
								.then(props.onClose)
								.catch(() => undefined)
						}
					>
						<ArrowLeft size={14} aria-hidden="true" />
						Back to schematic
					</button>
					<SymbolAttributesButton
						attributes={symbol.attributes}
						onSave={symbol.changeAttributes}
					/>
					<Show when={symbol.error}>
						<p
							role="alert"
							class="m-0 max-w-md truncate text-xs text-danger"
							title={symbol.error}
						>
							{symbol.error}
						</p>
					</Show>
				</>
			}
		/>
	);
}
