import { connectionCurveOffset } from "@ecad/drawing-core/circuit/graph.ts";
import type { MouseEvent } from "react";
import { GraphButton } from "./GraphButton.tsx";

export function CircuitConnection({
	pin,
	net,
	label,
	selected,
	highlighted,
	onSelect,
	onContextMenu,
}: {
	pin: { x: number; y: number; side: "left" | "right" };
	net: { x: number; y: number };
	label: string;
	selected: boolean;
	highlighted: boolean;
	onSelect(event: MouseEvent<HTMLButtonElement>): void;
	onContextMenu(event: MouseEvent<HTMLButtonElement>): void;
}) {
	const x = Math.min(pin.x, net.x) - 80;
	const y = Math.min(pin.y, net.y) - 16;
	const offset =
		pin.side === "left" ? -connectionCurveOffset : connectionCurveOffset;
	const path = `M ${pin.x} ${pin.y} C ${pin.x + offset} ${pin.y}, ${net.x - offset} ${net.y}, ${net.x} ${net.y}`;
	return (
		<GraphButton
			x={x}
			y={y}
			width={Math.abs(pin.x - net.x) + 160}
			height={Math.abs(pin.y - net.y) + 32}
			className="circuit-connection"
			style={{ pointerEvents: "none" }}
			aria-label={label}
			aria-pressed={selected}
			onClick={onSelect}
			onContextMenu={onContextMenu}
		>
			<path
				className={`circuit-edge ${selected ? "is-selected" : highlighted ? "is-highlighted" : ""}`}
				d={path}
			/>
			<path className="circuit-edge-hit" d={path} />
		</GraphButton>
	);
}
