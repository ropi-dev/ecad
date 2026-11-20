import {
	componentHeight,
	componentWidth,
	connectionCurveOffset,
} from "@ecad/drawing-core/circuit/graph.ts";
import type {
	CircuitComponent,
	CircuitNet,
	CircuitPin,
} from "@ecad/drawing-core/circuit/model.ts";
import { createMemo, For, Show } from "solid-js";
import { CircuitComponentNode } from "#/components/circuit/CircuitComponentNode.tsx";
import { CircuitConnection } from "#/components/circuit/CircuitConnection.tsx";
import { CircuitNetNode } from "#/components/circuit/CircuitNetNode.tsx";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import {
	type CircuitGraph,
	type CircuitGraphActions,
	type CircuitSelection,
	type ConnectionDrag,
	createIdFlags,
} from "#/components/circuit/circuitEditorState.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

/**
 * The circuit graph's SVG content: connections, components, nets, the
 * connection being dragged and the placement preview.
 */
export function CircuitGraphLayer(props: {
	graph: CircuitGraph;
	pins: ReadonlyMap<string, CircuitPin & { component: CircuitComponent }>;
	pinNets: ReadonlyMap<string, CircuitNet>;
	noConnectPinIds: readonly string[];
	tool: CircuitTool;
	gridStep: number;
	selection: CircuitSelection;
	selectedNetId: string | undefined;
	checkedPins: string[];
	editing: CircuitSelection;
	pendingPin: string | null;
	connectionDrag: ConnectionDrag | null;
	placement: SymbolDefinition | null;
	placementPoint: { x: number; y: number } | null;
	placementPinCount: number;
	actions: CircuitGraphActions;
}) {
	const connectionStart = createMemo(() =>
		props.connectionDrag?.active
			? props.graph.pinNodes.get(props.connectionDrag.pinId)
			: undefined,
	);
	const target = createMemo(() =>
		props.connectionDrag?.active ? props.connectionDrag.target : null,
	);
	const connectionTarget = createMemo(() => {
		const dragTarget = props.connectionDrag?.target;
		if (!dragTarget) return undefined;
		if (dragTarget.kind === "pin")
			return props.graph.pinNodes.get(dragTarget.id);
		const net = props.graph.nets.find((item) => item.net.id === dragTarget.id);
		return net ? { x: net.x, y: net.y, side: "left" as const } : undefined;
	});
	const connectionPath = createMemo(() => {
		const start = connectionStart();
		const end = connectionTarget() ?? props.connectionDrag?.point;
		if (!start || !end) return undefined;
		return `M ${start.x} ${start.y} C ${start.x + (start.side === "left" ? -connectionCurveOffset : connectionCurveOffset)} ${start.y}, ${end.x + (connectionTarget()?.side === "right" ? connectionCurveOffset : -connectionCurveOffset)} ${end.y}, ${end.x} ${end.y}`;
	});
	const checked = createIdFlags(() => props.checkedPins);
	const selectedNet = createIdFlags(() => [props.selectedNetId]);
	const selected = createIdFlags(() => [props.selection?.id]);
	const highlightedPins = createIdFlags(() => [
		props.selection?.id,
		props.pendingPin,
		connectionStart() ? props.connectionDrag?.pinId : null,
	]);
	const targetPins = createIdFlags(() => {
		const current = target();
		return [current?.kind === "pin" ? current.id : null];
	});
	const targetNets = createIdFlags(() => {
		const current = target();
		return [current?.kind === "net" ? current.id : null];
	});
	return (
		<>
			<For
				each={props.graph.edges}
				keyed={(edge) => `${edge.netId}:${edge.pinId}`}
			>
				{(edge) => (
					<CircuitConnection
						pinId={edge().pinId}
						pinX={edge().pin.x}
						pinY={edge().pin.y}
						side={edge().pin.side}
						netX={edge().net.x}
						netY={edge().net.y}
						label={`Connection ${props.pins.get(edge().pinId)?.component.reference}.${props.pins.get(edge().pinId)?.number}`}
						selected={checked[edge().pinId] === true}
						highlighted={selectedNet[edge().netId] === true}
						actions={props.actions}
					/>
				)}
			</For>
			<For each={props.graph.components} keyed={(node) => node.id}>
				{(node) => {
					const pinSides = createMemo(() =>
						node()
							.component.pins.map((pin) =>
								props.graph.pinNodes.get(pin.id)?.side === "left" ? "l" : "r",
							)
							.join(""),
					);
					return (
						<CircuitComponentNode
							component={node().component}
							x={node().x}
							y={node().y}
							height={node().height}
							collapsed={node().collapsed}
							connectsLeft={node().connectionSides.includes("left")}
							connectsRight={node().connectionSides.includes("right")}
							pinSides={pinSides()}
							pinNets={props.pinNets}
							noConnectPinIds={props.noConnectPinIds}
							tool={props.tool}
							gridStep={props.gridStep}
							selected={selected[node().id] === true}
							isEditing={
								props.editing?.kind === "component" &&
								props.editing.id === node().id
							}
							highlightedPins={highlightedPins}
							targetPins={targetPins}
							actions={props.actions}
						/>
					);
				}}
			</For>
			<For each={props.graph.nets} keyed={(node) => node.id}>
				{(node) => (
					<CircuitNetNode
						net={node().net}
						x={node().x}
						y={node().y}
						label={node().label}
						tool={props.tool}
						gridStep={props.gridStep}
						selected={selectedNet[node().id] === true}
						isEditing={
							props.editing?.kind === "net" && props.editing.id === node().id
						}
						isTarget={targetNets[node().id] === true}
						actions={props.actions}
					/>
				)}
			</For>
			<Show when={connectionPath()}>
				{(path) => (
					<path
						data-connection-preview=""
						class="circuit-connection-preview"
						d={path()}
					/>
				)}
			</Show>
			<Show
				when={
					props.tool === "component" && props.placement && props.placementPoint
				}
			>
				<g
					data-component-preview=""
					class="circuit-placement-preview"
					transform={`translate(${props.placementPoint?.x},${props.placementPoint?.y})`}
				>
					<rect
						width={componentWidth}
						height={componentHeight(props.placementPinCount)}
						rx={10}
					/>
					<text x={18} y={28}>
						{props.placement?.name}
					</text>
				</g>
			</Show>
			<Show when={props.tool === "net" && props.placementPoint}>
				{(point) => (
					<g
						data-net-preview=""
						class="circuit-net circuit-placement-preview"
						transform={`translate(${point().x},${point().y})`}
					>
						<circle r={10} />
						<text y={-23} text-anchor="middle">
							Net
						</text>
					</g>
				)}
			</Show>
		</>
	);
}
