import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { Quaternion, Vector3 } from "three";
import type { AxisIndicatorHandle } from "#/components/viewer/types/AxisIndicatorHandle.ts";

function projectAxes(rotation: Quaternion) {
	const inverse = rotation.clone().invert();
	return [
		{ label: "X", color: "text-red-400", direction: new Vector3(1, 0, 0) },
		{ label: "Y", color: "text-green-400", direction: new Vector3(0, 1, 0) },
		{ label: "Z", color: "text-blue-400", direction: new Vector3(0, 0, 1) },
	]
		.map((axis) => ({
			...axis,
			direction: axis.direction.applyQuaternion(inverse),
		}))
		.sort((a, b) => a.direction.z - b.direction.z);
}

export function AxisIndicator({ ref }: { ref?: Ref<AxisIndicatorHandle> }) {
	const rotation = useRef(new Quaternion());
	const [axes, setAxes] = useState(() => projectAxes(rotation.current));
	useImperativeHandle(
		ref,
		() => ({
			update: (next) => {
				if (rotation.current.equals(next)) return;
				rotation.current.copy(next);
				setAxes(projectAxes(next));
			},
		}),
		[],
	);
	return (
		<svg
			role="img"
			aria-label="XYZ axis orientation"
			viewBox="0 0 96 96"
			className="pointer-events-none absolute bottom-36 left-4 z-10 size-24 select-none sm:bottom-4"
		>
			<title>Model axes: X red, Y green, Z blue</title>
			<circle cx="48" cy="48" r="3" className="fill-slate-400" />
			{axes.map(({ label, color, direction }) => (
				<g key={label} className={color}>
					<line
						x1="48"
						y1="48"
						x2={48 - direction.x * 25}
						y2={48 + direction.y * 25}
						stroke="currentColor"
						strokeWidth="1.5"
						strokeDasharray="2 3"
						opacity="0.35"
					/>
					<line
						x1="48"
						y1="48"
						x2={48 + direction.x * 30}
						y2={48 - direction.y * 30}
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					/>
					<circle
						cx={48 + direction.x * 35}
						cy={48 - direction.y * 35}
						r="9"
						className="fill-slate-900"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<text
						x={48 + direction.x * 35}
						y={48 - direction.y * 35}
						textAnchor="middle"
						dominantBaseline="central"
						fill="currentColor"
						className="text-xs font-medium"
					>
						{label}
					</text>
				</g>
			))}
		</svg>
	);
}
