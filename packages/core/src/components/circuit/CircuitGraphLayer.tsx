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
import { memo } from "react";
import { CircuitComponentNode } from "#/components/circuit/CircuitComponentNode.tsx";
import { CircuitConnection } from "#/components/circuit/CircuitConnection.tsx";
import { CircuitNetNode } from "#/components/circuit/CircuitNetNode.tsx";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import type {
	CircuitGraph,
	CircuitGraphActions,
	CircuitSelection,
	ConnectionDrag,
} from "#/components/circuit/circuitEditorState.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

/**
 * The circuit graph's SVG content: connections, components, nets, the
 * connection being dragged and the placement preview.
 */
export const CircuitGraphLayer = memo(function CircuitGraphLayer({
	graph,
	pins,
	pinNets,
	noConnectPinIds,
	tool,
	gridStep,
	selection,
	selectedNetId,
	checkedPins,
	editing,
	pendingPin,
	connectionDrag,
	placement,
	placementPoint,
	placementPinCount,
	actions,
}: {
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
	const targetId = connectionDrag?.active ? connectionDrag.target : null;
	const pinOf = (componentId: string, pinId: string | null | undefined) =>
		pinId && graph.pinNodes.get(pinId)?.componentId === componentId
			? pinId
			: null;
	return (
		<>
			{graph.edges.map((edge) => (
				<CircuitConnection
					key={`${edge.netId}:${edge.pinId}`}
					pinId={edge.pinId}
					pinX={edge.pin.x}
					pinY={edge.pin.y}
					side={edge.pin.side}
					netX={edge.net.x}
					netY={edge.net.y}
					label={`Connection ${pins.get(edge.pinId)?.component.reference}.${pins.get(edge.pinId)?.number}`}
					selected={checkedPins.includes(edge.pinId)}
					highlighted={selectedNetId === edge.netId}
					actions={actions}
				/>
			))}
			{graph.components.map((node) => (
				<CircuitComponentNode
					key={node.id}
					component={node.component}
					x={node.x}
					y={node.y}
					height={node.height}
					collapsed={node.collapsed}
					connectsLeft={node.connectionSides.includes("left")}
					connectsRight={node.connectionSides.includes("right")}
					pinSides={node.component.pins
						.map((pin) =>
							graph.pinNodes.get(pin.id)?.side === "left" ? "l" : "r",
						)
						.join("")}
					pinNets={pinNets}
					noConnectPinIds={noConnectPinIds}
					tool={tool}
					gridStep={gridStep}
					selected={selection?.id === node.id}
					isEditing={editing?.kind === "component" && editing.id === node.id}
					selectedPinId={pinOf(node.id, selection?.id)}
					pendingPinId={pinOf(node.id, pendingPin)}
					dragSourcePinId={
						connectionStart ? pinOf(node.id, connectionDrag?.pinId) : null
					}
					targetPinId={
						targetId?.kind === "pin" ? pinOf(node.id, targetId.id) : null
					}
					actions={actions}
				/>
			))}
			{graph.nets.map((node) => (
				<CircuitNetNode
					key={node.id}
					net={node.net}
					x={node.x}
					y={node.y}
					label={node.label}
					tool={tool}
					gridStep={gridStep}
					selected={selectedNetId === node.id}
					isEditing={editing?.kind === "net" && editing.id === node.id}
					isTarget={targetId?.kind === "net" && targetId.id === node.id}
					actions={actions}
				/>
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
		</>
	);
});
