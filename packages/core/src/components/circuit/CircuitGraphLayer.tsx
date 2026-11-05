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
export function CircuitGraphLayer({
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
	return (
		<>
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
						actions.selectConnection(
							edge.pinId,
							event.shiftKey || event.ctrlKey || event.metaKey,
						);
					}}
					onContextMenu={(event) =>
						actions.openMenu(event, { kind: "connection", id: edge.pinId })
					}
				/>
			))}
			{graph.components.map((node) => (
				<CircuitComponentNode
					key={node.component.id}
					node={node}
					pinNodes={graph.pinNodes}
					pinNets={pinNets}
					noConnectPinIds={noConnectPinIds}
					tool={tool}
					gridStep={gridStep}
					selection={selection}
					editing={editing}
					pendingPin={pendingPin}
					connectionDrag={connectionDrag}
					connectionStarted={!!connectionStart}
					actions={actions}
				/>
			))}
			{graph.nets.map((node) => (
				<CircuitNetNode
					key={node.net.id}
					node={node}
					tool={tool}
					gridStep={gridStep}
					selectedNetId={selectedNetId}
					editing={editing}
					connectionDrag={connectionDrag}
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
}
