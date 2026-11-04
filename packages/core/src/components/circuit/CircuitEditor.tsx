import {
	buildCircuitGraph,
	componentHeight,
	componentWidth,
	connectionCurveOffset,
	netNodeBox,
} from "@ecad/drawing-core/circuit/graph.ts";
import { snapCircuitPoint } from "@ecad/drawing-core/circuit/grid.ts";
import type { GraphLayout } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import { untangleCircuitGraph } from "@ecad/drawing-core/circuit/untangle.ts";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
	lazy,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	Suspense,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { handleViewerKeyDown } from "#/engine/navigation.ts";
import { errorMessage } from "#/lib/error-message.ts";
import {
	arrowDelta,
	handleHistoryKeyDown,
	isEditableTarget,
} from "#/lib/keyboard.ts";
import {
	type CircuitDocument,
	useProject,
} from "#/projects/ProjectProvider.tsx";
import { type CircuitTool, CircuitToolbar } from "./CircuitToolbar.tsx";
import "./CircuitEditor.css";
import { CircuitConnection } from "./CircuitConnection.tsx";
import { CircuitContextMenu } from "./CircuitContextMenu.tsx";
import { CircuitInlineFields } from "./CircuitInlineFields.tsx";
import { GraphButton } from "./GraphButton.tsx";
import {
	type CircuitView,
	useCircuitNavigation,
} from "./useCircuitNavigation.ts";

const ErcPanel = lazy(() =>
	import("#/components/circuit/ErcPanel.tsx").then((module) => ({
		default: module.ErcPanel,
	})),
);

type Selection = {
	kind: "component" | "pin" | "net" | "connection";
	id: string;
} | null;
type Position = GraphLayout["positions"][number];
type Drag = {
	position: Position;
	start: { x: number; y: number };
	startClient: { x: number; y: number };
	active: boolean;
	x: number;
	y: number;
	pointerId: number;
};
type ConnectionDrag = {
	pinId: string;
	pointerId: number;
	start: { x: number; y: number };
	point: { x: number; y: number };
	active: boolean;
	target: { kind: "pin" | "net"; id: string } | null;
};

const viewStates = new WeakMap<CircuitDocument["store"], CircuitView>();

export function CircuitEditor({ document }: { document: CircuitDocument }) {
	const project = useProject();
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
	const [menu, setMenu] = useState<{
		selection: NonNullable<Selection>;
		x: number;
		y: number;
	} | null>(null);
	const [pan, setPan] = useState<{
		x: number;
		y: number;
		view: typeof view;
		pointerId: number;
	} | null>(null);
	const [checkedPins, setCheckedPins] = useState<string[]>([]);
	const [error, setError] = useState("");
	const [drag, setDrag] = useState<Drag | null>(null);
	const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag | null>(
		null,
	);
	const suppressPinClick = useRef(false);
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
	const connectionStart = connectionDrag?.active
		? graph.pinNodes.get(connectionDrag.pinId)
		: undefined;
	const targetNet =
		connectionDrag?.target?.kind === "net"
			? graph.nets.find((item) => item.net.id === connectionDrag.target?.id)
			: undefined;
	const connectionTarget = connectionDrag?.target
		? connectionDrag.target.kind === "pin"
			? graph.pinNodes.get(connectionDrag.target.id)
			: targetNet
				? { x: targetNet.x, y: targetNet.y, side: "left" as const }
				: undefined
		: undefined;
	const connectionEnd = connectionTarget ?? connectionDrag?.point;

	useEffect(() => {
		setDrag((current) =>
			current &&
			(current.position.kind === "component"
				? snapshot.circuit.components
				: snapshot.circuit.nets
			).some((item) => item.id === current.position.id)
				? current
				: null,
		);
		setConnectionDrag((current) =>
			current &&
			snapshot.circuit.components.some(
				(component) =>
					component.pins.some((pin) => pin.id === current.pinId) &&
					!(snapshot.graph.collapsedComponentIds ?? []).includes(component.id),
			)
				? current
				: null,
		);
		setCheckedPins([]);
		setSelection((current) => {
			if (!current) return null;
			if (current.kind === "connection") return null;
			const exists =
				current.kind === "net"
					? snapshot.circuit.nets.some((net) => net.id === current.id)
					: current.kind === "component"
						? snapshot.circuit.components.some(
								(component) => component.id === current.id,
							)
						: snapshot.circuit.components.some(
								(component) =>
									component.pins.some((pin) => pin.id === current.id) &&
									!(snapshot.graph.collapsedComponentIds ?? []).includes(
										component.id,
									),
							);
			return exists ? current : null;
		});
		setEditing((current) =>
			current &&
			(current.kind === "net"
				? snapshot.circuit.nets
				: snapshot.circuit.components
			).some((item) => item.id === current.id)
				? current
				: null,
		);
		setPendingPin((id) =>
			id &&
			snapshot.circuit.components.some((component) =>
				component.pins.some((pin) => pin.id === id),
			)
				? id
				: null,
		);
	}, [snapshot]);
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
	function selectConnection(id: string, additive: boolean) {
		if (tool !== "select") return;
		const next = additive
			? checkedPins.includes(id)
				? checkedPins.filter((pinId) => pinId !== id)
				: [...checkedPins, id]
			: [id];
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
			if (!checkedPins.includes(item.id)) selectConnection(item.id, false);
		} else select(item);
		const bounds = svg.current?.getBoundingClientRect();
		if (bounds)
			setMenu({
				selection: item,
				x: Math.max(
					0,
					Math.min(
						(Number.isFinite(event.clientX) ? event.clientX : bounds.x + 20) -
							bounds.x,
						bounds.width - 190,
					),
				),
				y: Math.max(
					0,
					Math.min(
						(Number.isFinite(event.clientY) ? event.clientY : bounds.y + 20) -
							bounds.y,
						bounds.height - 150,
					),
				),
			});
	}
	const menuPin = menu?.selection.kind === "pin" ? menu.selection.id : null;
	const splitNet =
		menu?.selection.kind === "connection"
			? pinNets.get(menu.selection.id)
			: undefined;
	const splitPins =
		menu?.selection.kind === "connection" &&
		checkedPins.includes(menu.selection.id)
			? checkedPins
			: menu?.selection.kind === "connection"
				? [menu.selection.id]
				: [];
	const menuActions = !menu
		? []
		: menuPin
			? [
					{
						label: "Connect",
						run: () => {
							setConnecting(true);
							setPendingPin(menuPin);
						},
					},
					{
						label: "Disconnect",
						disabled: !pinNets.has(menuPin),
						run: () => {
							run({ type: "disconnect", pinIds: [menuPin] });
						},
					},
					{
						label: circuit.noConnectPinIds.includes(menuPin)
							? "Allow connection"
							: "No connect",
						run: () => {
							run({
								type: "no-connect",
								pinId: menuPin,
								enabled: !circuit.noConnectPinIds.includes(menuPin),
							});
						},
					},
				]
			: menu.selection.kind === "connection"
				? [
						{ label: "Disconnect", run: () => deleteSelection(menu.selection) },
						{
							label: "Split net",
							disabled:
								!splitNet ||
								splitPins.length >= splitNet.pinIds.length ||
								splitPins.some((id) => pinNets.get(id)?.id !== splitNet.id),
							run: () => {
								if (splitNet)
									run({
										type: "split-net",
										netId: splitNet.id,
										pinIds: splitPins,
									});
							},
						},
					]
				: [
						{
							label:
								menu.selection.kind === "net" ? "Rename net" : "Edit component",
							run: () => edit(menu.selection),
						},
						{
							label:
								menu.selection.kind === "net"
									? "Delete net"
									: "Delete component",
							run: () => deleteSelection(menu.selection),
						},
					];
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
	function point(event: { clientX: number; clientY: number }) {
		const matrix = svg.current?.getScreenCTM()?.inverse();
		if (!matrix) return { x: 0, y: 0 };
		return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
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

	function connectionDropTarget(
		event: { clientX: number; clientY: number },
		sourceId: string,
	): ConnectionDrag["target"] {
		const button = svg.current?.ownerDocument
			.elementFromPoint(event.clientX, event.clientY)
			?.closest("button[data-circuit-pin-id], button[data-circuit-net-id]");
		const id = button?.getAttribute("data-circuit-pin-id");
		const netId = button?.getAttribute("data-circuit-net-id");
		if (!svg.current?.contains(button ?? null)) return null;
		return netId
			? { kind: "net", id: netId }
			: id && id !== sourceId
				? { kind: "pin", id }
				: null;
	}
	function cancelConnectionDrag() {
		if (!connectionDrag) return;
		suppressPinClick.current = true;
		setConnectionDrag(null);
		if (svg.current?.hasPointerCapture(connectionDrag.pointerId)) {
			svg.current.releasePointerCapture(connectionDrag.pointerId);
		}
	}
	function startConnectionDrag(
		event: ReactPointerEvent<HTMLButtonElement>,
		pinId: string,
	) {
		if (event.button !== 0 || (tool !== "select" && tool !== "connect")) return;
		event.preventDefault();
		event.stopPropagation();
		svg.current?.focus({ preventScroll: true });
		svg.current?.setPointerCapture(event.pointerId);
		setConnectionDrag({
			pinId,
			pointerId: event.pointerId,
			start: { x: event.clientX, y: event.clientY },
			point: point(event),
			active: false,
			target: null,
		});
	}
	function startDrag(
		event: ReactPointerEvent<HTMLButtonElement>,
		position: Position,
	) {
		if (event.button !== 0 || tool !== "select") return;
		event.stopPropagation();
		select({ kind: position.kind, id: position.id });
		setCheckedPins([]);
		event.currentTarget.setPointerCapture(event.pointerId);
		setDrag({
			position,
			start: point(event),
			startClient: { x: event.clientX, y: event.clientY },
			active: false,
			x: position.x,
			y: position.y,
			pointerId: event.pointerId,
		});
	}
	function fit(nextGraph = graph, resetZoom = true) {
		const bounds = svg.current?.getBoundingClientRect();
		const viewport = {
			width: bounds?.width || 1600,
			height: bounds?.height || 760,
		};
		const points = [
			...nextGraph.components.map((component) => ({
				x: component.x,
				y: component.y,
				width: componentWidth,
				height: component.height,
			})),
			...nextGraph.nets.map((net) => {
				const box = netNodeBox(net.label);
				return { ...box, x: net.x + box.x, y: net.y + box.y };
			}),
		];
		if (!points.length) {
			setView({ x: 0, y: 0, ...viewport });
			return;
		}
		if (resetZoom) {
			setView({
				x:
					(Math.min(...points.map((point) => point.x)) +
						Math.max(...points.map((point) => point.x + point.width))) /
						2 -
					viewport.width / 2,
				y:
					(Math.min(...points.map((point) => point.y)) +
						Math.max(...points.map((point) => point.y + point.height))) /
						2 -
					viewport.height / 2,
				...viewport,
			});
			return;
		}
		const x = Math.min(...points.map((point) => point.x)) - 60;
		const y = Math.min(...points.map((point) => point.y)) - 60;
		const canvasHeight = svg.current?.getBoundingClientRect().height || 760;
		setView({
			x,
			y,
			width: Math.max(
				600,
				Math.max(...points.map((point) => point.x + point.width)) - x + 60,
			),
			height:
				(Math.max(
					400,
					Math.max(...points.map((point) => point.y + point.height)) - y + 60,
				) *
					canvasHeight) /
				Math.max(100, canvasHeight - 96),
		});
	}
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
			{(error || project?.error) && (
				<div role="alert" className="circuit-error">
					{error || project?.error}
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
						onPointerDownCapture={() => {
							suppressPinClick.current = false;
						}}
						onPointerLeave={() => setPlacementPoint(null)}
						onClickCapture={(event) => {
							if (suppressPinClick.current && event.detail > 0) {
								suppressPinClick.current = false;
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (
								(tool === "net" || (tool === "component" && placement)) &&
								event.button === 0
							) {
								event.preventDefault();
								event.stopPropagation();
								placeAt(
									tool === "component"
										? componentPosition(point(event), placementPinCount)
										: point(event),
								);
							}
						}}
						onPointerDown={(event) => {
							if (
								!(event.target instanceof Element) ||
								!event.target.closest("button")
							) {
								event.currentTarget.focus({ preventScroll: true });
								if (event.button === 0 && tool === "select") select(null);
							}
							if (event.button !== 1 && (tool !== "pan" || event.button !== 0))
								return;
							event.preventDefault();
							event.currentTarget.setPointerCapture(event.pointerId);
							setPan({
								x: event.clientX,
								y: event.clientY,
								view,
								pointerId: event.pointerId,
							});
						}}
						onPointerMove={(event) => {
							// An active pan owns its pointer, even while a placement tool is
							// active. Leaving placementPoint untouched keeps the preview under
							// the cursor, since panning keeps the cursor's graph point fixed.
							if (pan?.pointerId === event.pointerId) {
								const matrix = svg.current?.getScreenCTM();
								if (matrix)
									setView({
										...pan.view,
										x: pan.view.x - (event.clientX - pan.x) / matrix.a,
										y: pan.view.y - (event.clientY - pan.y) / matrix.d,
									});
								return;
							}
							if (connectionDrag?.pointerId === event.pointerId) {
								setConnectionDrag({
									...connectionDrag,
									point: point(event),
									active:
										connectionDrag.active ||
										Math.hypot(
											event.clientX - connectionDrag.start.x,
											event.clientY - connectionDrag.start.y,
										) > 4,
									target: connectionDropTarget(event, connectionDrag.pinId),
								});
								return;
							}
							if ((tool === "component" && placement) || tool === "net") {
								setPlacementPoint(
									tool === "component"
										? componentPosition(point(event), placementPinCount)
										: snap(point(event)),
								);
								return;
							}
							if (!drag || drag.pointerId !== event.pointerId) return;
							const current = point(event);
							const active =
								drag.active ||
								Math.hypot(
									event.clientX - drag.startClient.x,
									event.clientY - drag.startClient.y,
								) > 3;
							const position = active
								? snap({
										x: drag.position.x + current.x - drag.start.x,
										y: drag.position.y + current.y - drag.start.y,
									})
								: drag.position;
							setDrag({
								...drag,
								active,
								x: position.x,
								y: position.y,
							});
						}}
						onPointerUp={(event) => {
							if (pan?.pointerId === event.pointerId) {
								setPan(null);
								return;
							}
							if (connectionDrag?.pointerId === event.pointerId) {
								suppressPinClick.current = true;
								setConnectionDrag(null);
								if (!connectionDrag.active) selectPin(connectionDrag.pinId);
								else {
									const target = connectionDropTarget(
										event,
										connectionDrag.pinId,
									);
									if (target) {
										const targetNetId =
											target.kind === "net"
												? target.id
												: pinNets.get(target.id)?.id;
										const sameNet =
											targetNetId &&
											pinNets.get(connectionDrag.pinId)?.id === targetNetId;
										const command: CircuitCommand =
											target.kind === "net"
												? {
														type: "connect",
														pinIds: [connectionDrag.pinId],
														netId: target.id,
													}
												: {
														type: "connect",
														pinIds: [connectionDrag.pinId, target.id],
													};
										if (sameNet || run(command)) {
											setPendingPin(null);
											setConnecting(false);
											select(target);
										}
									}
								}
								return;
							}
							if (!drag || drag.pointerId !== event.pointerId) return;
							const current = point(event);
							const { x, y } = snap({
								x: drag.position.x + current.x - drag.start.x,
								y: drag.position.y + current.y - drag.start.y,
							});
							const active =
								drag.active ||
								Math.hypot(
									event.clientX - drag.startClient.x,
									event.clientY - drag.startClient.y,
								) > 3;
							if (active && (x !== drag.position.x || y !== drag.position.y))
								run({ type: "move", positions: [{ ...drag.position, x, y }] });
							setDrag(null);
						}}
						onPointerCancel={() => {
							cancelConnectionDrag();
							setDrag(null);
							setPan(null);
						}}
						onLostPointerCapture={() => setConnectionDrag(null)}
					>
						<title>Components, pins, and shared electrical nets</title>
						{graph.edges.map((edge) => (
							<CircuitConnection
								key={`${edge.netId}:${edge.pinId}`}
								pin={edge.pin}
								net={edge.net}
								label={`Connection ${pins.get(edge.pinId)?.component.reference}.${pins.get(edge.pinId)?.number}`}
								selected={checkedPins.includes(edge.pinId)}
								highlighted={selectedNetId === edge.netId}
								onSelect={(event) => {
									event.stopPropagation();
									selectConnection(
										edge.pinId,
										event.shiftKey || event.ctrlKey || event.metaKey,
									);
								}}
								onContextMenu={(event) =>
									openMenu(event, { kind: "connection", id: edge.pinId })
								}
							/>
						))}
						{graph.components.map(
							({
								component,
								x,
								y,
								height,
								collapsed,
								connectionSides,
								visiblePins,
							}) => (
								<g
									key={component.id}
									className={`circuit-component ${selection?.id === component.id ? "is-selected" : ""}`}
									transform={`translate(${x},${y})`}
								>
									<rect
										className="circuit-component-body"
										width={componentWidth}
										height={height}
										rx="10"
									/>
									<GraphButton
										width={componentWidth}
										height={65}
										className="circuit-node-handle"
										aria-label={`Select component ${component.reference}`}
										onDoubleClick={() => {
											if (tool === "select")
												edit({ kind: "component", id: component.id });
										}}
										onContextMenu={(event) =>
											openMenu(event, { kind: "component", id: component.id })
										}
										onClick={() => {
											if (tool === "select")
												select({ kind: "component", id: component.id });
										}}
										onPointerDown={(event) =>
											startDrag(event, {
												id: component.id,
												kind: "component",
												x,
												y,
											})
										}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												select({ kind: "component", id: component.id });
											}
											const delta = arrowDelta(event.key, gridStep);
											if (delta) {
												event.preventDefault();
												run({
													type: "move",
													positions: [
														{
															id: component.id,
															kind: "component",
															...snap({ x: x + delta.x, y: y + delta.y }),
														},
													],
												});
											}
										}}
									>
										<rect
											width={componentWidth}
											height="65"
											rx="10"
											fill="transparent"
										/>
										<text className="circuit-reference" x="18" y="28">
											{component.reference}
										</text>
										<text className="circuit-value" x="18" y="49">
											{component.value || component.part.name}
										</text>
									</GraphButton>
									<g
										className="circuit-collapse-footer"
										style={{ transform: `translateY(${height - 32}px)` }}
									>
										<GraphButton
											x={(componentWidth - 28) / 2}
											y={0}
											width={28}
											height={28}
											className="circuit-collapse-button"
											aria-label={`${collapsed ? "Expand" : "Collapse"} ${component.reference}`}
											aria-expanded={!collapsed}
											title={collapsed ? "Show pins" : "Hide pins"}
											onPointerDown={(event) => {
												if (tool === "select") event.stopPropagation();
											}}
											onClick={(event) => {
												event.stopPropagation();
												if (tool !== "select") return;
												select({ kind: "component", id: component.id });
												run({
													type: "set-component-collapsed",
													id: component.id,
													collapsed: !collapsed,
												});
											}}
										>
											<rect
												className="circuit-collapse-control"
												x={(componentWidth - 28) / 2}
												y={0}
												width={28}
												height={28}
												rx={4}
											/>
											{collapsed ? (
												<ChevronDown
													x={(componentWidth - 20) / 2}
													y={4}
													size={20}
												/>
											) : (
												<ChevronUp
													x={(componentWidth - 20) / 2}
													y={4}
													size={20}
												/>
											)}
										</GraphButton>
									</g>
									{collapsed &&
										connectionSides.map((side) => (
											<circle
												key={side}
												data-side={side}
												className="circuit-collapsed-anchor"
												cx={side === "left" ? 0 : componentWidth}
												cy={32}
												r={6}
											/>
										))}
									{editing?.kind === "component" &&
										editing.id === component.id && (
											<CircuitInlineFields
												x={8}
												y={4}
												width={componentWidth - 16}
												fields={[
													{
														label: "Reference",
														value: component.reference,
														maxLength: 200,
														required: true,
													},
													{
														label: "Value",
														value: component.value,
														maxLength: 200,
													},
												]}
												onCancel={finishEditing}
												onCommit={([reference, value]) => {
													if (
														(reference === component.reference &&
															value === component.value) ||
														run({
															type: "update-component",
															id: component.id,
															reference,
															value,
														})
													) {
														finishEditing();
														return true;
													}
													return false;
												}}
											/>
										)}
									{visiblePins.map((pin, index) => (
										<GraphButton
											x={-24}
											y={70 + index * 30}
											width={248}
											height={28}
											key={pin.id}
											aria-label={`Pin ${component.reference}.${pin.number}`}
											data-circuit-pin-id={pin.id}
											onContextMenu={(event) =>
												openMenu(event, { kind: "pin", id: pin.id })
											}
											className={`circuit-pin ${selection?.id === pin.id || pendingPin === pin.id || (connectionStart && connectionDrag?.pinId === pin.id) ? "is-selected" : ""} ${connectionDrag?.active && connectionDrag.target?.kind === "pin" && connectionDrag.target.id === pin.id ? "is-target" : ""}`}
											onPointerDown={(event) =>
												startConnectionDrag(event, pin.id)
											}
											onClick={() => selectPin(pin.id)}
											onKeyDown={(event) => {
												if (event.key === "Enter" || event.key === " ") {
													event.preventDefault();
													selectPin(pin.id);
												}
											}}
										>
											<rect
												x="8"
												y={70 + index * 30}
												width="202"
												height="28"
												fill="transparent"
											/>
											<text x="18" y={89 + index * 30}>
												{pin.number}
												<tspan className="circuit-pin-name" dx="10">
													{pin.name}
												</tspan>
											</text>
											<circle
												className={pinNets.has(pin.id) ? "connected" : ""}
												cx={
													(graph.pinNodes.get(pin.id)?.x ??
														x + componentWidth) - x
												}
												cy={84 + index * 30}
												r="6"
											/>
											{circuit.noConnectPinIds.includes(pin.id) && (
												<path
													className="circuit-no-connect"
													d={`M ${graph.pinNodes.get(pin.id)?.side === "left" ? -21 : 211} ${79 + index * 30} l 10 10 m 0 -10 l -10 10`}
												/>
											)}
										</GraphButton>
									))}
								</g>
							),
						)}
						{graph.nets.map(({ net, x, y, label }) => (
							<g key={net.id}>
								<GraphButton
									{...netNodeBox(label)}
									key={net.id}
									className={`circuit-net ${selectedNetId === net.id ? "is-selected" : ""} ${connectionDrag?.active && connectionDrag.target?.kind === "net" && connectionDrag.target.id === net.id ? "is-target" : ""}`}
									aria-label={`Net ${label}`}
									data-circuit-net-id={net.id}
									onDoubleClick={() => {
										if (tool === "select") edit({ kind: "net", id: net.id });
									}}
									onContextMenu={(event) =>
										openMenu(event, { kind: "net", id: net.id })
									}
									transform={`translate(${x},${y})`}
									onClick={() => selectNet(net.id)}
									onPointerDown={(event) =>
										startDrag(event, { id: net.id, kind: "net", x, y })
									}
									onKeyDown={(event) => {
										if (event.key === "Enter" && tool === "select") {
											event.preventDefault();
											edit({ kind: "net", id: net.id });
											return;
										}
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											selectNet(net.id);
										}
										const delta = arrowDelta(event.key, gridStep);
										if (delta) {
											event.preventDefault();
											run({
												type: "move",
												positions: [
													{
														id: net.id,
														kind: "net",
														...snap({ x: x + delta.x, y: y + delta.y }),
													},
												],
											});
										}
									}}
								>
									<circle r="10" />
									<text
										y="-23"
										textAnchor="middle"
										visibility={
											editing?.kind === "net" && editing.id === net.id
												? "hidden"
												: undefined
										}
									>
										{label}
									</text>
								</GraphButton>
								{editing?.kind === "net" && editing.id === net.id && (
									<CircuitInlineFields
										x={x - 110}
										y={y - 58}
										width={220}
										fields={(net.names.length
											? net.names
											: [net.pinIds.length ? label : ""]
										).map((value, index) => ({
											label: index ? `Net alias ${index}` : "Net name",
											value,
											maxLength: 200,
										}))}
										repeatable={{
											label: "Net alias",
											action: "Add alias",
											maxLength: 200,
										}}
										onCancel={finishEditing}
										onCommit={(values) => {
											const names = values
												.map((name) => name.trim())
												.filter(Boolean);
											if (
												(!net.names.length &&
													values.length === 1 &&
													values[0].trim() === label) ||
												JSON.stringify(names) === JSON.stringify(net.names) ||
												run({ type: "rename-net", id: net.id, names })
											) {
												finishEditing();
												return true;
											}
											return false;
										}}
									/>
								)}
							</g>
						))}
						{connectionStart && connectionEnd && (
							<path
								data-connection-preview=""
								className="circuit-connection-preview"
								d={`M ${connectionStart.x} ${connectionStart.y} C ${connectionStart.x + (connectionStart.side === "left" ? -connectionCurveOffset : connectionCurveOffset)} ${connectionStart.y}, ${connectionEnd.x + (connectionTarget?.side === "right" ? connectionCurveOffset : -connectionCurveOffset)} ${connectionEnd.y}, ${connectionEnd.x} ${connectionEnd.y}`}
							/>
						)}
						{tool === "component" && placement && placementPoint && (
							<g
								data-component-preview=""
								className="circuit-placement-preview"
								transform={`translate(${placementPoint.x},${placementPoint.y})`}
							>
								<rect
									width={componentWidth}
									height={componentHeight(placementPinCount)}
									rx={10}
								/>
								<text x={18} y={28}>
									{placement.name}
								</text>
							</g>
						)}
						{tool === "net" && placementPoint && (
							<g
								data-net-preview=""
								className="circuit-net circuit-placement-preview"
								transform={`translate(${placementPoint.x},${placementPoint.y})`}
							>
								<circle r={10} />
								<text y={-23} textAnchor="middle">
									Net
								</text>
							</g>
						)}
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
						<output className="absolute right-3 top-14 z-20 bg-slate-900 p-4">
							Loading electrical checks...
						</output>
					}
				>
					<ErcPanel
						circuit={circuit}
						onClose={() => {
							setErcOpen(false);
							svg.current?.focus();
						}}
						onSelect={(subject) => {
							let targetGraph = graph;
							if (subject.kind === "pin") {
								const owner = graph.components.find((component) =>
									component.component.pins.some((pin) => pin.id === subject.id),
								);
								if (owner?.collapsed) {
									if (
										!run({
											type: "set-component-collapsed",
											id: owner.id,
											collapsed: false,
										})
									)
										return;
									targetGraph = buildCircuitGraph(store.getSnapshot());
								}
							}
							select(subject);
							const point =
								subject.kind === "pin"
									? targetGraph.pinNodes.get(subject.id)
									: subject.kind === "net"
										? targetGraph.nets.find((net) => net.id === subject.id)
										: targetGraph.components.find(
												(component) => component.id === subject.id,
											);
							if (point)
								setView((current) => ({
									...current,
									x: point.x - current.width / 2,
									y: point.y - current.height / 2,
								}));
						}}
					/>
				</Suspense>
			)}
			<CircuitToolbar
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
				onPan={(x, y) =>
					setView((current) => ({
						...current,
						x: current.x + current.width * x,
						y: current.y + current.height * y,
					}))
				}
				onUntangle={() => {
					cancelConnectionDrag();
					setDrag(null);
					setPendingPin(null);
					if (
						run({
							type: "move",
							positions: untangleCircuitGraph(
								{ circuit, graph: snapshot.graph },
								gridStep,
							),
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
