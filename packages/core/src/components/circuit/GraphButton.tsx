import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

export function GraphButton(
	props: Omit<
		JSX.ButtonHTMLAttributes<HTMLButtonElement>,
		"children" | "class"
	> & {
		x?: number;
		y?: number;
		width: number;
		height: number;
		transform?: string;
		class?: JSX.ClassValue;
		children: JSX.Element;
	},
) {
	const button = omit(
		props,
		"x",
		"y",
		"width",
		"height",
		"transform",
		"class",
		"children",
	);
	return (
		<foreignObject
			x={props.x ?? 0}
			y={props.y ?? 0}
			width={props.width}
			height={props.height}
			transform={props.transform}
			class={props.class}
		>
			<button type="button" class="circuit-node-button" {...button}>
				<svg
					width={props.width}
					height={props.height}
					viewBox={`${props.x ?? 0} ${props.y ?? 0} ${props.width} ${props.height}`}
					aria-hidden="true"
				>
					{props.children}
				</svg>
			</button>
		</foreignObject>
	);
}
