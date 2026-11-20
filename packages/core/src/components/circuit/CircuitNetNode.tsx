import { netNodeBox } from "@ecad/drawing-core/circuit/graph.ts";
import type { CircuitNet } from "@ecad/drawing-core/circuit/model.ts";
import { createMemo } from "solid-js";
import { CircuitInlineFields } from "#/components/circuit/CircuitInlineFields.tsx";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import type { CircuitGraphActions } from "#/components/circuit/circuitEditorState.ts";
import { GraphButton } from "#/components/circuit/GraphButton.tsx";
import { arrowDelta } from "#/lib/keyboard.ts";

/**
 * One net node on the circuit graph, with inline editing of the net name and
 * its aliases.
 */
export function CircuitNetNode(props: {
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
	const box = createMemo(() => netNodeBox(props.label));
	return (
		<g>
			<GraphButton
				x={box().x}
				y={box().y}
				width={box().width}
				height={box().height}
				class={[
					"circuit-net",
					{ "is-selected": props.selected, "is-target": props.isTarget },
				]}
				aria-label={`Net ${props.label}`}
				data-circuit-net-id={props.net.id}
				onDblClick={() => {
					if (props.tool === "select")
						props.actions.edit({ kind: "net", id: props.net.id });
				}}
				onContextMenu={(event) =>
					props.actions.openMenu(event, { kind: "net", id: props.net.id })
				}
				transform={`translate(${props.x},${props.y})`}
				onClick={() => props.actions.selectNet(props.net.id)}
				onPointerDown={(event) =>
					props.actions.startDrag(event, {
						id: props.net.id,
						kind: "net",
						x: props.x,
						y: props.y,
					})
				}
				onKeyDown={(event) => {
					if (event.key === "Enter" && props.tool === "select") {
						event.preventDefault();
						props.actions.edit({ kind: "net", id: props.net.id });
						return;
					}
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						props.actions.selectNet(props.net.id);
					}
					const delta = arrowDelta(event.key, props.gridStep);
					if (delta) {
						event.preventDefault();
						props.actions.run({
							type: "move",
							positions: [
								{
									id: props.net.id,
									kind: "net",
									...props.actions.snap({
										x: props.x + delta.x,
										y: props.y + delta.y,
									}),
								},
							],
						});
					}
				}}
			>
				<circle r="10" />
				<text
					y="-23"
					text-anchor="middle"
					visibility={props.isEditing ? "hidden" : undefined}
				>
					{props.label}
				</text>
			</GraphButton>
			{props.isEditing && (
				<CircuitInlineFields
					x={props.x - 110}
					y={props.y - 58}
					width={220}
					fields={(props.net.names.length
						? props.net.names
						: [props.net.pinIds.length ? props.label : ""]
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
					onCancel={props.actions.finishEditing}
					onCommit={(values) => {
						const names = values.map((name) => name.trim()).filter(Boolean);
						if (
							(!props.net.names.length &&
								values.length === 1 &&
								values[0].trim() === props.label) ||
							JSON.stringify(names) === JSON.stringify(props.net.names) ||
							props.actions.run({ type: "rename-net", id: props.net.id, names })
						) {
							props.actions.finishEditing();
							return true;
						}
						return false;
					}}
				/>
			)}
		</g>
	);
}
