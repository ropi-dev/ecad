import {
	type ComponentType,
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	Editor2DProps,
	EditorCanvasProps,
} from "#/components/editor/Editor2D.tsx";
import { SymbolAttributesButton } from "#/components/editor/SymbolAttributesDialog.tsx";
import { useDrawingFonts } from "#/components/editor/useDrawingFonts.ts";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";
import {
	type BoardDocument,
	type CircuitDocument,
	type DrawingDocument,
	type EditorViews,
	useProjectActions,
	useProjectEditor,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";

const WorkspaceStart = lazy(() =>
	import("#/projects/WorkspaceStart.tsx").then((module) => ({
		default: module.WorkspaceStart,
	})),
);
const CircuitEditor = lazy(() =>
	import("#/components/circuit/CircuitEditor.tsx").then((module) => ({
		default: module.CircuitEditor,
	})),
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
	useEffect(() => {
		if (!project?.project) return;
		const { preloadEditorViews } = project;
		return whenPaused(() => void preloadEditorViews().catch(() => undefined));
	}, [project]);
	return null;
}

function EditorPane({
	active,
	children,
}: {
	active: boolean;
	children: ReactNode;
}) {
	const pane = useRef<HTMLDivElement>(null);
	const shown = useRef(active);
	useEffect(() => {
		const opened = active && !shown.current;
		shown.current = active;
		const focused = document.activeElement;
		if (
			!opened ||
			(focused && focused !== document.body && !focused.closest("[inert]"))
		)
			return;
		quietFocus(
			pane.current?.querySelector<HTMLElement>(
				'[aria-label="Editor view"] [aria-pressed="true"]',
			) ?? null,
		);
	}, [active]);
	return (
		<div
			ref={pane}
			className={active ? undefined : "invisible absolute inset-0"}
			inert={!active}
			data-editor-pane={active ? "active" : "hidden"}
		>
			{children}
		</div>
	);
}

export function EditorDocument({
	Canvas,
	...props
}: Editor2DProps & { Canvas: ComponentType<EditorCanvasProps> }) {
	const project = useProjectEditor();
	const actions = useProjectActions();
	// A circuit link opens this route while its circuit is still loading.
	// Showing the schematic for that moment would start its viewer, which
	// then keeps that camera, so wait for the circuit that was opening on
	// arrival. A switch from an open schematic keeps it on screen instead.
	const [arrivedOpening] = useState(() => project?.openingCircuit ?? null);
	// Text sizes are measured with the schematic font, so wait for it to load.
	const fontsReady = useDrawingFonts();
	const inProject = !props.store && !!project;
	const symbol = inProject ? project.editorSymbol : null;
	const footprint = inProject ? project.editorFootprint : null;
	const board = inProject ? project.editorBoard : null;
	const drawing = inProject ? project.editorDrawing : null;
	const circuit = inProject ? project.editorCircuit : null;
	const activeViews = inProject ? project.editorViews : null;
	if (!fontsReady) return null;
	const openingCircuit = (
		<output className="block p-6 text-sm text-fg-muted">
			Opening circuit...
		</output>
	);
	if (
		inProject &&
		!circuit &&
		arrivedOpening !== null &&
		project.openingCircuit === arrivedOpening
	)
		return openingCircuit;
	if (
		inProject &&
		!project.mainDrawing &&
		!symbol &&
		!footprint &&
		!board &&
		!drawing &&
		!circuit &&
		project.openingCircuit === null
	)
		return (
			<Suspense fallback={null}>
				<WorkspaceStart />
			</Suspense>
		);
	const session = project?.session ?? 0;
	const preload = inProject && <PreloadEditorViews />;
	if (symbol || footprint)
		return (
			<>
				{preload}
				<Canvas
					key={`${session}:${symbol ? `symbol:${symbol.file.id}` : `footprint:${footprint?.file.id}`}`}
					{...props}
					store={symbol?.store ?? footprint?.store}
					symbolName={symbol?.file.name}
					headerControls={
						symbol && actions ? (
							<SymbolAttributesButton
								attributes={symbol.file.attributes}
								onSave={(attributes) =>
									actions.saveSymbolAttributes(symbol.file.id, attributes)
								}
							/>
						) : undefined
					}
					footprintName={footprint?.file.name}
					documentSelection={
						symbol
							? `symbol:${symbol.file.id}`
							: `footprint:${footprint?.file.id}`
					}
				/>
			</>
		);
	const activeView = circuit ? "circuit" : board ? "pcb" : "schematic";
	const activeCircuitId =
		circuit?.file.circuit.id ??
		board?.file.circuitId ??
		(activeView === "schematic" &&
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
		activeView === "schematic"
			? (drawing ?? "main")
			: (views?.schematic ?? null);
	const circuitDocument: CircuitDocument | null =
		circuit ?? views?.circuit ?? null;
	const boardDocument: BoardDocument | null = board ?? views?.board ?? null;
	const panes = [
		schematic && (
			<EditorPane
				key={`${session}:schematic:${schematic === "main" ? "main" : schematic.file.id}`}
				active={activeView === "schematic"}
			>
				<Canvas
					{...props}
					active={activeView === "schematic"}
					store={schematic === "main" ? props.store : schematic.store}
					drawingName={schematic === "main" ? undefined : schematic.file.name}
					documentSelection={
						props.store
							? undefined
							: schematic === "main"
								? "drawing"
								: `drawing:${schematic.file.id}`
					}
					viewSwitch={
						props.store ? undefined : <EditorViewSwitch view="schematic" />
					}
					syncSelection={!props.store}
				/>
			</EditorPane>
		),
		circuitDocument && (
			<EditorPane
				key={`${session}:circuit:${circuitDocument.file.circuit.id}`}
				active={activeView === "circuit"}
			>
				<Suspense fallback={activeView === "circuit" ? openingCircuit : null}>
					<CircuitEditor
						document={circuitDocument}
						active={activeView === "circuit"}
					/>
				</Suspense>
			</EditorPane>
		),
		boardDocument && (
			<EditorPane
				key={`${session}:board:${boardDocument.file.circuitId}`}
				active={activeView === "pcb"}
			>
				<Canvas
					{...props}
					active={activeView === "pcb"}
					store={boardDocument.store}
					board={boardDocument}
					documentSelection={`board:${boardDocument.file.circuitId}`}
					viewSwitch={<EditorViewSwitch view="pcb" />}
					syncSelection
				/>
			</EditorPane>
		),
	];
	const activeIndex = ["schematic", "circuit", "pcb"].indexOf(activeView);
	return (
		<div className="relative">
			{preload}
			{[
				panes[activeIndex],
				...panes.filter((_, index) => index !== activeIndex),
			]}
		</div>
	);
}
