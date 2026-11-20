import { connectionCurveOffset } from "@ecad/drawing-core/circuit/graph.ts";
import { createMemo } from "solid-js";
import type { CircuitGraphActions } from "#/components/circuit/circuitEditorState.ts";
import { GraphButton } from "#/components/circuit/GraphButton.tsx";
import { selectionMode } from "#/components/editor/selectionMode.ts";

export function CircuitConnection(props: {
	pinId: string;
	pinX: number;
	pinY: number;
	side: "left" | "right";
	netX: number;
	netY: number;
	label: string;
	selected: boolean;
	highlighted: boolean;
	actions: CircuitGraphActions;
}) {
	const path = createMemo(() => {
		const offset =
			props.side === "left" ? -connectionCurveOffset : connectionCurveOffset;
		return `M ${props.pinX} ${props.pinY} C ${props.pinX + offset} ${props.pinY}, ${props.netX - offset} ${props.netY}, ${props.netX} ${props.netY}`;
	});
	return (
		<GraphButton
			x={Math.min(props.pinX, props.netX) - 80}
			y={Math.min(props.pinY, props.netY) - 16}
			width={Math.abs(props.pinX - props.netX) + 160}
			height={Math.abs(props.pinY - props.netY) + 32}
			class="circuit-connection"
			style={{ "pointer-events": "none" }}
			aria-label={props.label}
			aria-pressed={props.selected ? "true" : "false"}
			onClick={(event) => {
				event.stopPropagation();
				props.actions.selectConnection(props.pinId, selectionMode(event));
			}}
			onContextMenu={(event) =>
				props.actions.openMenu(event, { kind: "connection", id: props.pinId })
			}
		>
			<path
				class={[
					"circuit-edge",
					{
						"is-selected": props.selected,
						"is-highlighted": !props.selected && props.highlighted,
					},
				]}
				d={path()}
			/>
			<path class="circuit-edge-hit" d={path()} />
		</GraphButton>
	);
}
