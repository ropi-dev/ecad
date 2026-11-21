import { Dynamic, type JSX } from "@solidjs/web";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Loading,
	lazy,
	Match,
	omit,
	Show,
	Switch,
} from "solid-js";
import type {
	Editor2DProps,
	EditorCanvasProps,
} from "#/components/editor/Editor2D.tsx";
import { SymbolAttributesButton } from "#/components/editor/SymbolAttributesDialog.tsx";
import { useDrawingFonts } from "#/components/editor/useDrawingFonts.ts";
import { FootprintModelField } from "#/components/footprint/FootprintModelField.tsx";
import { Keyed } from "#/components/ui/Keyed.tsx";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";
import {
	type BoardDocument,
	type CircuitDocument,
	type DrawingDocument,
	type EditorViews,
	type SymbolDocument,
	useProjectActions,
	useProjectEditor,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import type {
	EditorView,
	FootprintDocument,
} from "#/projects/ProjectSession.ts";
import {
	SplitDivider,
	type SplitLayout,
	SplitPaneHeader,
	SplitWorkspaceBar,
} from "#/projects/SplitViewBar.tsx";

const WorkspaceStart = lazy(() => import("#/projects/WorkspaceStart.tsx"), {
	export: "WorkspaceStart",
});
const CircuitEditor = lazy(
	() => import("#/components/circuit/CircuitEditor.tsx"),
	{ export: "CircuitEditor" },
);

const pauseMs = 1000;
const inputEvents = ["pointerdown", "keydown", "wheel"] as const;

const whenPaused = (run: () => void) => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let idle: number | undefined;
	const cancel = () => {
		clearTimeout(timer);
		if (idle !== undefined) cancelIdleCallback(idle);
		idle = undefined;
	};
	const schedule = () => {
		cancel();
		timer = setTimeout(() => {
			if (typeof requestIdleCallback === "function")
				idle = requestIdleCallback(finish);
			else finish();
		}, pauseMs);
	};
	const finish = () => {
		stop();
		run();
	};
	const longTasks =
		typeof PerformanceObserver === "function" &&
		PerformanceObserver.supportedEntryTypes?.includes("longtask")
			? new PerformanceObserver(schedule)
			: undefined;
	const stop = () => {
		cancel();
		longTasks?.disconnect();
		for (const type of inputEvents)
			window.removeEventListener(type, schedule, true);
	};
	for (const type of inputEvents)
		window.addEventListener(type, schedule, { capture: true, passive: true });
	longTasks?.observe({ type: "longtask" });
	schedule();
	return stop;
};

function PreloadEditorViews() {
	const project = useProjectSelection(
		({
			project,
			editorSymbol,
			editorFootprint,
			editorBoard,
			editorDrawing,
			editorCircuit,
			preloadEditorViews,
		}) => ({
			project,
			editorSymbol,
			editorFootprint,
			editorBoard,
			editorDrawing,
			editorCircuit,
			preloadEditorViews,
		}),
	);
	createEffect(
		() => project(),
		(current) => {
			if (!current?.project) return;
			const { preloadEditorViews } = current;
			return whenPaused(() => void preloadEditorViews().catch(() => undefined));
		},
	);
	return null;
}

function EditorPane(props: {
	view: EditorView;
	active: boolean;
	split: boolean;
	focused: boolean;
	placement?: { column?: string; row?: string };
	onFocusPane: () => void;
	onMaximize: () => void;
	onClose: () => void;
	children: JSX.Element;
}) {
	let pane!: HTMLDivElement;
	createEffect(
		() => ({ active: props.active, split: props.split }),
		({ active, split }, previous) => {
			const opened = active && previous?.active === false;
			if (!opened || split) return;
			const focused = document.activeElement;
			if (focused && focused !== document.body && !focused.closest("[inert]"))
				return;
			quietFocus(
				pane.querySelector<HTMLElement>(
					'[aria-label="Editor view"] [aria-pressed="true"]',
				),
			);
		},
	);
	return (
		<div
			ref={(element) => {
				pane = element;
				element.addEventListener(
					"pointerdown",
					() => {
						if (props.split && !props.focused) props.onFocusPane();
					},
					{ capture: true },
				);
			}}
			style={
				props.active && props.placement
					? {
							"grid-column": props.placement.column,
							"grid-row": props.placement.row,
						}
					: undefined
			}
			class={[
				"flex min-h-0 min-w-0 flex-col overflow-hidden",
				props.active ? "relative h-full w-full" : "invisible absolute inset-0",
				{ "[--chrome-bar:0px]": props.split },
			]}
			inert={!props.active}
			data-editor-pane={props.active ? "active" : "hidden"}
			data-pane-view={props.view}
			data-focused={props.focused ? "true" : "false"}
			data-split={props.split ? "true" : undefined}
			data-shortcut-scope={props.split && !props.focused ? "none" : undefined}
			onFocusIn={() => {
				if (props.split && !props.focused) props.onFocusPane();
			}}
		>
			<Show when={props.split}>
				<SplitPaneHeader
					view={props.view}
					focused={props.focused}
					onMaximize={props.onMaximize}
					onClose={props.onClose}
				/>
			</Show>
			<div class="relative min-h-0 flex-1 overflow-hidden">
				{props.children}
			</div>
		</div>
	);
}

function OpeningCircuit() {
	return (
		<output class="block p-6 text-sm text-fg-muted">Opening circuit...</output>
	);
}

function SingleFileControls(props: {
	symbol: SymbolDocument | null;
	footprint: FootprintDocument | null;
}) {
	const actions = useProjectActions();
	return (
		<Switch>
			<Match when={props.symbol}>
				{(symbol) => (
					<SymbolAttributesButton
						attributes={symbol().file.attributes}
						onSave={(attributes) =>
							actions()?.saveSymbolAttributes(symbol().file.id, attributes)
						}
					/>
				)}
			</Match>
			<Match when={props.footprint}>
				{(footprint) => (
					<FootprintModelField
						model={footprint().file.model}
						onChange={async (model) => {
							await actions()?.saveFootprintModel(footprint().file.id, model);
						}}
					/>
				)}
			</Match>
		</Switch>
	);
}

type View = "schematic" | "circuit" | "pcb";

export function EditorDocument(
	props: Editor2DProps & { Canvas: Component<EditorCanvasProps> },
) {
	const project = useProjectEditor();
	const actions = useProjectActions();
	const canvasProps = omit(props, "Canvas");
	// A circuit link opens this route while its circuit is still loading.
	// Showing the schematic for that moment would start its viewer, which
	// then keeps that camera, so wait for the circuit that was opening on
	// arrival. A switch from an open schematic keeps it on screen instead.
	const arrivedOpening = createMemo<number | null>((arrived) =>
		arrived !== undefined ? arrived : (project()?.openingCircuit ?? null),
	);
	// Text sizes are measured with the schematic font, so wait for it to load.
	const fontsReady = useDrawingFonts();
	const state = createMemo(() => {
		const current = project();
		const inProject = !props.store && !!current;
		return {
			inProject,
			mainDrawing: !!current?.mainDrawing,
			openingCircuit: current?.openingCircuit ?? null,
			session: current?.session ?? 0,
			symbol: inProject ? current.editorSymbol : null,
			footprint: inProject ? current.editorFootprint : null,
			board: inProject ? current.editorBoard : null,
			drawing: inProject ? current.editorDrawing : null,
			circuit: inProject ? current.editorCircuit : null,
			activeViews: inProject ? current.editorViews : null,
			splitViews: inProject
				? current.splitViews
				: ([] as readonly EditorView[]),
		};
	});
	const waiting = () => {
		const current = state();
		return (
			current.inProject &&
			!current.circuit &&
			arrivedOpening() !== null &&
			current.openingCircuit === arrivedOpening()
		);
	};
	const showStart = () => {
		const current = state();
		return (
			current.inProject &&
			!current.mainDrawing &&
			!current.symbol &&
			!current.footprint &&
			!current.board &&
			!current.drawing &&
			!current.circuit &&
			current.openingCircuit === null
		);
	};
	const singleKey = () => {
		const { session, symbol, footprint } = state();
		return `${session}:${symbol ? `symbol:${symbol.file.id}` : `footprint:${footprint?.file.id}`}`;
	};
	const activeView = createMemo<View>(() => {
		const { circuit, board } = state();
		return circuit ? "circuit" : board ? "pcb" : "schematic";
	});
	const splitViews = createMemo(() => state().splitViews);
	const isSplit = createMemo(() => splitViews().length >= 2);
	const [splitLayout, setSplitLayout] = createSignal<SplitLayout>("columns");
	const [colSplit2, setColSplit2] = createSignal(0.5);
	const [colSplit3, setColSplit3] = createSignal<
		readonly [number, number, number]
	>([1 / 3, 1 / 3, 1 / 3]);
	const [gridColSplit, setGridColSplit] = createSignal(0.5);
	const [gridRowSplit, setGridRowSplit] = createSignal(0.5);
	let gridEl: HTMLDivElement | undefined;
	const documents = createMemo(() => {
		const { inProject, circuit, board, drawing, activeViews } = state();
		const view = activeView();
		const activeCircuitId =
			circuit?.file.circuit.id ??
			board?.file.circuitId ??
			(view === "schematic" &&
			activeViews &&
			activeViews.schematic === (drawing ?? "main")
				? activeViews.circuitId
				: undefined);
		const views: EditorViews | null =
			inProject &&
			activeCircuitId !== undefined &&
			activeViews?.circuitId === activeCircuitId
				? activeViews
				: null;
		const schematic: DrawingDocument | "main" | null =
			view === "schematic" ? (drawing ?? "main") : (views?.schematic ?? null);
		const circuitDocument: CircuitDocument | null =
			circuit ?? views?.circuit ?? null;
		const boardDocument: BoardDocument | null = board ?? views?.board ?? null;
		return { schematic, circuit: circuitDocument, board: boardDocument };
	});
	const paneVisible = (view: View) =>
		isSplit() ? splitViews().includes(view) : activeView() === view;
	const panes = createMemo(() => {
		const { session } = state();
		const { schematic, circuit, board } = documents();
		const list: { view: View; key: string }[] = [];
		if (schematic)
			list.push({
				view: "schematic",
				key: `${session}:schematic:${schematic === "main" ? "main" : schematic.file.id}`,
			});
		if (circuit)
			list.push({
				view: "circuit",
				key: `${session}:circuit:${circuit.file.circuit.id}`,
			});
		if (board)
			list.push({
				view: "pcb",
				key: `${session}:board:${board.file.circuitId}`,
			});
		if (isSplit()) {
			const visible = splitViews();
			return [
				...list.filter((pane) => visible.includes(pane.view)),
				...list.filter((pane) => !visible.includes(pane.view)),
			];
		}
		const view = activeView();
		return [
			...list.filter((pane) => pane.view === view),
			...list.filter((pane) => pane.view !== view),
		];
	});
	const visibleSplitPanes = createMemo(() => {
		if (!isSplit()) return [] as readonly View[];
		const visible = splitViews();
		return panes()
			.map((pane) => pane.view)
			.filter((view) => visible.includes(view));
	});
	const clamp = (value: number, min: number, max: number) =>
		Math.max(min, Math.min(max, value));
	const gridStyle = createMemo(() => {
		const visible = visibleSplitPanes();
		if (visible.length < 2) {
			return {
				"grid-template-columns": "minmax(0, 1fr)",
				"grid-template-rows": "minmax(0, 1fr)",
			};
		}
		const layout = splitLayout();
		if (visible.length === 2) {
			if (layout === "columns") {
				const r = colSplit2();
				return {
					"grid-template-columns": `minmax(120px, ${r}fr) 1px minmax(120px, ${1 - r}fr)`,
					"grid-template-rows": "minmax(0, 1fr)",
				};
			}
			const r = gridRowSplit();
			return {
				"grid-template-columns": "minmax(0, 1fr)",
				"grid-template-rows": `minmax(120px, ${r}fr) 1px minmax(120px, ${1 - r}fr)`,
			};
		}
		if (layout === "columns") {
			const [f0, f1, f2] = colSplit3();
			return {
				"grid-template-columns": `minmax(120px, ${f0}fr) 1px minmax(120px, ${f1}fr) 1px minmax(120px, ${f2}fr)`,
				"grid-template-rows": "minmax(0, 1fr)",
			};
		}
		const c = gridColSplit();
		const r = gridRowSplit();
		return {
			"grid-template-columns": `minmax(120px, ${c}fr) 1px minmax(120px, ${1 - c}fr)`,
			"grid-template-rows": `minmax(120px, ${r}fr) 1px minmax(120px, ${1 - r}fr)`,
		};
	});
	const panePlacement = (view: View) => {
		const visible = visibleSplitPanes();
		if (visible.length < 2) return undefined;
		const index = visible.indexOf(view);
		if (index < 0) return undefined;
		const layout = splitLayout();
		if (visible.length === 2) {
			return layout === "columns"
				? { column: index === 0 ? "1" : "3", row: "1" }
				: { column: "1", row: index === 0 ? "1" : "3" };
		}
		if (layout === "columns") {
			return {
				column: index === 0 ? "1" : index === 1 ? "3" : "5",
				row: "1",
			};
		}
		if (index === 0) return { column: "1", row: "1 / 4" };
		if (index === 1) return { column: "3", row: "1" };
		return { column: "3", row: "3" };
	};
	const dividers = createMemo(() => {
		const visible = visibleSplitPanes();
		if (visible.length < 2) return [];
		const layout = splitLayout();
		const widthOf = (count: number) =>
			Math.max(1, (gridEl?.clientWidth ?? innerWidth) - count);
		const heightOf = () =>
			Math.max(1, (gridEl?.clientHeight ?? innerHeight) - 1);
		if (visible.length === 2) {
			if (layout === "columns") {
				const step = (delta: number) =>
					setColSplit2((current) => clamp(current + delta, 0.2, 0.8));
				return [
					{
						key: "col-2",
						orientation: "vertical" as const,
						value: colSplit2(),
						column: "2",
						row: "1",
						onResize: (deltaPx: number) => step(deltaPx / widthOf(1)),
						onStep: step,
						onReset: () => setColSplit2(0.5),
					},
				];
			}
			const step = (delta: number) =>
				setGridRowSplit((current) => clamp(current + delta, 0.2, 0.8));
			return [
				{
					key: "row-2",
					orientation: "horizontal" as const,
					value: gridRowSplit(),
					column: "1",
					row: "2",
					onResize: (deltaPx: number) => step(deltaPx / heightOf()),
					onStep: step,
					onReset: () => setGridRowSplit(0.5),
				},
			];
		}
		if (layout === "columns") {
			const stepLeft = (delta: number) =>
				setColSplit3(([f0, f1, f2]) => {
					const d = clamp(delta, 0.15 - f0, f1 - 0.15);
					return [f0 + d, f1 - d, f2];
				});
			const stepRight = (delta: number) =>
				setColSplit3(([f0, f1, f2]) => {
					const d = clamp(delta, 0.15 - f1, f2 - 0.15);
					return [f0, f1 + d, f2 - d];
				});
			const [f0, f1] = colSplit3();
			return [
				{
					key: "col-3-left",
					orientation: "vertical" as const,
					value: f0,
					column: "2",
					row: "1",
					onResize: (deltaPx: number) => stepLeft(deltaPx / widthOf(2)),
					onStep: stepLeft,
					onReset: () => setColSplit3([1 / 3, 1 / 3, 1 / 3]),
				},
				{
					key: "col-3-right",
					orientation: "vertical" as const,
					value: f0 + f1,
					column: "4",
					row: "1",
					onResize: (deltaPx: number) => stepRight(deltaPx / widthOf(2)),
					onStep: stepRight,
					onReset: () => setColSplit3([1 / 3, 1 / 3, 1 / 3]),
				},
			];
		}
		const stepCol = (delta: number) =>
			setGridColSplit((current) => clamp(current + delta, 0.2, 0.8));
		const stepRow = (delta: number) =>
			setGridRowSplit((current) => clamp(current + delta, 0.2, 0.8));
		return [
			{
				key: "grid-col",
				orientation: "vertical" as const,
				value: gridColSplit(),
				column: "2",
				row: "1 / 4",
				onResize: (deltaPx: number) => stepCol(deltaPx / widthOf(1)),
				onStep: stepCol,
				onReset: () => setGridColSplit(0.5),
			},
			{
				key: "grid-row",
				orientation: "horizontal" as const,
				value: gridRowSplit(),
				column: "3",
				row: "2",
				onResize: (deltaPx: number) => stepRow(deltaPx / heightOf()),
				onStep: stepRow,
				onReset: () => setGridRowSplit(0.5),
			},
		];
	});
	const schematicDocument = () => {
		const schematic = documents().schematic;
		return schematic === "main" ? null : schematic;
	};
	const splitSelection = () => {
		const { schematic, circuit, board } = documents();
		if (schematic === "main") return "drawing";
		if (schematic) return `drawing:${schematic.file.id}`;
		if (circuit) return `circuit:${circuit.file.circuit.id}`;
		if (board) return `board:${board.file.circuitId}`;
		return undefined;
	};
	const splitTitle = () =>
		schematicDocument()?.file.name ??
		documents().circuit?.file.circuit.name ??
		documents().board?.file.name;
	return (
		<Show when={fontsReady()}>
			<Switch
				fallback={
					<div class="relative flex h-dvh flex-col overflow-hidden">
						{state().inProject && <PreloadEditorViews />}
						<Show when={isSplit()}>
							<SplitWorkspaceBar
								focusedView={activeView()}
								views={splitViews()}
								layout={splitLayout()}
								onLayoutChange={setSplitLayout}
								selection={splitSelection()}
								title={splitTitle()}
							/>
						</Show>
						<div
							ref={gridEl}
							class="relative grid min-h-0 flex-1 overflow-hidden"
							style={gridStyle()}
						>
							<For each={panes()} keyed={(pane) => pane.key}>
								{(pane) => (
									<EditorPane
										view={pane().view}
										active={paneVisible(pane().view)}
										split={isSplit()}
										focused={activeView() === pane().view}
										placement={panePlacement(pane().view)}
										onFocusPane={() => actions()?.focusSplitView(pane().view)}
										onMaximize={() =>
											void actions()?.setSplitEditorViews([pane().view])
										}
										onClose={() =>
											void actions()?.setSplitEditorViews(
												splitViews().filter((view) => view !== pane().view),
											)
										}
									>
										<Switch>
											<Match when={pane().view === "schematic"}>
												<Dynamic
													component={props.Canvas}
													{...canvasProps}
													active={paneVisible("schematic")}
													splitPane={isSplit()}
													fillHeight
													store={
														documents().schematic === "main"
															? props.store
															: schematicDocument()?.store
													}
													drawingName={schematicDocument()?.file.name}
													documentSelection={
														props.store
															? undefined
															: documents().schematic === "main"
																? "drawing"
																: `drawing:${schematicDocument()?.file.id}`
													}
													viewSwitch={
														props.store ? undefined : (
															<EditorViewSwitch view="schematic" />
														)
													}
													syncSelection={!props.store}
												/>
											</Match>
											<Match
												when={pane().view === "circuit" && documents().circuit}
											>
												{(circuit) => (
													<Loading
														fallback={
															<Show when={paneVisible("circuit")}>
																<OpeningCircuit />
															</Show>
														}
													>
														<CircuitEditor
															document={circuit()}
															active={paneVisible("circuit")}
															splitPane={isSplit()}
														/>
													</Loading>
												)}
											</Match>
											<Match when={pane().view === "pcb" && documents().board}>
												{(board) => (
													<Dynamic
														component={props.Canvas}
														{...canvasProps}
														active={paneVisible("pcb")}
														splitPane={isSplit()}
														fillHeight
														store={board().store}
														board={board()}
														documentSelection={`board:${board().file.circuitId}`}
														viewSwitch={<EditorViewSwitch view="pcb" />}
														syncSelection
													/>
												)}
											</Match>
										</Switch>
									</EditorPane>
								)}
							</For>
							<For each={dividers()} keyed={(divider) => divider.key}>
								{(divider) => (
									<SplitDivider
										orientation={divider().orientation}
										value={divider().value}
										column={divider().column}
										row={divider().row}
										onResize={divider().onResize}
										onStep={divider().onStep}
										onReset={divider().onReset}
									/>
								)}
							</For>
						</div>
					</div>
				}
			>
				<Match when={waiting()}>
					<OpeningCircuit />
				</Match>
				<Match when={showStart()}>
					<Loading fallback={null}>
						<WorkspaceStart />
					</Loading>
				</Match>
				<Match when={state().symbol || state().footprint}>
					<Show when={state().inProject}>
						<PreloadEditorViews />
					</Show>
					<Keyed key={singleKey()}>
						<Dynamic
							component={props.Canvas}
							{...canvasProps}
							store={state().symbol?.store ?? state().footprint?.store}
							symbolName={state().symbol?.file.name}
							headerControls={
								actions() ? (
									<SingleFileControls
										symbol={state().symbol}
										footprint={state().footprint}
									/>
								) : undefined
							}
							footprintName={state().footprint?.file.name}
							footprintModel={state().footprint?.file.model}
							documentSelection={
								state().symbol
									? `symbol:${state().symbol?.file.id}`
									: `footprint:${state().footprint?.file.id}`
							}
						/>
					</Keyed>
				</Match>
			</Switch>
		</Show>
	);
}
