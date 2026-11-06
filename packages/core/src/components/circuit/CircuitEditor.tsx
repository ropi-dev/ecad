import {
	buildCircuitGraph,
	componentHeight,
	componentWidth,
} from "@ecad/drawing-core/circuit/graph.ts";
import { snapCircuitPoint } from "@ecad/drawing-core/circuit/grid.ts";
import type { CircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import { untangleCircuitGraph } from "@ecad/drawing-core/circuit/untangle.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	lazy,
	type MouseEvent as ReactMouseEvent,
	Suspense,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import {
	type CircuitTool,
	CircuitToolbar,
} from "#/components/circuit/CircuitToolbar.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { handleViewerKeyDown } from "#/engine/navigation.ts";
import {
	arrowDelta,
	handleHistoryKeyDown,
	isEditableTarget,
} from "#/lib/keyboard.ts";
import {
	type CircuitDocument,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import "#/components/circuit/CircuitEditor.css";
import { CircuitContextMenu } from "#/components/circuit/CircuitContextMenu.tsx";
import { CircuitGraphLayer } from "#/components/circuit/CircuitGraphLayer.tsx";
import {
	type CircuitGraph,
	type CircuitSelection as Selection,
	usePruneToSnapshot,
} from "#/components/circuit/circuitEditorState.ts";
import {
	type CircuitMenu,
	circuitMenuActions,
	circuitMenuPosition,
} from "#/components/circuit/circuitMenu.ts";
import {
	circuitPointerHandlers,
	useCircuitPointerState,
} from "#/components/circuit/circuitPointer.ts";
import {
	fitCircuitView,
	revealCircuitSubject,
} from "#/components/circuit/circuitView.ts";
import {
	type CircuitView,
	useCircuitNavigation,
} from "#/components/circuit/useCircuitNavigation.ts";
import { useCircuitSelectionSync } from "#/components/circuit/useCircuitSelectionSync.ts";
import {
	applySelection,
	type SelectionMode,
} from "#/components/editor/selectionMode.ts";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";

const ErcPanel = lazy(() =>
	import("#/components/circuit/ErcPanel.tsx").then((module) => ({
		default: module.CircuitErcPanel,
	})),
);

const viewStates = new WeakMap<CircuitDocument["store"], CircuitView>();

export function CircuitEditor({ document }: { document: CircuitDocument }) {
	const project = useProjectSelection(({ dirty, error, libraryErrors }) => ({
		dirty,
		error,
		libraryErrors,
	}));
	const store = document.store;
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const { circuit } = snapshot;
	const collapseKey = (snapshot.graph.collapsedComponentIds ?? []).join(",");
	const [collapseMotion, setCollapseMotion] = useState({
		key: collapseKey,
		active: false,
	});
	if (collapseMotion.key !== collapseKey)
		setCollapseMotion({ key: collapseKey, active: true });
	useEffect(() => {
		if (!collapseMotion.active) return;
		const timer = window.setTimeout(
			() => setCollapseMotion((current) => ({ ...current, active: false })),
			220,
		);
		return () => window.clearTimeout(timer);
	}, [collapseMotion]);

	const [ercOpen, setErcOpen] = useState(false);
	const [selection, setSelection] = useState<Selection>(null);
	const [pendingPin, setPendingPin] = useState<string | null>(null);
	const [tool, setTool] = useState<CircuitTool>("select");
	const [placement, setPlacement] = useState<SymbolDefinition | null>(null);
	const [placementPoint, setPlacementPoint] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const placementPinCount = useMemo(
		() =>
			placement?.children.filter((child) => child.kind === "pin").length ?? 0,
		[placement],
	);
	const connecting = tool === "connect";
	const [editing, setEditing] = useState<Selection>(null);
	const [menu, setMenu] = useState<CircuitMenu | null>(null);
	const pointer = useCircuitPointerState();
	const { drag, setDrag, connectionDrag, setConnectionDrag, setPan } = pointer;
	const [checkedPins, setCheckedPins] = useState<string[]>([]);
	const [error, setError] = useState("");
	const circuitMessages = [
		...new Set(
			[error || project?.error, ...(project?.libraryErrors ?? [])].filter(
				(message): message is string => !!message,
			),
		),
	];
	const svg = useRef<SVGSVGElement>(null);
	const fittedStore = useRef<CircuitDocument["store"] | null>(null);
	const { view, setView, zoom, gridStyle, gridStep, scale } =
		useCircuitNavigation(svg, viewStates.get(store));
	useEffect(() => {
		viewStates.set(store, view);
	}, [store, view]);
	const graph = useMemo(
		() =>
			buildCircuitGraph({
				circuit: snapshot.circuit,
				graph: drag
					? {
							...snapshot.graph,
							positions: [
								...snapshot.graph.positions.filter(
									(position) => position.id !== drag.position.id,
								),
								{ ...drag.position, x: drag.x, y: drag.y },
							],
						}
					: snapshot.graph,
			}),
		[snapshot.circuit, snapshot.graph, drag],
	);
	const pins = useMemo(
		() =>
			new Map(
				circuit.components.flatMap((component) =>
					component.pins.map((pin) => [pin.id, { ...pin, component }] as const),
				),
			),
		[circuit.components],
	);
	const pinNets = useMemo(
		() =>
			new Map(
				circuit.nets.flatMap((net) =>
					net.pinIds.map((id) => [id, net] as const),
				),
			),
		[circuit.nets],
	);
	const net =
		selection?.kind === "net"
			? circuit.nets.find((net) => net.id === selection.id)
			: undefined;
	const selectedNetId =
		net?.id ?? (selection ? pinNets.get(selection.id)?.id : undefined);

	usePruneToSnapshot(snapshot, {
		setDrag,
		setConnectionDrag,
		setCheckedPins,
		setSelection,
		setEditing,
		setPendingPin,
	});
	useCircuitSelectionSync({
		store,
		selection,
		checkedPins,
		setSelection,
		setCheckedPins,
	});
	function select(next: Selection) {
		setSelection(next);
		setCheckedPins([]);
		setMenu(null);
	}
	function finishEditing() {
		setEditing(null);
		setError("");
		svg.current?.focus({ preventScroll: true });
	}
	function edit(item: NonNullable<Selection>) {
		select(item);
		setEditing(item);
	}
	const removable =
		selection &&
		(selection.kind === "component" ||
			selection.kind === "net" ||
			pinNets.has(selection.id) ||
			circuit.noConnectPinIds.includes(selection.id));
	function deleteSelection(item = selection) {
		if (!item) return;
		const command: CircuitCommand =
			item.kind === "component"
				? { type: "remove-component", id: item.id }
				: item.kind === "net"
					? { type: "remove-net", id: item.id }
					: pinNets.has(item.id)
						? {
								type: "disconnect",
								pinIds:
									item.kind === "connection" && checkedPins.includes(item.id)
										? checkedPins
										: [item.id],
							}
						: { type: "no-connect", pinId: item.id, enabled: false };
		if (run(command)) {
			select(null);
			svg.current?.focus({ preventScroll: true });
		}
	}
	function selectConnection(id: string, mode: SelectionMode) {
		if (tool !== "select") return;
		const next = [...applySelection(checkedPins, [id], mode)];
		setSelection(
			next.length
				? {
						kind: "connection",
						id: next.includes(id) ? id : next[next.length - 1],
					}
				: null,
		);
		setCheckedPins(next);
		svg.current?.focus({ preventScroll: true });
	}
	function openMenu(
		event: ReactMouseEvent<HTMLButtonElement>,
		item: NonNullable<Selection>,
	) {
		event.preventDefault();
		event.stopPropagation();
		if (item.kind === "connection") {
			if (!checkedPins.includes(item.id)) selectConnection(item.id, "replace");
		} else select(item);
		const bounds = svg.current?.getBoundingClientRect();
		if (bounds)
			setMenu({ selection: item, ...circuitMenuPosition(event, bounds) });
	}
	const menuActions = circuitMenuActions(menu, {
		circuit,
		pinNets,
		checkedPins,
		run,
		startConnecting: (pinId) => {
			setConnecting(true);
			setPendingPin(pinId);
		},
		edit,
		deleteSelection,
	});
	function setConnecting(value: boolean) {
		setPlacement(null);
		setPlacementPoint(null);
		setTool(value ? "connect" : "select");
	}
	function run(command: CircuitCommand) {
		try {
			store.execute(command);
			setError("");
			return true;
		} catch (cause) {
			setError(errorMessage(cause, "Unable to edit circuit."));
			return false;
		}
	}
	function selectPin(id: string) {
		if (tool !== "select" && tool !== "connect") return;
		if (connecting && pendingPin && pendingPin !== id) {
			if (run({ type: "connect", pinIds: [pendingPin, id] })) {
				setPendingPin(null);
				setConnecting(false);
			}
		} else if (connecting) setPendingPin(id);
		select({ kind: "pin", id });
	}
	function selectNet(id: string) {
		if (tool !== "select" && tool !== "connect") return;
		if (connecting && pendingPin) {
			if (run({ type: "connect", pinIds: [pendingPin], netId: id })) {
				setPendingPin(null);
				setConnecting(false);
			}
		}
		setCheckedPins([]);
		select({ kind: "net", id });
	}
	function snap<T extends { x: number; y: number }>(position: T) {
		return snapCircuitPoint(position, gridStep);
	}
	function componentPosition(
		position: { x: number; y: number },
		pinCount: number,
	) {
		return snap({
			x: position.x - componentWidth / 2,
			y: position.y - componentHeight(pinCount) / 2,
		});
	}
	function placeAt(position: { x: number; y: number }) {
		if (tool === "net") {
			const id = crypto.randomUUID();
			if (
				run({
					type: "add-net",
					net: { id, names: [], pinIds: [] },
					position: snap(position),
				})
			) {
				setTool("select");
				setPlacementPoint(null);
				edit({ kind: "net", id });
			}
			return;
		}
		if (tool !== "component" || !placement || placement.netSymbol) return;
		try {
			const component = componentFromSymbol(placement, circuit.components);
			if (run({ type: "add-component", component, position: snap(position) })) {
				setTool("select");
				setPlacement(null);
				setPlacementPoint(null);
				select({ kind: "component", id: component.id });
				svg.current?.focus({ preventScroll: true });
			}
		} catch (cause) {
			setError(errorMessage(cause, "Unable to place component."));
		}
	}
	function placementCenter(definition?: SymbolDefinition) {
		const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
		return definition
			? componentPosition(
					center,
					definition.children.filter((child) => child.kind === "pin").length,
				)
			: snap(center);
	}
	useEffect(() => {
		if (tool !== "net" && (tool !== "component" || !placement)) return;
		const frame = requestAnimationFrame(() =>
			svg.current?.focus({ preventScroll: true }),
		);
		return () => cancelAnimationFrame(frame);
	}, [tool, placement]);

	function fit(nextGraph: CircuitGraph = graph, resetZoom = true) {
		setView(
			fitCircuitView(
				nextGraph,
				svg.current?.getBoundingClientRect(),
				resetZoom,
			),
		);
	}
	const { cancelConnectionDrag, startConnectionDrag, startDrag, svgHandlers } =
		circuitPointerHandlers({
			state: pointer,
			svg,
			tool,
			placement,
			placementPinCount,
			view,
			setView,
			pinNets,
			snap,
			componentPosition,
			select,
			selectPin,
			setCheckedPins,
			setPendingPin,
			setPlacementPoint,
			setConnecting,
			placeAt,
			run,
		});
	useLayoutEffect(() => {
		if (fittedStore.current === store) return;
		fittedStore.current = store;
		const savedView = viewStates.get(store);
		if (savedView) setView(savedView);
		else fit(buildCircuitGraph(store.getSnapshot()), false);
	});
	return (
		<section
			className="circuit-editor"
			data-pending-changes={project?.dirty ?? false}
			aria-label="Circuit editor"
			onPointerDownCapture={(event) => {
				if (
					!(event.target instanceof Element) ||
					!event.target.closest(".circuit-context-menu")
				)
					setMenu(null);
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					cancelConnectionDrag();
					setConnecting(false);
					setPlacement(null);
					setPlacementPoint(null);
					setPendingPin(null);
					setDrag(null);
					setPan(null);
					setMenu(null);
					setEditing(null);
					select(null);
				}
				if (event.defaultPrevented || isEditableTarget(event)) return;
				if (
					(tool === "net" || tool === "component") &&
					event.target === svg.current
				) {
					const delta = arrowDelta(
						event.key,
						gridStep * (event.shiftKey ? 10 : 1),
					);
					if (delta) {
						event.preventDefault();
						const position =
							placementPoint ?? placementCenter(placement ?? undefined);
						setPlacementPoint(
							snap({ x: position.x + delta.x, y: position.y + delta.y }),
						);
						return;
					}
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						placeAt(placementPoint ?? placementCenter(placement ?? undefined));
						return;
					}
				}
				if (
					(event.key === "Delete" || event.key === "Backspace") &&
					removable
				) {
					event.preventDefault();
					deleteSelection();
					return;
				}
				if (
					event.key === "F2" &&
					selection &&
					(selection.kind === "net" || selection.kind === "component")
				) {
					event.preventDefault();
					edit(selection);
					return;
				}
				handleViewerKeyDown(event, { fit, zoom, fitOnF6: true });
				handleHistoryKeyDown(event, store);
			}}
		>
			<h1 className="sr-only">{circuit.name}</h1>
			{circuitMessages.length > 0 && (
				<div role="alert" className="circuit-error">
					{circuitMessages.map((message) => (
						<p key={message}>{message}</p>
					))}
				</div>
			)}
			<div className="circuit-workspace">
				<div
					className={`circuit-canvas ${collapseMotion.active ? "is-collapsing" : ""} ${tool === "pan" ? "is-panning" : tool === "component" || tool === "net" ? "is-placing" : ""}`}
					style={gridStyle}
				>
					<svg
						ref={svg}
						role="application"
						tabIndex={-1}
						aria-label="Circuit connections graph"
						viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
						{...svgHandlers}
					>
						<title>Components, pins, and shared electrical nets</title>
						<CircuitGraphLayer
							graph={graph}
							pins={pins}
							pinNets={pinNets}
							noConnectPinIds={circuit.noConnectPinIds}
							tool={tool}
							gridStep={gridStep}
							selection={selection}
							selectedNetId={selectedNetId}
							checkedPins={checkedPins}
							editing={editing}
							pendingPin={pendingPin}
							connectionDrag={connectionDrag}
							placement={placement}
							placementPoint={placementPoint}
							placementPinCount={placementPinCount}
							actions={{
								select,
								edit,
								finishEditing,
								openMenu,
								selectPin,
								selectNet,
								selectConnection,
								startDrag,
								startConnectionDrag,
								run,
								snap,
							}}
						/>
					</svg>
					{menu && (
						<CircuitContextMenu
							x={menu.x}
							y={menu.y}
							actions={menuActions}
							onClose={() => {
								setMenu(null);
								svg.current?.focus({ preventScroll: true });
							}}
						/>
					)}
				</div>
			</div>
			{ercOpen && (
				<Suspense
					fallback={
						<FloatingPanel label="Electrical rules check" as="section" raised>
							<output className="p-2.5 text-[12px] text-[#9ba7b8]">
								Loading electrical checks...
							</output>
						</FloatingPanel>
					}
				>
					<ErcPanel
						circuit={circuit}
						onClose={() => {
							setErcOpen(false);
							svg.current?.focus();
						}}
						onSelect={(subject) =>
							revealCircuitSubject(subject, {
								graph,
								store,
								run,
								select,
								setView,
							})
						}
					/>
				</Suspense>
			)}
			<CircuitToolbar
				ercOpen={ercOpen}
				onErc={() => setErcOpen((open) => !open)}
				tool={tool}
				onToolChange={(next) => {
					cancelConnectionDrag();
					setEditing(null);
					setTool(next);
					setPlacement(null);
					setPlacementPoint(next === "net" ? placementCenter() : null);
					setPendingPin(null);
				}}
				canUndo={snapshot.canUndo}
				canRedo={snapshot.canRedo}
				canDelete={Boolean(removable)}
				onDelete={() => deleteSelection()}
				zoomLevel={scale}
				onZoom={zoom}
				onFit={() => fit()}
				onUntangle={() => {
					cancelConnectionDrag();
					setDrag(null);
					setPendingPin(null);
					if (
						run({
							type: "move",
							positions: untangleCircuitGraph({
								circuit,
								graph: snapshot.graph,
							}),
						})
					)
						fit(buildCircuitGraph(store.getSnapshot()), false);
				}}
				onChooseComponent={(definition) => {
					setEditing(null);
					setPlacement(definition);
					setPlacementPoint(placementCenter(definition));
					setTool("component");
					setPendingPin(null);
				}}
				onUndo={() => store.undo()}
				onRedo={() => store.redo()}
			/>
			{connecting && (
				<footer className="circuit-status">
					<output className="circuit-connection-status">
						{pendingPin
							? `Connect ${pins.get(pendingPin)?.component.reference}.${pins.get(pendingPin)?.number}`
							: "Select pin"}
					</output>
				</footer>
			)}
		</section>
	);
}
