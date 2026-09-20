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
			<div className="layer-list editor-attributes">
				<header>
					<h2>Attributes</h2>
					<button
						type="button"
						className="layer-icon"
						onClick={onClear}
						aria-label="Clear selection"
						title="Clear selection"
					>
						<X size={17} />
					</button>
				</header>
				<p className="editor-selection-name">
					{single
						? `${single.kind} ${single.id}`
						: `${shapes.length} shapes selected`}
				</p>
				{!single && <p>Selection bounds</p>}
				<dl>
					{attributes.map(([label, value]) => (
						<div key={label}>
							<dt>{label}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
				<p>
					Drag to move; drag handles to resize. Arrow keys move {snapStep || 1}{" "}
					mm; Shift + arrows move {(snapStep || 1) * 10} mm when the drawing is
					focused.
				</p>
			</div>
		</FloatingPanel>
	);
}
