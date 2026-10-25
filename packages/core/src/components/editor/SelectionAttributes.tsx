import { ChevronDown, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { SymbolInstanceAttributeForm } from "#/components/editor/SymbolInstanceAttributeForm.tsx";
import { SymbolInstanceAttributeInput } from "#/components/editor/SymbolInstanceAttributeInput.tsx";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import {
	type LineStyle,
	lineStyleLabels,
	lineStyles,
} from "#/drawing/line-style.ts";
import {
	boxBorder,
	type EditorShape,
	type EditorSymbol,
	isBasicShape,
	type ShapeAttribute,
	shapeBounds,
	symbolShapes,
} from "#/drawing/shapes.ts";
import {
	horizontalAlignments,
	type TextAlignment,
	verticalAlignments,
} from "#/drawing/text-alignment.ts";

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
				data-committed-value={value}
				className="w-24 rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-right text-[#f0f3f8] tabular-nums focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
				onBlur={(event) => {
					const next = event.currentTarget.valueAsNumber;
					if (
						Number.isFinite(next) &&
						(!positive || next > 0) &&
						(step !== "90" || next % 90 === 0)
					) {
						if (next !== value && next !== displayValue) onChange(next);
					} else event.currentTarget.value = String(displayValue);
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

interface SelectionAttributesProps {
	isSymbolChild?: boolean;
	shapes: EditorShape[];
	snapStep?: number;
	onClear: () => void;
	onCreateSymbol?: () => void;
	onEditSymbol?: () => void;
	onAttributeChange: (attribute: ShapeAttribute, value: number) => void;
	onLineStyleChange: (style: LineStyle) => void;
	onLockChange: (locked: boolean) => void;
	onSymbolAttributeChange: (
		attribute: keyof EditorSymbol["attributes"],
		value: string,
	) => void;
	onTextChange: (text: string) => void;
	onTextAlignmentChange: (alignment: TextAlignment) => void;
	onPinAttributeChange: (attribute: "name" | "number", value: string) => void;
	textFocusId: number | null;
	onTextFocus: () => void;
}

export function SelectionAttributes(props: SelectionAttributesProps) {
	const symbol = props.shapes.length === 1 ? props.shapes[0] : undefined;
	if (symbol?.kind === "symbol")
		return (
			<SymbolInstanceAttributeForm key={symbol.id} symbol={symbol}>
				<SelectionAttributesPanel {...props} />
			</SymbolInstanceAttributeForm>
		);
	return <SelectionAttributesPanel {...props} />;
}

function SelectionAttributesPanel({
	isSymbolChild = false,
	shapes,
	snapStep = 0,
	onClear,
	onAttributeChange,
	onLineStyleChange,
	onLockChange,
	onSymbolAttributeChange,
	onPinAttributeChange,
	onCreateSymbol,
	onEditSymbol,
	onTextChange,
	onTextAlignmentChange,
	textFocusId,
	onTextFocus,
}: SelectionAttributesProps) {
	const basicShapes = shapes.flatMap((shape) => {
		const border =
			shape.kind === "symbol" ? boxBorder(shape)?.shape : undefined;
		return isBasicShape(shape)
			? [shape]
			: border && isBasicShape(border)
				? [border]
				: [];
	});
	const textShapes = shapes.filter((shape) => shape.kind === "text");
	const lineStyle =
		basicShapes.length &&
		basicShapes.every(
			(shape) =>
				(shape.lineStyle ?? "solid") === (basicShapes[0].lineStyle ?? "solid"),
		)
			? (basicShapes[0].lineStyle ?? "solid")
			: "";
	const outlinedShapes = shapes.flatMap((shape) =>
		shape.kind === "symbol"
			? symbolShapes(shape).filter((child) => child.kind !== "text")
			: shape.kind === "text"
				? []
				: [shape],
	);
	const lineWidth =
		outlinedShapes.length &&
		outlinedShapes.every(
			(shape) => shape.lineWidth === outlinedShapes[0].lineWidth,
		)
			? outlinedShapes[0].lineWidth
			: "";
	if (!shapes.length) return null;
	const single = shapes.length === 1 ? shapes[0] : undefined;
	const canCreateSymbol = shapes.every((shape) => shape.kind !== "symbol");
	const symbol = single?.kind === "symbol" ? single : undefined;
	const locked = shapes.every((shape) => shape.locked === true);
	const lockAttribute: [string, ReactNode] = [
		"Locked",
		<input
			key="locked"
			type="checkbox"
			aria-label="Locked"
			checked={locked}
			ref={(input) => {
				if (input)
					input.indeterminate = !locked && shapes.some((shape) => shape.locked);
			}}
			onChange={(event) => onLockChange(event.currentTarget.checked)}
			className="size-4 cursor-pointer accent-[#e8b77e] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
		/>,
	];
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
		symbol &&
		(attribute === "x" || attribute === "y" || attribute === "angle") ? (
			<SymbolInstanceAttributeInput
				key={attribute}
				name={attribute}
				label={label}
				value={value}
				unit={attribute === "angle" ? "°" : "mm"}
				step={attribute === "angle" ? "90" : "any"}
				onCommit={(next) => onAttributeChange(attribute, next)}
			/>
		) : (
			<AttributeInput
				key={`${single?.id}:${attribute}`}
				label={label}
				value={value}
				positive={
					attribute !== "x" && attribute !== "y" && attribute !== "angle"
				}
				unit={attribute === "angle" ? "°" : "mm"}
				step={
					attribute === "angle" &&
					(single?.kind === "wire" || single?.kind === "symbol")
						? "90"
						: single?.kind === "text" &&
								(attribute === "x" || attribute === "y")
							? "0.1"
							: "any"
				}
				onChange={(next) => onAttributeChange(attribute, next)}
			/>
		),
	];
	const attributes: [string, ReactNode][] = single
		? [
				["Type", single.kind],
				["ID", String(single.id)],
				lockAttribute,
				...(single.kind === "pin"
					? (["name", "number"] as const).map(
							(attribute): [string, ReactNode] => [
								attribute === "name" ? "Name" : "Number",
								<input
									key={`${single.id}:${attribute}:${single[attribute]}`}
									aria-label={attribute === "name" ? "Name" : "Number"}
									defaultValue={single[attribute]}
									className="w-32 rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
									onBlur={(event) =>
										onPinAttributeChange(attribute, event.currentTarget.value)
									}
								/>,
							],
						)
					: []),
				...(symbol
					? [
							...["name", "reference", "value"].map((attribute) => {
								const key = attribute as keyof EditorSymbol["attributes"];
								const label = attribute[0].toUpperCase() + attribute.slice(1);
								return [
									label,
									<SymbolInstanceAttributeInput
										key={key}
										name={`attributes.${key}`}
										label={label}
										value={symbol.attributes[key]}
										onCommit={(next) => onSymbolAttributeChange(key, next)}
									/>,
								] as [string, ReactNode];
							}),
							["Shapes", String(symbol.children.length)] as [string, ReactNode],
						]
					: []),
				editable(
					single.kind === "text" ? "Anchor X" : "Center X",
					"x",
					single.x,
				),
				editable(
					single.kind === "text" ? "Anchor Y" : "Center Y",
					"y",
					single.y,
				),
				...(single.kind === "pin"
					? []
					: symbol
						? [
								...(boxBorder(symbol)
									? [
											editable("Width", "width", symbol.width),
											editable("Height", "height", symbol.height),
										]
									: []),
								editable("Angle", "angle", (symbol.rotation * 180) / Math.PI),
							]
						: single.kind === "wire" || single.kind === "line"
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
				...(single.kind === "text"
					? [
							editable("Font size", "fontSize", single.fontSize),
							editable("Angle", "angle", (single.rotation * 180) / Math.PI),
						]
					: []),
			]
		: [
				["Shapes", String(shapes.length)],
				lockAttribute,
				["Left X", mm(left)],
				["Bottom Y", mm(bottom)],
				["Width", mm(right - left)],
				["Height", mm(top - bottom)],
			];
	return (
		<FloatingPanel label="Selection attributes" position="top-right">
			<div
				className="m-0 min-h-0 overflow-y-auto overscroll-contain p-2.5"
				onKeyDownCapture={(event) => {
					const target = event.target;
					if (
						(target instanceof HTMLInputElement && event.key === "Enter") ||
						((target instanceof HTMLInputElement ||
							target instanceof HTMLTextAreaElement) &&
							event.key === "Escape")
					) {
						event.preventDefault();
						target.blur();
					}
				}}
			>
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
				{symbol && (
					<button
						type="button"
						onClick={onEditSymbol}
						disabled={!onEditSymbol}
						title={
							onEditSymbol
								? "Open the library definition"
								: "This symbol's definition is read-only or unavailable."
						}
						className="mt-3 w-full cursor-pointer rounded border border-[#e8b77e60] bg-[#e8b77e15] px-3 py-2 text-[12px] text-[#e8b77e] hover:bg-[#e8b77e25] focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-default disabled:opacity-50"
					>
						Edit symbol
					</button>
				)}
				{!single && onCreateSymbol && (
					<>
						<button
							type="button"
							onClick={onCreateSymbol}
							disabled={!canCreateSymbol}
							className="mt-3 w-full cursor-pointer rounded border border-[#e8b77e60] bg-[#e8b77e15] px-3 py-2 text-[12px] text-[#e8b77e] hover:bg-[#e8b77e25] focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-default disabled:opacity-50"
						>
							Create symbol
						</button>
						{!canCreateSymbol && (
							<p className="mt-2 text-[12px] text-[#9ba7b8]">
								Select shapes without existing symbols to create a symbol.
							</p>
						)}
						<p className="mt-3 text-[12px] leading-[1.7] text-[#9ba7b8]">
							Selection bounds
						</p>
					</>
				)}
				{single?.kind === "text" && (
					<label className="mt-3 block text-[12px] text-[#9ba7b8]">
						Text
						<textarea
							key={`${single.id}:${single.text}`}
							ref={(input) => {
								if (input && textFocusId === single.id) {
									input.focus({ preventScroll: true });
									input.select();
									onTextFocus();
								}
							}}
							aria-label="Text content"
							defaultValue={single.text}
							rows={3}
							maxLength={2000}
							className="mt-2 block w-full resize-y rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
							onBlur={(event) => onTextChange(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") event.currentTarget.blur();
							}}
						/>
					</label>
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
				{textShapes.length > 0 && (
					<TextAlignmentInputs
						horizontalAlign={
							textShapes.every(
								(shape) =>
									(shape.horizontalAlign ?? "center") ===
									(textShapes[0].horizontalAlign ?? "center"),
							)
								? (textShapes[0].horizontalAlign ?? "center")
								: ""
						}
						verticalAlign={
							textShapes.every(
								(shape) =>
									(shape.verticalAlign ?? "middle") ===
									(textShapes[0].verticalAlign ?? "middle"),
							)
								? (textShapes[0].verticalAlign ?? "middle")
								: ""
						}
						onChange={onTextAlignmentChange}
					/>
				)}
				{basicShapes.length > 0 && (
					<label className="mb-3 flex items-center justify-between gap-3 text-[12px] text-[#9ba7b8]">
						Line style
						<span className="relative mr-7 w-24 shrink-0">
							<select
								aria-label="Line style"
								value={lineStyle}
								className="w-full appearance-none rounded border border-[#ffffff20] bg-[#19212e] py-1 pr-3 pl-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
								onChange={(event) =>
									onLineStyleChange(event.currentTarget.value as LineStyle)
								}
							>
								{lineStyle === "" && (
									<option value="" disabled>
										Mixed
									</option>
								)}
								{lineStyles.map((style) => (
									<option key={style} value={style}>
										{lineStyleLabels[style]}
									</option>
								))}
							</select>
							<ChevronDown
								aria-hidden="true"
								size={12}
								className="pointer-events-none absolute top-1/2 right-0.5 -translate-y-1/2 text-[#f0f3f8]"
							/>
						</span>
					</label>
				)}
				{outlinedShapes.length > 0 && (
					<div className="flex items-center justify-between gap-3 text-[12px] text-[#9ba7b8]">
						<span>Line width</span>
						{symbol ? (
							<SymbolInstanceAttributeInput
								name="lineWidth"
								label="Line width"
								value={lineWidth}
								unit="mm"
								positive
								onCommit={(value) => {
									if (value !== null) onAttributeChange("lineWidth", value);
								}}
							/>
						) : (
							<AttributeInput
								key={shapes.map((shape) => shape.id).join(",")}
								label="Line width"
								value={lineWidth}
								positive
								onChange={(value) => onAttributeChange("lineWidth", value)}
							/>
						)}
					</div>
				)}
				<p className="mt-3 text-[12px] leading-[1.7] text-[#9ba7b8]">
					{symbol
						? "Position edits move the whole symbol. Child positions are relative to the symbol center."
						: isSymbolChild
							? "Drag to move this item. Size and appearance edits apply to this instance."
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

function TextAlignmentInputs({
	label = "Text",
	horizontalAlign,
	verticalAlign,
	onChange,
}: {
	label?: string;
	horizontalAlign: NonNullable<TextAlignment["horizontalAlign"]> | "";
	verticalAlign: NonNullable<TextAlignment["verticalAlign"]> | "";
	onChange: (alignment: TextAlignment) => void;
}) {
	return (
		<div className="mb-3 space-y-2 text-[12px] text-[#9ba7b8]">
			{(["horizontalAlign", "verticalAlign"] as const).map((axis) => {
				const horizontal = axis === "horizontalAlign";
				const title = `${label} ${horizontal ? "horizontal" : "vertical"} alignment`;
				const value = horizontal ? horizontalAlign : verticalAlign;
				return (
					<label key={axis} className="flex items-center justify-between gap-3">
						<span>{horizontal ? "Horizontal align" : "Vertical align"}</span>
						<select
							aria-label={title}
							value={value}
							className="mr-7 w-24 rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
							onChange={(event) =>
								onChange({ [axis]: event.currentTarget.value })
							}
						>
							{value === "" && (
								<option value="" disabled>
									Mixed
								</option>
							)}
							{(horizontal ? horizontalAlignments : verticalAlignments).map(
								(value) => (
									<option key={value} value={value}>
										{value[0].toUpperCase() + value.slice(1)}
									</option>
								),
							)}
						</select>
					</label>
				);
			})}
		</div>
	);
}
