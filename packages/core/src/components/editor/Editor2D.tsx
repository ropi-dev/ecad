import { setPagesEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
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
	formatInches,
	SCHEMATIC_STEP,
} from "@ecad/drawing-core/drawing/units.ts";
import { ArrowLeft, CircuitBoard, Component } from "lucide-react";
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
import { CanvasOverlay } from "#/components/editor/CanvasOverlay.tsx";
import { CreateSymbolDialog } from "#/components/editor/CreateSymbolDialog.tsx";
import { CursorReadout } from "#/components/editor/CursorReadout.tsx";
import {
	EditorMessages,
	useEditorMessages,
} from "#/components/editor/EditorMessages.tsx";
import { EditorToolbar } from "#/components/editor/EditorToolbar.tsx";
import { editorInteractionHint } from "#/components/editor/editorInteractionHint.ts";
import {
	handleCanvasKeyDown,
	handleEditorShortcut,
} from "#/components/editor/editorKeyHandlers.ts";
import { editorIssues } from "#/components/editor/editorMessages.ts";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { PageBar, type PageEdit } from "#/components/editor/PageBar.tsx";
import { SelectionAttributes } from "#/components/editor/SelectionAttributes.tsx";
import { fitTextShapes } from "#/components/editor/text.ts";
import {
	type CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { useDrawingClipboard } from "#/components/editor/useDrawingClipboard.ts";
import { useEditorCommands } from "#/components/editor/useEditorCommands.ts";
import { useEditorScene } from "#/components/editor/useEditorScene.ts";
import {
	selectionFitBounds,
	useEditorSelection,
} from "#/components/editor/useEditorSelection.ts";
import { useEditorViewport } from "#/components/editor/useEditorViewport.ts";
import { useLegacyWireReroute } from "#/components/editor/useLegacyWireReroute.ts";
import { useLibrarySymbolSave } from "#/components/editor/useLibrarySymbolSave.ts";
import { useSchematicSelectionSync } from "#/components/editor/useSchematicSelectionSync.ts";
import { useSymbolDefinitionEditing } from "#/components/editor/useSymbolDefinitionEditing.ts";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { OrthographicViewer2D } from "#/components/viewer/OrthographicViewer2D.tsx";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type { SelectionEdit } from "#/drawing/selection-edit.ts";
import { resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { defaultSheet, type SheetSize } from "#/drawing/worksheet.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import { EditorDocument } from "#/projects/EditorDocument.tsx";
import { EditorHeader } from "#/projects/EditorHeader.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
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

export type EditorCanvasProps = Editor2DProps & {
	symbolName?: string;
	drawingName?: string;
	headerControls?: ReactNode;
	viewSwitch?: ReactNode;
	/** Id of the open file among the project's file selections. */
	documentSelection?: string;
	syncSelection?: boolean;
};

export function Editor2D(props: Editor2DProps = {}) {
	return <EditorDocument {...props} Canvas={EditorCanvas} />;
}

function EditorCanvas({
	sheet = defaultSheet,
	store: suppliedStore,
	enableMcp = true,
	symbolName,
	drawingName,
	headerControls,
	viewSwitch,
	documentSelection,
	syncSelection = false,
}: EditorCanvasProps) {
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
	const viewport = useEditorViewport(store);
	const { cameraView, gridStep, ready } = viewport;
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
			resolveDrawingSymbols(fitTextShapes(shapes), definitions, byReference)
				.shapes,
		[definitions, byReference],
	);
	const resolved = useMemo(
		() =>
			resolveDrawingSymbols(
				fitTextShapes(drawing.shapes),
				definitions,
				byReference,
			),
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
			isSymbol
				? sheet
				: {
						...sheet,
						page: {
							name: page.name,
							number: pageIndex + 1,
							count: pages.length,
						},
					},
		[isSymbol, sheet, page.name, pageIndex, pages.length],
	);
	const shapes = editor.draft ?? pageShapes;
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
		isSymbol,
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
		connectionHover,
		finishDrag,
		finishWire,
		pointerHandlers,
	} = gestures;
	const previews = useMemo(
		() => wirePreview ?? (placementPreview ? [placementPreview] : []),
		[wirePreview, placementPreview],
	);
	const { scene, updateScene } = useEditorScene(
		shapes,
		selectedIds,
		previews,
		isSymbol ? null : pageSheet,
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

	const cancelGestures = useEffectEvent(() => {
		finishDrag(true);
		finishWire();
	});
	useEffect(() => session.connect(store, cancelGestures), [session, store]);
	useSchematicSelectionSync({
		enabled: syncSelection,
		store,
		session,
		selection: selectedIds,
		childKey: selectedChildKey,
	});

	const rerouteNotice = useLegacyWireReroute({
		store,
		session,
		isSymbol,
		ready: symbolLibrary.ready,
		resolved,
	});
	const issues = editorIssues([
		viewport.viewerError,
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
		target: isSymbol ? "symbol" : "drawing",
		pasteStep: gridStep || SCHEMATIC_STEP,
		beforePaste: () => {
			finishWire();
			setTool("select");
			clearPlacementPreview();
		},
	});

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
	const childTextMoved =
		!!selectedSymbol &&
		selectedChild?.shape.kind === "text" &&
		symbolTextMoved(selectedSymbol, selectedChild.key);
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
				onCreateSymbol={isSymbol ? undefined : () => setCreatingSymbol(true)}
				allowNetEdits={!isSymbol}
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
			symbolPath,
			suppliedStore,
			definitionId,
			project,
			isSymbol,
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
		!isSymbol && scene ? (
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

	return (
		<main
			className="relative flex h-dvh flex-col overflow-hidden"
			{...clipboard}
			onKeyDownCapture={(event) =>
				handleEditorShortcut(event, {
					dialogOpen: creatingSymbol,
					ready,
					session,
					canRotatePlacement,
					clearPlacementPreview,
					setTool,
					rotateItems,
					undo,
					redo,
				})
			}
		>
			<h1 className="sr-only">
				{isSymbol
					? `Symbol editor · ${symbolName}`
					: `Schematic editor · ${drawingName ? `${drawingName} · ` : ""}${pages.length > 1 ? `${page.name} (page ${pageIndex + 1} of ${pages.length}) · ` : ""}${sheet.name ? `${sheet.name} · ` : ""}${formatInches(sheet.width)} × ${formatInches(sheet.height)} in`}
			</h1>
			{registerEditor ? (
				<DocumentBar
					icon={isSymbol ? Component : CircuitBoard}
					title={isSymbol ? symbolName : drawingName}
					selection={documentSelection}
					center={pageBar(false)}
				>
					{headerControls ?? viewSwitch}
				</DocumentBar>
			) : (
				<EditorHeader
					headerControls={headerControls}
					enableMcp={enableMcp}
					store={store}
				/>
			)}
			<div className="relative flex min-h-0 flex-1">
				<div
					ref={canvasArea}
					className={`relative min-w-0 flex-1 touch-none ${tool === "pan" ? "[&_canvas]:cursor-grab" : tool === "select" ? "" : "[&_canvas]:cursor-crosshair"}`}
					style={{
						backgroundColor: isSymbol
							? darkSchematicTheme.paper
							: darkSchematicTheme.desk,
					}}
					data-tool={tool}
					{...pointerHandlers}
					onKeyDownCapture={(event) =>
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
						})
					}
				>
					{scene && (
						<OrthographicViewer2D
							rulerUnit="mil"
							scene={scene}
							cameraState={viewport.cameraState}
							fitZoom={1.1}
							physicalSizeZoom
							getFitBounds={() =>
								selectionFitBounds(selected, selectedSymbol, selectedChild)
							}
							groupedControls
							controlsLabel={isSymbol ? "Symbol tools" : "Schematic tools"}
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
							onReady={viewport.onReady}
							onError={viewport.onError}
							onChange={cameraView.update}
							extraControls={
								<EditorToolbar
									shapes={isSymbol ? resolved.shapes : pageShapes}
									sheet={pageSheet}
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
									onErc={
										isSymbol ? undefined : () => setErcOpen((open) => !open)
									}
								/>
							}
							ariaLabel={isSymbol ? "Symbol editor" : "Schematic editor"}
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
					/>
					<EditorMessages {...messages} besidePanel={ercOpen && !isSymbol} />
					{!registerEditor && pageBar(true)}
					{ercOpen && !isSymbol && (
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
					/>
				</div>
				{attributesShown && selectionAttributes}
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
	const { store, save, saving, error } = useLibrarySymbolSave(target);
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
