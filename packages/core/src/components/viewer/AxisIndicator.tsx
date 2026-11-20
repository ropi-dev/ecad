import { createSignal, For, onSettled } from "solid-js";
import { Quaternion, Vector3 } from "three";
import type { AxisIndicatorHandle } from "#/components/viewer/types/AxisIndicatorHandle.ts";

function projectAxes(rotation: Quaternion) {
	const inverse = rotation.clone().invert();
	return [
		{ label: "X", color: "text-axis-x", direction: new Vector3(1, 0, 0) },
		{ label: "Y", color: "text-axis-y", direction: new Vector3(0, 1, 0) },
		{ label: "Z", color: "text-axis-z", direction: new Vector3(0, 0, 1) },
	]
		.map((axis) => ({
			...axis,
			direction: axis.direction.applyQuaternion(inverse),
		}))
		.sort((a, b) => a.direction.z - b.direction.z);
}

export function AxisIndicator(props: {
	ref?: (handle: AxisIndicatorHandle) => void;
}) {
	const rotation = new Quaternion();
	const [axes, setAxes] = createSignal(projectAxes(rotation));
	onSettled(() => {
		props.ref?.({
			update: (next) => {
				if (rotation.equals(next)) return;
				rotation.copy(next);
				setAxes(projectAxes(next));
			},
		});
	});
	return (
		<svg
			role="img"
			aria-label="XYZ axis orientation"
			viewBox="0 0 96 96"
			class="pointer-events-none absolute bottom-[calc(var(--chrome-dock)+24px)] left-[var(--chrome-gap)] z-10 size-24 select-none sm:bottom-[var(--chrome-gap)]"
		>
			<title>Model axes: X red, Y green, Z blue</title>
			<circle cx="48" cy="48" r="3" class="fill-fg-faint" />
			<For each={axes()} keyed={(axis) => axis.label}>
				{(axis) => (
					<g class={axis().color}>
						<line
							x1="48"
							y1="48"
							x2={48 - axis().direction.x * 25}
							y2={48 + axis().direction.y * 25}
							stroke="currentColor"
							stroke-width="1.5"
							stroke-dasharray="2 3"
							opacity="0.35"
						/>
						<line
							x1="48"
							y1="48"
							x2={48 + axis().direction.x * 30}
							y2={48 - axis().direction.y * 30}
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
						<circle
							cx={48 + axis().direction.x * 35}
							cy={48 - axis().direction.y * 35}
							r="9"
							class="fill-panel"
							stroke="currentColor"
							stroke-width="1.5"
						/>
						<text
							x={48 + axis().direction.x * 35}
							y={48 - axis().direction.y * 35}
							text-anchor="middle"
							dominant-baseline="central"
							fill="currentColor"
							class="text-xs font-medium"
						>
							{axis().label}
						</text>
					</g>
				)}
			</For>
		</svg>
	);
}
