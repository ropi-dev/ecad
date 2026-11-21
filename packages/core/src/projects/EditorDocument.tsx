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
	untrack,
} from "solid-js";
import type {
	Editor2DProps,
	EditorCanvasProps,
} from "#/components/editor/Editor2D.tsx";
import { SymbolAttributesButton } from "#/components/editor/SymbolAttributesDialog.tsx";
import { useDrawingFonts } from "#/components/editor/useDrawingFonts.ts";
import { FootprintModelField } from "#/components/footprint/FootprintModelField.tsx";
import { CircuitBoard, Grid2x2, Workflow } from "#/components/ui/icons.tsx";
import { Keyed } from "#/components/ui/Keyed.tsx";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import { fromExternalStore } from "#/lib/external-store.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import {
	type EditorSplitControls,
	EditorViewSwitch,
} from "#/projects/EditorViewSwitch.tsx";
import {
	type BoardDocument,
	type CircuitDocument,
	type DrawingDocument,
	type EditorViews,
	type SymbolDocument,
	useProjectActions,
	useProjectEditor,
	useProjectSelection,
	useProjectSnapshot,
} from "#/projects/ProjectProvider.tsx";
import type {
	EditorView,
	FootprintDocument,
} from "#/projects/ProjectSession.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import { projectIndex } from "#/projects/project-index.ts";
import {
	closeSplitPane,
	equalSplitSizes,
	normalizeSplitPanes,
	openThreePaneSplit,
	openTwoPaneSplit,
	resizeSplitSizes,
	switchPaneView,
} from "#/projects/split-layout.ts";
import { updateAppSettings, useAppSettings } from "#/settings/store.ts";

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

interface PaneProps {
	view: View;
	focused: boolean;
	visible: boolean;
	split: boolean;
	order: number;
	size: number;
	onFocus: () => void;
	children: JSX.Element;
}

function EditorPane(props: PaneProps) {
	let pane!: HTMLDivElement;
	createEffect(
		() => props.focused,
		(focused, previous) => {
			const opened = focused && previous === false;
			const current = document.activeElement;
			if (
				!opened ||
				(current && current !== document.body && !current.closest("[inert]"))
			)
				return;
			quietFocus(
				pane.querySelector<HTMLElement>(
					'[aria-label="Editor view"] [aria-pressed="true"]',
				),
			);
		},
	);
	const claim = () => {
		if (props.visible && !props.focused) props.onFocus();
	};
	return (
		<div
			ref={(element) => {
				pane = element;
				element.addEventListener("pointerdown", claim, { capture: true });
				element.addEventListener("focusin", claim);
			}}
			class={
				props.visible
					? [
							"@container relative h-full min-h-0 min-w-0 overflow-hidden",
							{
								"after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:z-10 after:h-0.5 after:bg-accent":
									props.split && props.focused,
							},
						]
					: "pointer-events-none invisible absolute inset-0"
			}
			style={
				props.visible
					? { order: String(props.order), flex: `${props.size} 1 0%` }
					: undefined
			}
			inert={!props.visible}
			data-editor-pane={
				props.focused ? "active" : props.visible ? "visible" : "hidden"
			}
			data-editor-view={props.view}
			data-shortcut-scope={props.focused ? undefined : "none"}
		>
			{props.children}
		</div>
	);
}

const resizeStep = 0.05;

function SplitDivider(props: {
	order: number;
	stacked: boolean;
	value: number;
	onDragStart: () => (delta: number) => void;
	onStep: (delta: number) => void;
	onReset: () => void;
}) {
	const [dragging, setDragging] = createSignal(false);
	let drag: { start: number; move: (delta: number) => void } | undefined;
	const position = (event: PointerEvent) =>
		props.stacked ? event.clientY : event.clientX;
	return (
		// biome-ignore lint/a11y/useSemanticElements: an hr cannot be dragged or focused
		// biome-ignore lint/a11y/useFocusableInteractive: Biome does not read Solid's lowercase tabindex
		<div
			role="separator"
			aria-orientation={props.stacked ? "horizontal" : "vertical"}
			aria-label="Resize panes"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(props.value * 100)}
			tabindex={0}
			data-dragging={dragging() ? "true" : "false"}
			class={[
				"group relative z-20 flex shrink-0 touch-none items-stretch justify-center outline-none",
				props.stacked
					? "-my-[3.5px] h-2 w-full cursor-row-resize flex-col"
					: "-mx-[3.5px] h-full w-2 cursor-col-resize",
			]}
			style={{ order: String(props.order) }}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag = { start: position(event), move: props.onDragStart() };
				setDragging(true);
			}}
			onPointerMove={(event) => {
				if (drag) drag.move(position(event) - drag.start);
			}}
			onPointerUp={() => {
				drag = undefined;
				setDragging(false);
			}}
			onLostPointerCapture={() => {
				drag = undefined;
				setDragging(false);
			}}
			onDblClick={() => props.onReset()}
			onKeyDown={(event) => {
				const back = props.stacked ? "ArrowUp" : "ArrowLeft";
				const forward = props.stacked ? "ArrowDown" : "ArrowRight";
				if (event.key !== back && event.key !== forward) return;
				event.preventDefault();
				props.onStep(event.key === back ? -resizeStep : resizeStep);
			}}
		>
			<span
				aria-hidden="true"
				class={[
					"pointer-events-none bg-line transition-colors group-hover:bg-accent group-focus-visible:bg-accent group-data-[dragging=true]:bg-accent",
					props.stacked ? "h-px w-full" : "h-full w-px",
				]}
			/>
		</div>
	);
}

function PlaceholderPane(props: {
	view: "circuit" | "pcb" | "schematic";
	title?: string;
	clearSidebar: boolean;
	split: boolean;
	viewSwitch: JSX.Element;
	children: JSX.Element;
}) {
	return (
		<section
			class="@container relative flex h-full min-h-0 flex-col overflow-hidden bg-desk"
			aria-label={`${props.view === "pcb" ? "PCB" : props.view === "circuit" ? "Circuit" : "Schematic"} view`}
		>
			<DocumentBar
				icon={
					props.view === "pcb"
						? Grid2x2
						: props.view === "circuit"
							? Workflow
							: CircuitBoard
				}
				title={props.title}
				view={props.view === "schematic" ? undefined : props.view}
				active={false}
				clearSidebar={props.clearSidebar}
				split={props.split}
			>
				{props.viewSwitch}
			</DocumentBar>
			{props.children}
		</section>
	);
}

function BoardPlaceholder(props: { circuitId: string | undefined }) {
	const actions = useProjectActions();
	const [creating, setCreating] = createSignal(false);
	return (
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
			<Grid2x2 size={28} aria-hidden="true" class="text-fg-faint" />
			<h2 class="m-0 text-sm font-semibold text-fg">No PCB yet</h2>
			<p class="m-0 max-w-64 text-xs text-fg-muted">
				Create a board to place this circuit's footprints and route it.
			</p>
			<button
				type="button"
				class="ui-button mt-2"
				data-variant="primary"
				data-size="md"
				disabled={creating() || !props.circuitId}
				onClick={() => {
					const id = props.circuitId;
					const create = actions()?.createCircuitBoard;
					if (!id || !create) return;
					setCreating(true);
					void create(id)
						.catch(() => false)
						.finally(() => setCreating(false));
				}}
			>
				Create PCB
			</button>
		</div>
	);
}

function OpeningCircuit() {
	return (
		<output class="block p-6 text-sm text-fg-muted">Opening circuit...</output>
	);
}

function OpeningView(props: { view: View }) {
	return (
		<output class="block p-6 pt-[calc(var(--chrome-top)+var(--chrome-control)+1rem)] text-sm text-fg-muted">
			{props.view === "pcb"
				? "Opening PCB..."
				: props.view === "circuit"
					? "Opening circuit..."
					: "Opening schematic..."}
		</output>
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

type View = EditorView;
type Pane = {
	view: View;
	key: string;
	kind: "document" | "loading" | "placeholder";
};

const stackedQuery = "(max-width: 640px)";
const minPanePixels = 220;

function useStackedPanes() {
	const media =
		typeof window === "undefined" ? undefined : window.matchMedia(stackedQuery);
	return fromExternalStore(
		(listener) => {
			media?.addEventListener("change", listener);
			return () => media?.removeEventListener("change", listener);
		},
		() => media?.matches ?? false,
	);
}

const savedSplit = (views: readonly View[] | undefined) =>
	views && views.length > 1 ? [...views] : null;

const persistSplit = (views: readonly View[] | null) =>
	void updateAppSettings((current) => {
		const { editorSplit: _previous, ...rest } = current;
		return views ? { ...rest, editorSplit: [...views] } : rest;
	}).catch(() => undefined);

export function EditorDocument(
	props: Editor2DProps & { Canvas: Component<EditorCanvasProps> },
) {
	const project = useProjectEditor();
	const actions = useProjectActions();
	const snapshot = useProjectSnapshot();
	const settings = useAppSettings();
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
			circuitSyncVersion: current?.circuitSyncVersion ?? 0,
			editorNavigation: current?.editorNavigation ?? 0,
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
	const circuitId = createMemo(() => {
		const { inProject, symbol, footprint, circuit, board, drawing } = state();
		if (!inProject || symbol || footprint) return undefined;
		if (circuit) return circuit.file.circuit.id;
		if (board) return board.file.circuitId;
		const current = snapshot();
		if (!current) return undefined;
		const index = projectIndex(current);
		const id = drawing
			? (index.drawingsById.get(drawing.file.id)?.file.circuitId ??
				drawing.file.circuitId)
			: primaryPcbId;
		return id && index.circuitsById.has(id) ? id : undefined;
	});
	const splitAvailable = createMemo(() => {
		const { inProject, symbol, footprint, circuit, board, drawing } = state();
		return (
			inProject &&
			!symbol &&
			!footprint &&
			(!!circuit || !!board || !!drawing || state().mainDrawing)
		);
	});
	const circuitFile = createMemo(() => {
		const id = circuitId();
		const current = snapshot();
		return id && current
			? projectIndex(current).circuitsById.get(id)?.file
			: undefined;
	});
	const hasBoard = createMemo(() => {
		const id = circuitId();
		const current = snapshot();
		return !!id && !!current && projectIndex(current).boardsByCircuit.has(id);
	});
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
	const loaded = (view: View) =>
		!!(view === "pcb"
			? documents().board
			: view === "circuit"
				? documents().circuit
				: documents().schematic);

	const [split, setSplit] = createSignal<View[] | null>(
		savedSplit(untrack(settings).editorSplit),
	);
	const shownDocument = createMemo(
		() =>
			`${state().session}|${state().editorNavigation}|${circuitId() ?? ""}|${activeView()}`,
	);
	const navigation = createMemo<number>((previous) => {
		shownDocument();
		return (previous ?? 0) + 1;
	});
	const [localFocus, setLocalFocus] = createSignal<{
		view: View;
		navigation: number;
	} | null>(null);
	const ownFocus = createMemo<View | null>(() => {
		const local = localFocus();
		return local && local.navigation === navigation() ? local.view : null;
	});
	const focusedView = createMemo<View>(() => ownFocus() ?? activeView());
	const visibleViews = createMemo<View[]>(
		() => {
			const layout = split();
			const focused = focusedView();
			return layout && splitAvailable()
				? normalizeSplitPanes(layout, focused)
				: [focused];
		},
		{
			equals: (a, b) =>
				a.length === b.length && a.every((view, index) => view === b[index]),
		},
	);
	const paneCount = () => visibleViews().length;
	const [sizes, setSizes] = createSignal<number[]>(equalSplitSizes(1));
	const paneSizes = () => {
		const current = sizes();
		return current.length === paneCount()
			? current
			: equalSplitSizes(paneCount());
	};
	const stacked = useStackedPanes();
	let container: HTMLDivElement | undefined;
	const minFraction = () => {
		const extent =
			(stacked() ? container?.clientHeight : container?.clientWidth) ?? 0;
		return extent > 0 ? Math.min(0.45, minPanePixels / extent) : 0.15;
	};
	const focusView = (view: View) => {
		if (view === focusedView()) return;
		if (view === activeView()) {
			setLocalFocus(null);
			return;
		}
		setLocalFocus({ view, navigation: navigation() });
		if (loaded(view)) actions()?.focusEditorView(view);
	};
	const loadedFocus = createMemo<View | null>(() => {
		const view = ownFocus();
		return view && view !== activeView() && loaded(view) ? view : null;
	});
	createEffect(
		() => {
			const view = loadedFocus();
			const focus = actions()?.focusEditorView;
			return view && focus ? { view, focus } : null;
		},
		(pending) => {
			pending?.focus(pending.view);
		},
	);
	const changeLayout = (next: readonly View[], focus: View) => {
		const layout = next.length > 1 ? [...next] : null;
		if (layout?.length !== paneCount()) setSizes(equalSplitSizes(next.length));
		setSplit(layout);
		persistSplit(layout);
		focusView(focus);
	};
	const prepareKey = createMemo(() =>
		(split() || ownFocus()) && splitAvailable()
			? `${state().session}|${circuitId() ?? ""}|${state().circuitSyncVersion}|${visibleViews().join(",")}`
			: null,
	);
	createEffect(
		() => {
			const prepare = actions()?.prepareEditorViews;
			return prepareKey() !== null && prepare
				? { prepare, views: visibleViews() }
				: null;
		},
		(pending) => {
			if (pending) void pending.prepare(pending.views).catch(() => undefined);
		},
	);
	const splitControls = (
		view: View,
		placeholder = false,
	): EditorSplitControls | undefined => {
		if (!splitAvailable()) return undefined;
		const shown = visibleViews();
		const index = shown.indexOf(view);
		return {
			paneCount: shown.length,
			...(placeholder && { onSwitchView: () => setLocalFocus(null) }),
			onSelectView: (target) =>
				changeLayout(switchPaneView(shown, index, target), target),
			onSplitTwo: () =>
				changeLayout(openTwoPaneSplit(view, hasBoard()), focusedView()),
			onSplitThree: () =>
				changeLayout(openThreePaneSplit(shown), focusedView()),
			onFocusOnly: () => changeLayout([view], view),
			onClosePane: () => {
				const next = closeSplitPane(shown, index, focusedView());
				changeLayout(next.panes, next.focused);
			},
		};
	};
	const viewSwitch = (view: View, placeholder = false) => (
		<EditorViewSwitch view={view} split={splitControls(view, placeholder)} />
	);
	const paneIndex = (view: View) => visibleViews().indexOf(view);
	const paneState = (view: View) => {
		const index = paneIndex(view);
		return {
			visible: index >= 0,
			focused: focusedView() === view,
			order: Math.max(0, index) * 2,
			size: paneSizes()[index] ?? 1,
			clearSidebar: index <= 0,
			splitPaneCount: paneCount(),
		};
	};
	const dividers = createMemo(() =>
		Array.from({ length: Math.max(0, paneCount() - 1) }, (_, index) => index),
	);
	const panes = createMemo(() => {
		const { session } = state();
		const { schematic, circuit, board } = documents();
		const shown = visibleViews();
		const id = circuitId() ?? "";
		const list: Pane[] = [];
		if (schematic)
			list.push({
				view: "schematic",
				kind: "document",
				key: `${session}:schematic:${schematic === "main" ? "main" : schematic.file.id}`,
			});
		else if (shown.includes("schematic"))
			list.push({
				view: "schematic",
				kind: "loading",
				key: `${session}:schematic-loading:${id}`,
			});
		if (circuit)
			list.push({
				view: "circuit",
				kind: "document",
				key: `${session}:circuit:${circuit.file.circuit.id}`,
			});
		else if (shown.includes("circuit"))
			list.push({
				view: "circuit",
				kind: "loading",
				key: `${session}:circuit-loading:${id}`,
			});
		if (board)
			list.push({
				view: "pcb",
				kind: "document",
				key: `${session}:board:${board.file.circuitId}`,
			});
		else if (shown.includes("pcb")) {
			const kind = hasBoard() ? "loading" : "placeholder";
			list.push({ view: "pcb", kind, key: `${session}:board-${kind}:${id}` });
		}
		return list;
	});
	const schematicDocument = () => {
		const schematic = documents().schematic;
		return schematic === "main" ? null : schematic;
	};
	const circuitName = () => circuitFile()?.circuit.name;
	return (
		<Show when={fontsReady()}>
			<Switch
				fallback={
					<div
						ref={(element) => {
							container = element;
						}}
						class={[
							"relative flex h-dvh w-full overflow-hidden",
							stacked() ? "flex-col" : "flex-row",
						]}
					>
						{state().inProject && <PreloadEditorViews />}
						<For each={panes()} keyed={(pane) => pane.key}>
							{(pane) => {
								const shown = () => paneState(pane().view);
								return (
									<EditorPane
										view={pane().view}
										focused={shown().focused}
										visible={shown().visible}
										split={shown().splitPaneCount > 1}
										order={shown().order}
										size={shown().size}
										onFocus={() => focusView(pane().view)}
									>
										<Switch>
											<Match when={pane().kind === "placeholder"}>
												<PlaceholderPane
													view="pcb"
													title={circuitName()}
													clearSidebar={shown().clearSidebar}
													split={shown().splitPaneCount > 1}
													viewSwitch={viewSwitch("pcb", true)}
												>
													<BoardPlaceholder circuitId={circuitId()} />
												</PlaceholderPane>
											</Match>
											<Match when={pane().kind === "loading"}>
												<PlaceholderPane
													view={pane().view}
													title={circuitName()}
													clearSidebar={shown().clearSidebar}
													split={shown().splitPaneCount > 1}
													viewSwitch={viewSwitch(pane().view, true)}
												>
													<OpeningView view={pane().view} />
												</PlaceholderPane>
											</Match>
											<Match when={pane().view === "schematic"}>
												<Dynamic
													component={props.Canvas}
													{...canvasProps}
													active={shown().focused}
													visible={shown().visible}
													inPane
													clearSidebar={shown().clearSidebar}
													splitPaneCount={shown().splitPaneCount}
													circuitId={circuitId()}
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
														props.store ? undefined : viewSwitch("schematic")
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
															<Show when={shown().visible}>
																<OpeningCircuit />
															</Show>
														}
													>
														<CircuitEditor
															document={circuit()}
															active={shown().focused}
															visible={shown().visible}
															inPane
															clearSidebar={shown().clearSidebar}
															splitPaneCount={shown().splitPaneCount}
															circuitId={circuitId()}
															viewSwitch={viewSwitch("circuit")}
														/>
													</Loading>
												)}
											</Match>
											<Match when={pane().view === "pcb" && documents().board}>
												{(board) => (
													<Dynamic
														component={props.Canvas}
														{...canvasProps}
														active={shown().focused}
														visible={shown().visible}
														inPane
														clearSidebar={shown().clearSidebar}
														splitPaneCount={shown().splitPaneCount}
														circuitId={circuitId()}
														store={board().store}
														board={board()}
														documentSelection={`board:${board().file.circuitId}`}
														viewSwitch={viewSwitch("pcb")}
														syncSelection
													/>
												)}
											</Match>
										</Switch>
									</EditorPane>
								);
							}}
						</For>
						<For each={dividers()}>
							{(index) => (
								<SplitDivider
									order={index * 2 + 1}
									stacked={stacked()}
									value={paneSizes()[index] ?? 0}
									onDragStart={() => {
										const base = paneSizes();
										const extent =
											(stacked()
												? container?.clientHeight
												: container?.clientWidth) ?? 0;
										return (delta) => {
											if (extent > 0)
												setSizes(
													resizeSplitSizes(
														base,
														index,
														delta / extent,
														minFraction(),
													),
												);
										};
									}}
									onStep={(delta) =>
										setSizes(
											resizeSplitSizes(
												paneSizes(),
												index,
												delta,
												minFraction(),
											),
										)
									}
									onReset={() => setSizes(equalSplitSizes(paneCount()))}
								/>
							)}
						</For>
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
