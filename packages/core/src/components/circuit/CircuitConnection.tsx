import { connectionCurveOffset } from "@ecad/drawing-core/circuit/graph.ts";
import { memo } from "react";
import type { CircuitGraphActions } from "#/components/circuit/circuitEditorState.ts";
import { GraphButton } from "#/components/circuit/GraphButton.tsx";
import { selectionMode } from "#/components/editor/selectionMode.ts";

const connectionStyle = { pointerEvents: "none" } as const;

export const CircuitConnection = memo(function CircuitConnection({
	pinId,
	pinX,
	pinY,
	side,
	netX,
	netY,
	label,
	selected,
	highlighted,
	actions,
}: {
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
	const x = Math.min(pinX, netX) - 80;
	const y = Math.min(pinY, netY) - 16;
	const offset =
		side === "left" ? -connectionCurveOffset : connectionCurveOffset;
	const path = `M ${pinX} ${pinY} C ${pinX + offset} ${pinY}, ${netX - offset} ${netY}, ${netX} ${netY}`;
	return (
		<GraphButton
			x={x}
			y={y}
			width={Math.abs(pinX - netX) + 160}
			height={Math.abs(pinY - netY) + 32}
			className="circuit-connection"
			style={connectionStyle}
			aria-label={label}
			aria-pressed={selected}
			onClick={(event) => {
				event.stopPropagation();
				actions.selectConnection(pinId, selectionMode(event));
			}}
			onContextMenu={(event) =>
				actions.openMenu(event, { kind: "connection", id: pinId })
			}
		>
			<path
				className={`circuit-edge ${selected ? "is-selected" : highlighted ? "is-highlighted" : ""}`}
				d={path}
			/>
			<path className="circuit-edge-hit" d={path} />
		</GraphButton>
	);
});
