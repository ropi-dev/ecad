import { X } from "lucide-react";
import { FloatingPanel } from "../viewer/FloatingPanel";
import { type EditorShape, shapeSizes } from "./shapes";

export function SelectionAttributes({
	shapes,
	onClear,
}: {
	shapes: EditorShape[];
	onClear: () => void;
}) {
	if (!shapes.length) return null;
	const single = shapes.length === 1 ? shapes[0] : undefined;
	const left = Math.min(
		...shapes.map((shape) => shape.x - shapeSizes[shape.kind].width / 2),
	);
	const right = Math.max(
		...shapes.map((shape) => shape.x + shapeSizes[shape.kind].width / 2),
	);
	const bottom = Math.min(
		...shapes.map((shape) => shape.y - shapeSizes[shape.kind].height / 2),
	);
	const top = Math.max(
		...shapes.map((shape) => shape.y + shapeSizes[shape.kind].height / 2),
	);
	const mm = (value: number) => `${value.toFixed(1)} mm`;
	const attributes = single
		? [
				["Type", single.kind],
				["ID", String(single.id)],
				["Center X", mm(single.x)],
				["Center Y", mm(single.y)],
				["Width", mm(shapeSizes[single.kind].width)],
				["Height", mm(shapeSizes[single.kind].height)],
				...(single.kind === "circle"
					? [["Radius", mm(shapeSizes.circle.width / 2)]]
					: []),
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
					Drag to move. Arrow keys move 1 mm; Shift + arrows move 10 mm when the
					drawing is focused.
				</p>
			</div>
		</FloatingPanel>
	);
}
