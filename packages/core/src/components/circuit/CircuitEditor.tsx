import {
	buildCircuitGraph,
	componentHeight,
	componentWidth,
} from "@ecad/drawing-core/circuit/graph.ts";
import { snapCircuitPoint } from "@ecad/drawing-core/circuit/grid.ts";
import type { CircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { JSX } from "@solidjs/web";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Loading,
	lazy,
	onSettled,
	Show,
} from "solid-js";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { untangleCircuit } from "#/circuit/untangle-client.ts";
import {
	type CircuitTool,
	CircuitToolbar,
} from "#/components/circuit/CircuitToolbar.tsx";
import { Workflow } from "#/components/ui/icons.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { handleViewerKeyDown } from "#/engine/navigation.ts";
import { useExternalStore } from "#/lib/external-store.ts";
import {
	arrowDelta,
	handleHistoryKeyDown,
	isEditableTarget,
} from "#/lib/keyboard.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";
import {
	type CircuitDocument,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import "#/components/circuit/CircuitEditor.css";
import { CircuitContextMenu } from "#/components/circuit/CircuitContextMenu.tsx";
import { CircuitGraphLayer } from "#/components/circuit/CircuitGraphLayer.tsx";
import {
	type CircuitGraph,
	type CircuitGraphActions,
	type GraphButtonEvent,
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

function CircuitDocumentBar(props: {
	name: string;
	id: string;
	active: boolean;
	clearSidebar?: boolean;
	split?: boolean;
	viewSwitch?: JSX.Element;
}) {
	return (
		<DocumentBar
			icon={Workflow}
			title={props.name}
			selection={`circuit:${props.id}`}
			view="circuit"
			active={props.active}
			clearSidebar={props.clearSidebar}
			split={props.split}
		>
			{props.viewSwitch ?? <EditorViewSwitch view="circuit" />}
		</DocumentBar>
	);
}

export function CircuitEditor(props: {
	document: CircuitDocument;
	active?: boolean;
	visible?: boolean;
	inPane?: boolean;
	clearSidebar?: boolean;
	splitPaneCount?: number;
	circuitId?: string;
	viewSwitch?: JSX.Element;
}) {
	const active = () => props.active ?? true;
	const visible = () => props.visible ?? active();
	const project = useProjectSelection(({ dirty, error, libraryErrors }) => ({
		dirty,
		error,
		libraryErrors,
	}));
	const store = createMemo(() => props.document.store);
	const snapshotOf = createMemo(() => useExternalStore(store()));
	const snapshot = () => snapshotOf()();
	const circuit = () => snapshot().circuit;
	const components = createMemo(() => circuit().components);
	const nets = createMemo(() => circuit().nets);
	const collapseKey = createMemo(() =>
		(snapshot().graph.collapsedComponentIds ?? []).join(","),
	);
	const [settledCollapseKey, setSettledCollapseKey] = createSignal<string>();
	createEffect(collapseKey, (key) => {
		const timer = window.setTimeout(() => setSettledCollapseKey(key), 220);
		return () => window.clearTimeout(timer);
	});
	const collapsing = () => {
		const settled = settledCollapseKey();
		return settled !== undefined && settled !== collapseKey();
	};

	const [ercOpen, setErcOpen] = createSignal(false);
	const [selection, setSelection] = createSignal<Selection>(null);
	const [pendingPin, setPendingPin] = createSignal<string | null>(null);
	const [tool, setTool] = createSignal<CircuitTool>("select");
	const [placement, setPlacement] = createSignal<SymbolDefinition | null>(null);
	const [placementPoint, setPlacementPoint] = createSignal<{
		x: number;
		y: number;
	} | null>(null);
	const placementPinCount = createMemo(
		() =>
			placement()?.children.filter((child) => child.kind === "pin").length ?? 0,
	);
	const connecting = () => tool() === "connect";
	const [editing, setEditing] = createSignal<Selection>(null);
	const [menu, setMenu] = createSignal<CircuitMenu | null>(null);
	const pointer = useCircuitPointerState();
	const { drag, setDrag, connectionDrag, setConnectionDrag, setPan } = pointer;
	const [checkedPins, setCheckedPins] = createSignal<string[]>([]);
	const [error, setError] = createSignal("");
	let untangle: AbortController | null = null;
	const [untangling, setUntangling] = createSignal(false);
	onSettled(() => () => untangle?.abort());
	const circuitMessages = createMemo(() => [
		...new Set(
			[error() || project()?.error, ...(project()?.libraryErrors ?? [])].filter(
				(message): message is string => !!message,
			),
		),
	]);
	let svg: SVGSVGElement | undefined;
	const navigation = useCircuitNavigation(
		() => svg,
		() => viewStates.get(store()),
	);
	const { setView, zoom } = navigation;
	createEffect(store, (current) => {
		const savedView = viewStates.get(current);
		if (savedView) setView(savedView);
		else fit(buildCircuitGraph(current.getSnapshot()), false);
	});
	createEffect(
		() => ({ store: store(), view: navigation.view }),
		(current) => {
			viewStates.set(current.store, current.view);
		},
	);
	const graph = createMemo(() => {
		const current = snapshot();
		const dragging = drag();
		return buildCircuitGraph({
			circuit: current.circuit,
			graph: dragging
				? {
						...current.graph,
						positions: [
							...current.graph.positions.filter(
								(position) => position.id !== dragging.position.id,
							),
							{ ...dragging.position, x: dragging.x, y: dragging.y },
						],
					}
				: current.graph,
		});
	});
	const pins = createMemo(
		() =>
			new Map(
				components().flatMap((component) =>
					component.pins.map((pin) => [pin.id, { ...pin, component }] as const),
				),
			),
	);
	const pinNets = createMemo(
		() =>
			new Map(
				nets().flatMap((net) => net.pinIds.map((id) => [id, net] as const)),
			),
	);
	const selectedNetId = createMemo(() => {
		const current = selection();
		if (!current) return undefined;
		if (current.kind === "net")
			return nets().find((net) => net.id === current.id)?.id;
		return pinNets().get(current.id)?.id;
	});

	usePruneToSnapshot(snapshot, {
		selection,
		checkedPins,
		setDrag,
		setConnectionDrag,
		setCheckedPins,
		setSelection,
		setEditing,
		setPendingPin,
	});
	useCircuitSelectionSync(
		() => ({
			enabled: true,
			visible: visible(),
			active: active(),
			circuitId: props.circuitId ?? circuit().id,
			storeVersion: circuit(),
			store: store(),
			setSelection,
			setCheckedPins,
		}),
		() => ({ item: selection(), checkedPins: checkedPins() }),
	);
	function focusGraph() {
		svg?.focus({ preventScroll: true });
	}
	function select(next: Selection) {
		setSelection(next);
		setCheckedPins([]);
		setMenu(null);
	}
	function finishEditing() {
		setEditing(null);
		setError("");
		focusGraph();
	}
	function edit(item: NonNullable<Selection>) {
		select(item);
		setEditing(item);
	}
	const removable = createMemo(() => {
		const current = selection();
		return (
			!!current &&
			(current.kind === "component" ||
				current.kind === "net" ||
				pinNets().has(current.id) ||
				circuit().noConnectPinIds.includes(current.id))
		);
	});
	function deleteSelection(item = selection()) {
		if (!item) return;
		const checked = checkedPins();
		const command: CircuitCommand =
			item.kind === "component"
				? { type: "remove-component", id: item.id }
				: item.kind === "net"
					? { type: "remove-net", id: item.id }
					: pinNets().has(item.id)
						? {
								type: "disconnect",
								pinIds:
									item.kind === "connection" && checked.includes(item.id)
										? checked
										: [item.id],
							}
						: { type: "no-connect", pinId: item.id, enabled: false };
		if (run(command)) {
			select(null);
			focusGraph();
		}
	}
	function selectConnection(id: string, mode: SelectionMode) {
		if (tool() !== "select") return;
		const next = [...applySelection(checkedPins(), [id], mode)];
		setSelection(
			next.length
				? {
						kind: "connection",
						id: next.includes(id) ? id : next[next.length - 1],
					}
				: null,
		);
		setCheckedPins(next);
		focusGraph();
	}
	function openMenu(
		event: GraphButtonEvent<MouseEvent>,
		item: NonNullable<Selection>,
	) {
		event.preventDefault();
		event.stopPropagation();
		if (item.kind === "connection") {
			if (!checkedPins().includes(item.id))
				selectConnection(item.id, "replace");
		} else select(item);
		const bounds = svg?.getBoundingClientRect();
		if (bounds)
			setMenu({ selection: item, ...circuitMenuPosition(event, bounds) });
	}
	const menuActions = createMemo(() =>
		circuitMenuActions(menu(), {
			circuit: circuit(),
			pinNets: pinNets(),
			checkedPins: checkedPins(),
			run,
			startConnecting: (pinId) => {
				setConnecting(true);
				setPendingPin(pinId);
			},
			edit,
			deleteSelection,
		}),
	);
	function setConnecting(value: boolean) {
		setPlacement(null);
		setPlacementPoint(null);
		setTool(value ? "connect" : "select");
	}
	function run(command: CircuitCommand) {
		try {
			store().execute(command);
			setError("");
			return true;
		} catch (cause) {
			setError(errorMessage(cause, "Unable to edit circuit."));
			return false;
		}
	}
	function selectPin(id: string) {
		const current = tool();
		if (current !== "select" && current !== "connect") return;
		const pending = pendingPin();
		if (connecting() && pending && pending !== id) {
			if (run({ type: "connect", pinIds: [pending, id] })) {
				setPendingPin(null);
				setConnecting(false);
			}
		} else if (connecting()) setPendingPin(id);
		select({ kind: "pin", id });
	}
	function selectNet(id: string) {
		const current = tool();
		if (current !== "select" && current !== "connect") return;
		const pending = pendingPin();
		if (connecting() && pending) {
			if (run({ type: "connect", pinIds: [pending], netId: id })) {
				setPendingPin(null);
				setConnecting(false);
			}
		}
		setCheckedPins([]);
		select({ kind: "net", id });
	}
	function snap<T extends { x: number; y: number }>(position: T) {
		return snapCircuitPoint(position, navigation.gridStep);
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
		const current = tool();
		if (current === "net") {
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
		const definition = placement();
		if (current !== "component" || !definition || definition.netSymbol) return;
		try {
			const component = componentFromSymbol(definition, components());
			if (run({ type: "add-component", component, position: snap(position) })) {
				setTool("select");
				setPlacement(null);
				setPlacementPoint(null);
				select({ kind: "component", id: component.id });
				focusGraph();
			}
		} catch (cause) {
			setError(errorMessage(cause, "Unable to place component."));
		}
	}
	function placementCenter(definition?: SymbolDefinition) {
		const view = navigation.view;
		const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
		return definition
			? componentPosition(
					center,
					definition.children.filter((child) => child.kind === "pin").length,
				)
			: snap(center);
	}
	createEffect(
		() => ({ tool: tool(), placement: placement() }),
		(current) => {
			if (
				current.tool !== "net" &&
				(current.tool !== "component" || !current.placement)
			)
				return;
			const frame = requestAnimationFrame(focusGraph);
			return () => cancelAnimationFrame(frame);
		},
	);

	function fit(nextGraph: CircuitGraph = graph(), resetZoom = true) {
		setView(fitCircuitView(nextGraph, svg?.getBoundingClientRect(), resetZoom));
	}
	const { cancelConnectionDrag, startConnectionDrag, startDrag, svgHandlers } =
		circuitPointerHandlers({
			state: pointer,
			svg: () => svg,
			tool,
			placement,
			placementPinCount,
			view: () => navigation.view,
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
	const graphActions: CircuitGraphActions = {
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
	};
	function changeTool(next: CircuitTool) {
		cancelConnectionDrag();
		setEditing(null);
		setTool(next);
		setPlacement(null);
		setPlacementPoint(next === "net" ? placementCenter() : null);
		setPendingPin(null);
	}
	function startUntangle() {
		if (untangle) return;
		cancelConnectionDrag();
		setDrag(null);
		setPendingPin(null);
		const controller = new AbortController();
		untangle = controller;
		const source = store();
		const { circuit, graph } = source.getSnapshot();
		setUntangling(true);
		void untangleCircuit({ circuit, graph }, controller.signal)
			.then(
				(positions) => {
					const current = source.getSnapshot();
					if (
						controller.signal.aborted ||
						current.circuit !== circuit ||
						current.graph !== graph
					)
						return;
					if (run({ type: "move", positions }))
						fit(buildCircuitGraph(source.getSnapshot()), false);
				},
				(cause: unknown) => {
					if (!controller.signal.aborted)
						setError(errorMessage(cause, "Unable to untangle circuit."));
				},
			)
			.finally(() => {
				if (untangle !== controller) return;
				untangle = null;
				setUntangling(false);
			});
	}
	function chooseComponent(definition: SymbolDefinition) {
		setEditing(null);
		setPlacement(definition);
		setPlacementPoint(placementCenter(definition));
		setTool("component");
		setPendingPin(null);
	}
	function onKeyDown(event: KeyboardEvent) {
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
		const current = tool();
		if (
			(current === "net" || current === "component") &&
			event.target === svg
		) {
			const delta = arrowDelta(
				event.key,
				navigation.gridStep * (event.shiftKey ? 10 : 1),
			);
			const position =
				placementPoint() ?? placementCenter(placement() ?? undefined);
			if (delta) {
				event.preventDefault();
				setPlacementPoint(
					snap({ x: position.x + delta.x, y: position.y + delta.y }),
				);
				return;
			}
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				placeAt(position);
				return;
			}
		}
		if ((event.key === "Delete" || event.key === "Backspace") && removable()) {
			event.preventDefault();
			deleteSelection();
			return;
		}
		const selected = selection();
		if (
			event.key === "F2" &&
			selected &&
			(selected.kind === "net" || selected.kind === "component")
		) {
			event.preventDefault();
			edit(selected);
			return;
		}
		handleViewerKeyDown(event, { fit, zoom, fitOnF6: true });
		handleHistoryKeyDown(event, store());
	}
	return (
		<section
			ref={(element) =>
				element.addEventListener(
					"pointerdown",
					(event) => {
						if (
							!(event.target instanceof Element) ||
							!event.target.closest(".circuit-context-menu")
						)
							setMenu(null);
					},
					{ capture: true },
				)
			}
			class="circuit-editor"
			data-pending-changes={project()?.dirty ? "true" : "false"}
			aria-label="Circuit editor"
			onKeyDown={onKeyDown}
		>
			<h1 class="sr-only">{circuit().name}</h1>
			<CircuitDocumentBar
				name={circuit().name}
				id={circuit().id}
				active={active()}
				clearSidebar={props.clearSidebar}
				split={(props.splitPaneCount ?? 1) > 1}
				viewSwitch={props.viewSwitch}
			/>
			{circuitMessages().length > 0 && (
				<div
					role="alert"
					data-beside-panel={ercOpen() ? "true" : "false"}
					class="ui-notice circuit-error"
				>
					<For each={circuitMessages()}>{(message) => <p>{message}</p>}</For>
				</div>
			)}
			<div class="circuit-workspace">
				<div
					class={[
						"circuit-canvas",
						{
							"is-collapsing": collapsing(),
							"is-panning": tool() === "pan",
							"is-placing": tool() === "component" || tool() === "net",
						},
					]}
				>
					<div
						class="circuit-grid"
						data-shortcut-mutations="ignore"
						style={navigation.gridStyle}
					/>
					<svg
						ref={(element) => {
							svg = element;
							element.addEventListener(
								"pointerdown",
								svgHandlers.onPointerDownCapture,
								{ capture: true },
							);
							element.addEventListener("click", svgHandlers.onClickCapture, {
								capture: true,
							});
						}}
						role="application"
						tabindex={-1}
						aria-label="Circuit connections graph"
						data-shortcut-scope="none"
						data-shortcut-mutations="ignore"
						viewBox={`${navigation.view.x} ${navigation.view.y} ${navigation.view.width} ${navigation.view.height}`}
						onPointerLeave={svgHandlers.onPointerLeave}
						onPointerDown={svgHandlers.onPointerDown}
						onPointerMove={svgHandlers.onPointerMove}
						onPointerUp={svgHandlers.onPointerUp}
						onPointerCancel={svgHandlers.onPointerCancel}
						onLostPointerCapture={svgHandlers.onLostPointerCapture}
					>
						<title>Components, pins, and shared electrical nets</title>
						{visible() && (
							<CircuitGraphLayer
								graph={graph()}
								pins={pins()}
								pinNets={pinNets()}
								noConnectPinIds={circuit().noConnectPinIds}
								tool={tool()}
								gridStep={navigation.gridStep}
								selection={selection()}
								selectedNetId={selectedNetId()}
								checkedPins={checkedPins()}
								editing={editing()}
								pendingPin={pendingPin()}
								connectionDrag={connectionDrag()}
								placement={placement()}
								placementPoint={placementPoint()}
								placementPinCount={placementPinCount()}
								actions={graphActions}
							/>
						)}
					</svg>
					<Show when={menu()}>
						{(current) => (
							<CircuitContextMenu
								x={current().x}
								y={current().y}
								actions={menuActions()}
								onClose={() => {
									setMenu(null);
									focusGraph();
								}}
							/>
						)}
					</Show>
				</div>
			</div>
			{ercOpen() && (
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
					<ErcPanel
						circuit={circuit()}
						onClose={() => {
							setErcOpen(false);
							svg?.focus();
						}}
						onSelect={(subject) =>
							revealCircuitSubject(subject, {
								graph: graph(),
								store: store(),
								run,
								select,
								setView,
							})
						}
					/>
				</Loading>
			)}
			<CircuitToolbar
				ercOpen={ercOpen()}
				tool={tool()}
				canUndo={snapshot().canUndo}
				canRedo={snapshot().canRedo}
				canDelete={removable()}
				zoomLevel={navigation.scale}
				untangling={untangling()}
				onErc={() => setErcOpen((open) => !open)}
				onToolChange={changeTool}
				onDelete={() => deleteSelection()}
				onZoom={zoom}
				onFit={() => fit()}
				onUntangle={startUntangle}
				onChooseComponent={chooseComponent}
				onUndo={() => store().undo()}
				onRedo={() => store().redo()}
			/>
			{connecting() && (
				<footer class="circuit-status">
					<output class="circuit-connection-status">
						<Show when={pendingPin()} fallback="Select pin">
							{(pin) =>
								`Connect ${pins().get(pin())?.component.reference}.${pins().get(pin())?.number}`
							}
						</Show>
					</output>
				</footer>
			)}
		</section>
	);
}
