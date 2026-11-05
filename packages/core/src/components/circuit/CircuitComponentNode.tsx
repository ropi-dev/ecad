import { componentWidth } from "@ecad/drawing-core/circuit/graph.ts";
import type { CircuitNet } from "@ecad/drawing-core/circuit/model.ts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { CircuitInlineFields } from "#/components/circuit/CircuitInlineFields.tsx";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import type {
	CircuitGraph,
	CircuitGraphActions,
	CircuitSelection,
	ConnectionDrag,
} from "#/components/circuit/circuitEditorState.ts";
import { GraphButton } from "#/components/circuit/GraphButton.tsx";
import { arrowDelta } from "#/lib/keyboard.ts";

/**
 * One component box on the circuit graph: its header handle, the collapse
 * button, inline reference and value editing, and a button for each visible
 * pin.
 */
export function CircuitComponentNode({
	node: { component, x, y, height, collapsed, connectionSides, visiblePins },
	pinNodes,
	pinNets,
	noConnectPinIds,
	tool,
	gridStep,
	selection,
	editing,
	pendingPin,
	connectionDrag,
	connectionStarted,
	actions,
}: {
	node: CircuitGraph["components"][number];
	pinNodes: CircuitGraph["pinNodes"];
	pinNets: ReadonlyMap<string, CircuitNet>;
	noConnectPinIds: readonly string[];
	tool: CircuitTool;
	gridStep: number;
	selection: CircuitSelection;
	editing: CircuitSelection;
	pendingPin: string | null;
	connectionDrag: ConnectionDrag | null;
	connectionStarted: boolean;
	actions: CircuitGraphActions;
}) {
	const {
		select,
		edit,
		finishEditing,
		openMenu,
		selectPin,
		startDrag,
		startConnectionDrag,
		run,
		snap,
	} = actions;
	return (
		<g
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
					if (tool === "select") edit({ kind: "component", id: component.id });
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
				<rect width={componentWidth} height="65" rx="10" fill="transparent" />
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
						<ChevronDown x={(componentWidth - 20) / 2} y={4} size={20} />
					) : (
						<ChevronUp x={(componentWidth - 20) / 2} y={4} size={20} />
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
			{editing?.kind === "component" && editing.id === component.id && (
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
					className={`circuit-pin ${selection?.id === pin.id || pendingPin === pin.id || (connectionStarted && connectionDrag?.pinId === pin.id) ? "is-selected" : ""} ${connectionDrag?.active && connectionDrag.target?.kind === "pin" && connectionDrag.target.id === pin.id ? "is-target" : ""}`}
					onPointerDown={(event) => startConnectionDrag(event, pin.id)}
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
						cx={(pinNodes.get(pin.id)?.x ?? x + componentWidth) - x}
						cy={84 + index * 30}
						r="6"
					/>
					{noConnectPinIds.includes(pin.id) && (
						<path
							className="circuit-no-connect"
							d={`M ${pinNodes.get(pin.id)?.side === "left" ? -21 : 211} ${79 + index * 30} l 10 10 m 0 -10 l -10 10`}
						/>
					)}
				</GraphButton>
			))}
		</g>
	);
}
