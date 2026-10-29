import type { ComponentProps, ReactNode } from "react";

export function GraphButton({
	x = 0,
	y = 0,
	width,
	height,
	transform,
	className,
	children,
	...props
}: Omit<ComponentProps<"button">, "children"> & {
	x?: number;
	y?: number;
	width: number;
	height: number;
	transform?: string;
	children: ReactNode;
}) {
	return (
		<foreignObject
			x={x}
			y={y}
			width={width}
			height={height}
			transform={transform}
			className={className}
		>
			<button type="button" className="circuit-node-button" {...props}>
				<svg
					width={width}
					height={height}
					viewBox={`${x} ${y} ${width} ${height}`}
					aria-hidden="true"
				>
					{children}
				</svg>
			</button>
		</foreignObject>
	);
}
