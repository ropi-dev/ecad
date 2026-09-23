import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { FloatingPanel } from "../viewer/FloatingPanel";
import {
	type EditorShape,
	type EditorSymbol,
	type ShapeAttribute,
	shapeBounds,
} from "./shapes";

function AttributeInput({
	label,
	value,
	unit = "mm",
	positive = false,
	step = "any",
	onChange,
}: {
	label: string;
	value: number | "";
	unit?: string;
	positive?: boolean;
	step?: string;
	onChange: (value: number) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const displayValue = value === "" ? "" : Number(value.toFixed(4)) || value;
	useEffect(() => {
		const input = inputRef.current;
		// Hide pointer-conversion noise without rewriting a value being typed.
		if (input && input.valueAsNumber !== value)
			input.value = String(displayValue);
	}, [displayValue, value]);
	return (
		<span className="flex items-center gap-2">
			<input
				ref={inputRef}
				type="number"
				aria-label={label}
				min={positive ? 0 : undefined}
				step={step}
				title={step === "90" ? "Angle in 90° increments" : undefined}
				placeholder="Mixed"
				defaultValue={displayValue}
				className="w-24 rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-right text-[#f0f3f8] tabular-nums focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
				onChange={(event) => {
					const next = event.currentTarget.valueAsNumber;
					if (
						Number.isFinite(next) &&
						(!positive || next > 0) &&
						(step !== "90" || next % 90 === 0)
					)
						onChange(next);
				}}
				onBlur={(event) => {
					if (event.currentTarget.valueAsNumber !== value)
						event.currentTarget.value = String(displayValue);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape")
						event.currentTarget.blur();
				}}
			/>
			<span className="w-5 text-[#9ba7b8]">{unit}</span>
		</span>
	);
}

export function SelectionAttributes({
	shapes,
	snapStep = 0,
	onClear,
	onAttributeChange,
	onSymbolAttributeChange,
}: {
	shapes: EditorShape[];
	snapStep?: number;
	onClear: () => void;
	onAttributeChange: (attribute: ShapeAttribute, value: number) => void;
	onSymbolAttributeChange: (
		attribute: keyof EditorSymbol["attributes"],
		value: string,
	) => void;
}) {
	const lineWidth =
		shapes.length &&
		shapes.every((shape) => shape.lineWidth === shapes[0].lineWidth)
			? shapes[0].lineWidth
			: "";
	if (!shapes.length) return null;
	const single = shapes.length === 1 ? shapes[0] : undefined;
	const symbol = single?.kind === "symbol" ? single : undefined;
	const bounds = shapes.map(shapeBounds);
	const left = Math.min(...bounds.map((box) => box.minX));
	const right = Math.max(...bounds.map((box) => box.maxX));
	const bottom = Math.min(...bounds.map((box) => box.minY));
	const top = Math.max(...bounds.map((box) => box.maxY));
	const mm = (value: number) => `${value.toFixed(1)} mm`;
	const editable = (
		label: string,
		attribute: ShapeAttribute,
		value: number,
	): [string, ReactNode] => [
		label,
		<AttributeInput
			key={`${single?.id}:${attribute}`}
			label={label}
			value={value}
			positive={attribute !== "x" && attribute !== "y" && attribute !== "angle"}
			unit={attribute === "angle" ? "°" : "mm"}
			step={attribute === "angle" ? "90" : "any"}
			onChange={(next) => onAttributeChange(attribute, next)}
		/>,
	];
	const attributes: [string, ReactNode][] = single
		? [
				["Type", single.kind],
				["ID", String(single.id)],
				...(symbol
					? [
							...["name", "reference", "value"].map((attribute) => {
								const key = attribute as keyof EditorSymbol["attributes"];
								const label = attribute[0].toUpperCase() + attribute.slice(1);
								return [
									label,
									<input
										key={`${symbol.id}:${key}`}
										aria-label={label}
										value={symbol.attributes[key]}
										className="w-32 rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
										onChange={(event) =>
											onSymbolAttributeChange(key, event.currentTarget.value)
										}
									/>,
								] as [string, ReactNode];
							}),
							["Shapes", String(symbol.children.length)] as [string, ReactNode],
						]
					: []),
				editable("Center X", "x", single.x),
				editable("Center Y", "y", single.y),
				...(single.kind === "pin"
					? []
					: symbol
						? [editable("Angle", "angle", (symbol.rotation * 180) / Math.PI)]
						: single.kind === "wire"
							? [
									editable("Length", "width", single.width),
									editable("Angle", "angle", (single.rotation * 180) / Math.PI),
								]
							: [
									editable("Width", "width", single.width),
									editable("Height", "height", single.height),
								]),
				...(single.kind === "circle"
					? [editable("Radius", "radius", single.width / 2)]
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
		<FloatingPanel label="Selection attributes" position="top-right">
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
						? symbol
							? `${symbol.attributes.name} · ${symbol.attributes.reference}`
							: `${single.kind} ${single.id}`
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
							className="flex items-center justify-between gap-3 border-b border-[#ffffff0a] py-2"
						>
							<dt className="text-[#9ba7b8]">{label}</dt>
							<dd className="m-0 tabular-nums">{value}</dd>
						</div>
					))}
				</dl>
				<div className="flex items-center justify-between gap-3 text-[12px] text-[#9ba7b8]">
					<span>Line width</span>
					<AttributeInput
						key={shapes.map((shape) => shape.id).join(",")}
						label="Line width"
						value={lineWidth}
						positive
						onChange={(value) => onAttributeChange("lineWidth", value)}
					/>
				</div>
				<p className="mt-3 text-[12px] leading-[1.7] text-[#9ba7b8]">
					{symbol
						? "Select any part to move or delete the whole symbol."
						: single?.kind === "pin"
							? "Drag to move the connection point."
							: "Drag to move; drag handles to resize."}{" "}
					Arrow keys move {snapStep || 1} mm; Shift + arrows move{" "}
					{(snapStep || 1) * 10} mm when the drawing is focused.
				</p>
			</div>
		</FloatingPanel>
	);
}
