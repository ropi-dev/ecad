import { netNodeBox } from "@ecad/drawing-core/circuit/graph.ts";
import type { CircuitNet } from "@ecad/drawing-core/circuit/model.ts";
import { memo } from "react";
import { CircuitInlineFields } from "#/components/circuit/CircuitInlineFields.tsx";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import type { CircuitGraphActions } from "#/components/circuit/circuitEditorState.ts";
import { GraphButton } from "#/components/circuit/GraphButton.tsx";
import { arrowDelta } from "#/lib/keyboard.ts";

/**
 * One net node on the circuit graph, with inline editing of the net name and
 * its aliases.
 */
export const CircuitNetNode = memo(function CircuitNetNode({
	net,
	x,
	y,
	label,
	tool,
	gridStep,
	selected,
	isEditing,
	isTarget,
	actions: { edit, finishEditing, openMenu, selectNet, startDrag, run, snap },
}: {
	net: CircuitNet;
	x: number;
	y: number;
	label: string;
	tool: CircuitTool;
	gridStep: number;
	selected: boolean;
	isEditing: boolean;
	isTarget: boolean;
	actions: CircuitGraphActions;
}) {
	return (
		<g>
			<GraphButton
				{...netNodeBox(label)}
				key={net.id}
				className={`circuit-net ${selected ? "is-selected" : ""} ${isTarget ? "is-target" : ""}`}
				aria-label={`Net ${label}`}
				data-circuit-net-id={net.id}
				onDoubleClick={() => {
					if (tool === "select") edit({ kind: "net", id: net.id });
				}}
				onContextMenu={(event) => openMenu(event, { kind: "net", id: net.id })}
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
					visibility={isEditing ? "hidden" : undefined}
				>
					{label}
				</text>
			</GraphButton>
			{isEditing && (
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
						const names = values.map((name) => name.trim()).filter(Boolean);
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
	);
});
