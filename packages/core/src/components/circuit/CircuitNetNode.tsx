import { netNodeBox } from "@ecad/drawing-core/circuit/graph.ts";
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
 * One net node on the circuit graph, with inline editing of the net name and
 * its aliases.
 */
export function CircuitNetNode({
	node: { net, x, y, label },
	tool,
	gridStep,
	selectedNetId,
	editing,
	connectionDrag,
	actions: { edit, finishEditing, openMenu, selectNet, startDrag, run, snap },
}: {
	node: CircuitGraph["nets"][number];
	tool: CircuitTool;
	gridStep: number;
	selectedNetId: string | undefined;
	editing: CircuitSelection;
	connectionDrag: ConnectionDrag | null;
	actions: CircuitGraphActions;
}) {
	const isEditing = editing?.kind === "net" && editing.id === net.id;
	return (
		<g>
			<GraphButton
				{...netNodeBox(label)}
				key={net.id}
				className={`circuit-net ${selectedNetId === net.id ? "is-selected" : ""} ${connectionDrag?.active && connectionDrag.target?.kind === "net" && connectionDrag.target.id === net.id ? "is-target" : ""}`}
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
}
