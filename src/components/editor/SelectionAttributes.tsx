import { X } from "lucide-react";
import { FloatingPanel } from "../viewer/FloatingPanel";
import { type EditorShape, shapeBounds } from "./shapes";

export function SelectionAttributes({
	shapes,
	snapStep = 0,
	onClear,
}: {
	shapes: EditorShape[];
	snapStep?: number;
	onClear: () => void;
}) {
	if (!shapes.length) return null;
	const single = shapes.length === 1 ? shapes[0] : undefined;
	const bounds = shapes.map(shapeBounds);
	const left = Math.min(...bounds.map((box) => box.minX));
	const right = Math.max(...bounds.map((box) => box.maxX));
	const bottom = Math.min(...bounds.map((box) => box.minY));
	const top = Math.max(...bounds.map((box) => box.maxY));
	const mm = (value: number) => `${value.toFixed(1)} mm`;
	const attributes = single
		? [
				["Type", single.kind],
				["ID", String(single.id)],
				["Center X", mm(single.x)],
				["Center Y", mm(single.y)],
				...(single.kind === "line"
					? [
							["Length", mm(single.width)],
							["Stroke width", mm(single.height)],
							["Angle", `${((single.rotation * 180) / Math.PI).toFixed(1)}°`],
						]
					: [
							["Width", mm(single.width)],
							["Height", mm(single.height)],
						]),
				...(single.kind === "circle" ? [["Radius", mm(single.width / 2)]] : []),
			]
		: [
				["Shapes", String(shapes.length)],
				["Left X", mm(left)],
				["Bottom Y", mm(bottom)],
				["Width", mm(right - left)],
				["Height", mm(top - bottom)],
			];
	return (
		<FloatingPanel label="Selection attributes">
			<div className="m-0 min-h-0 overflow-y-auto overscroll-contain p-2.5">
				<header className="flex items-center justify-between gap-3">
					<h2 className="m-0 text-[13px] font-semibold">Attributes</h2>
					<button
						type="button"
						className="relative z-1 grid h-[30px] w-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[#98a4b6] hover:bg-[#ffffff10] hover:text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b77e]"
						onClick={onClear}
						aria-label="Clear selection"
						title="Clear selection"
					>
						<X size={17} />
					</button>
				</header>
				<p className="mt-3 text-[14px] leading-[1.7] text-[#e8b77e]">
					{single
						? `${single.kind} ${single.id}`
						: `${shapes.length} shapes selected`}
				</p>
				{!single && (
					<p className="mt-3 text-[12px] leading-[1.7] text-[#9ba7b8]">
						Selection bounds
					</p>
				)}
				<dl className="my-4 text-[12px]">
					{attributes.map(([label, value]) => (
						<div
							key={label}
							className="flex justify-between gap-3 border-b border-[#ffffff0a] py-2"
						>
							<dt className="text-[#9ba7b8]">{label}</dt>
							<dd className="m-0 tabular-nums">{value}</dd>
						</div>
					))}
				</dl>
				<p className="mt-3 text-[12px] leading-[1.7] text-[#9ba7b8]">
					Drag to move; drag handles to resize. Arrow keys move {snapStep || 1}{" "}
					mm; Shift + arrows move {(snapStep || 1) * 10} mm when the drawing is
					focused.
				</p>
			</div>
		</FloatingPanel>
	);
}
