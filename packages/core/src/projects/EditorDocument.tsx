import { Dynamic, type JSX } from "@solidjs/web";
import {
	type Component,
	createEffect,
	createMemo,
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
import type { FootprintDocument } from "#/projects/ProjectSession.ts";

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

function EditorPane(props: { active: boolean; children: JSX.Element }) {
	let pane!: HTMLDivElement;
	createEffect(
		() => props.active,
		(active, previous) => {
			const opened = active && previous === false;
			const focused = document.activeElement;
			if (
				!opened ||
				(focused && focused !== document.body && !focused.closest("[inert]"))
			)
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
			ref={pane}
			class={{ "invisible absolute inset-0": !props.active }}
			inert={!props.active}
			data-editor-pane={props.active ? "active" : "hidden"}
		>
			{props.children}
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
		const view = activeView();
		return [
			...list.filter((pane) => pane.view === view),
			...list.filter((pane) => pane.view !== view),
		];
	});
	const schematicDocument = () => {
		const schematic = documents().schematic;
		return schematic === "main" ? null : schematic;
	};
	return (
		<Show when={fontsReady()}>
			<Switch
				fallback={
					<div class="relative">
						{state().inProject && <PreloadEditorViews />}
						<For each={panes()} keyed={(pane) => pane.key}>
							{(pane) => (
								<EditorPane active={activeView() === pane().view}>
									<Switch>
										<Match when={pane().view === "schematic"}>
											<Dynamic
												component={props.Canvas}
												{...canvasProps}
												active={activeView() === "schematic"}
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
														<Show when={activeView() === "circuit"}>
															<OpeningCircuit />
														</Show>
													}
												>
													<CircuitEditor
														document={circuit()}
														active={activeView() === "circuit"}
													/>
												</Loading>
											)}
										</Match>
										<Match when={pane().view === "pcb" && documents().board}>
											{(board) => (
												<Dynamic
													component={props.Canvas}
													{...canvasProps}
													active={activeView() === "pcb"}
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
