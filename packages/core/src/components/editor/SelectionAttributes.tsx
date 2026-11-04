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
import { isNetLabel } from "#/drawing/named-nets.ts";
import type { LabelRole } from "#/drawing/placement.ts";
import type { SelectionEdit } from "#/drawing/selection-edit.ts";
import {
	boxBorder,
	boxText,
	type EditorShape,
	type EditorSymbol,
	isBasicShape,
	type ShapeAttribute,
	type SymbolLabelPosition,
	shapeBounds,
	symbolLabelPosition,
	symbolShapes,
} from "#/drawing/shapes.ts";
import {
	horizontalAlignments,
	type TextAlignment,
	verticalAlignments,
} from "#/drawing/text-alignment.ts";
import {
	formatMils,
	fromMils,
	SCHEMATIC_STEP,
	toMils,
} from "#/drawing/units.ts";

function AttributeInput({
	label,
	value,
	unit = "mil",
	positive = false,
	nonNegative = false,
	step = "any",
	onChange,
}: {
	label: string;
	value: number | "";
	unit?: string;
	positive?: boolean;
	nonNegative?: boolean;
	step?: string;
	onChange: (value: number) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const converted = value === "" ? "" : unit === "mil" ? toMils(value) : value;
	const displayValue =
		converted === "" ? "" : Number(converted.toFixed(4)) || converted;
	useEffect(() => {
		const input = inputRef.current;
		// Hide pointer-conversion noise without rewriting a value being typed.
		if (input && input.valueAsNumber !== displayValue)
			input.value = String(displayValue);
	}, [displayValue]);
	return (
		<span className="flex items-center gap-2">
			<input
				ref={inputRef}
				type="number"
				aria-label={label}
				min={positive || nonNegative ? 0 : undefined}
				step={step}
				title={step === "90" ? "Angle in 90° increments" : undefined}
				placeholder="Mixed"
				defaultValue={displayValue}
				data-committed-value={value}
				className="w-24 rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-right text-[#f0f3f8] tabular-nums focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
				onBlur={(event) => {
					const entered = event.currentTarget.valueAsNumber;
					const next = unit === "mil" ? fromMils(entered) : entered;
					if (
						Number.isFinite(next) &&
						(!positive || next > 0) &&
						(!nonNegative || next >= 0) &&
						(step !== "90" || next % 90 === 0)
					) {
						if (next !== value && entered !== displayValue) onChange(next);
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
	/** Shows the net symbol and label role controls. Reusable symbols have no nets. */
	allowNetEdits?: boolean;
	onEdit: (edit: SelectionEdit) => void;
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
	allowNetEdits = false,
	onEdit,
	onCreateSymbol,
	onEditSymbol,
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
	const onAttributeChange = (attribute: ShapeAttribute, value: number) =>
		onEdit({ kind: "attribute", attribute, value });
	const single = shapes.length === 1 ? shapes[0] : undefined;
	const canCreateSymbol = shapes.every(
		(shape) =>
			shape.kind !== "symbol" && !(shape.kind === "text" && shape.electrical),
	);
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
			onChange={(event) =>
				onEdit({ kind: "lock", locked: event.currentTarget.checked })
			}
			className="size-4 cursor-pointer accent-[#e8b77e] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
		/>,
	];
	const bounds = shapes.map(shapeBounds);
	const left = Math.min(...bounds.map((box) => box.minX));
	const right = Math.max(...bounds.map((box) => box.maxX));
	const bottom = Math.min(...bounds.map((box) => box.minY));
	const top = Math.max(...bounds.map((box) => box.maxY));
	const distance = formatMils;
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
				unit={attribute === "angle" ? "°" : "mil"}
				step={attribute === "angle" ? "90" : "any"}
				onCommit={(next) =>
					onAttributeChange(
						attribute,
						attribute === "angle" ? next : fromMils(next),
					)
				}
			/>
		) : (
			<AttributeInput
				key={`${single?.id}:${attribute}`}
				label={label}
				value={value}
				nonNegative={attribute === "length"}
				positive={
					attribute !== "x" &&
					attribute !== "y" &&
					attribute !== "angle" &&
					attribute !== "length"
				}
				unit={attribute === "angle" ? "°" : "mil"}
				step={
					attribute === "angle" &&
					(single?.kind === "wire" ||
						single?.kind === "symbol" ||
						single?.kind === "pin")
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
				[
					"Type",
					single.kind === "text" && single.electrical
						? `${single.electrical} label`
						: single.kind === "symbol" && single.netSymbol
							? "net symbol"
							: single.kind,
				],
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
										onEdit({
											kind: "pin",
											attribute,
											value: event.currentTarget.value,
										})
									}
								/>,
							],
						)
					: []),
				...(single.kind === "pin"
					? (["showName", "showNumber"] as const).map(
							(attribute): [string, ReactNode] => {
								const label =
									attribute === "showName" ? "Show name" : "Show number";
								return [
									label,
									<input
										key={attribute}
										type="checkbox"
										aria-label={label}
										checked={single[attribute] ?? single.showLabels ?? true}
										onChange={(event) =>
											onEdit({
												kind: "pin",
												attribute,
												value: event.currentTarget.checked,
											})
										}
									/>,
								];
							},
						)
					: []),
				...(symbol
					? [
							...(allowNetEdits
								? [
										[
											"Net symbol",
											<input
												key="netSymbol"
												type="checkbox"
												aria-label="Net symbol"
												checked={symbol.netSymbol ?? false}
												onChange={(event) =>
													onEdit({
														kind: "net-symbol",
														netSymbol: event.currentTarget.checked,
													})
												}
											/>,
										] as [string, ReactNode],
									]
								: []),
							...(symbol.netSymbol
								? ["name"]
								: ["name", "reference", "value"]
							).map((attribute) => {
								const key = attribute as keyof EditorSymbol["attributes"];
								const label = attribute[0].toUpperCase() + attribute.slice(1);
								return [
									label,
									<SymbolInstanceAttributeInput
										key={key}
										name={`attributes.${key}`}
										label={label}
										value={symbol.attributes[key]}
										onCommit={(next) =>
											onEdit({
												kind: "symbol-attribute",
												attribute: key,
												value: next,
											})
										}
									/>,
								] as [string, ReactNode];
							}),
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
					? [
							editable("Lead length", "length", single.length ?? 0),
							editable("Angle", "angle", (single.rotation * 180) / Math.PI),
						]
					: symbol
						? [
								...(boxText(symbol)
									? [
											editable(
												"Font size",
												"fontSize",
												boxText(symbol)?.shape.fontSize ?? 0,
											),
										]
									: []),
								editable("Angle", "angle", (symbol.rotation * 180) / Math.PI),
							]
						: single.kind === "wire" || single.kind === "line"
							? [
									editable("Length", "width", single.width),
									editable("Angle", "angle", (single.rotation * 180) / Math.PI),
								]
							: isNetLabel(single) || single.kind === "text"
								? []
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
				lockAttribute,
				["Left X", distance(left)],
				["Bottom Y", distance(bottom)],
				["Width", distance(right - left)],
				["Height", distance(top - bottom)],
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
				<header className="flex items-center justify-end gap-3">
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
							? symbol.netSymbol
								? symbol.attributes.name
								: `${symbol.attributes.name} · ${symbol.attributes.reference}`
							: `${single.kind === "text" && single.electrical ? `${single.electrical} label` : single.kind} ${single.id}`
						: "Selected shapes"}
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
								Select shapes without existing symbols or electrical labels to
								create a symbol.
							</p>
						)}
						<p className="mt-3 text-[12px] leading-[1.7] text-[#9ba7b8]">
							Selection bounds
						</p>
					</>
				)}
				{single?.kind === "text" && allowNetEdits && !isSymbolChild && (
					<label className="mt-3 block text-xs text-[#9ba7b8]">
						Label role
						<select
							aria-label="Label role"
							className="mt-2 block w-full rounded bg-[#19212e] p-2 text-[#f0f3f8]"
							value={single.electrical ?? "text"}
							onChange={(event) =>
								onEdit({
									kind: "label-role",
									role:
										event.target.value === "text"
											? undefined
											: (event.target.value as LabelRole),
								})
							}
						>
							<option value="text">Ordinary text</option>
							<option value="net">Net label</option>
							<option value="supply">Supply label</option>
						</select>
					</label>
				)}
				{single?.kind === "text" && (
					<label className="mt-3 block text-[12px] text-[#9ba7b8]">
						{single.electrical ? "Net name" : "Text"}
						<textarea
							key={`${single.id}:${single.text}`}
							ref={(input) => {
								if (input && textFocusId === single.id) {
									input.focus({ preventScroll: true });
									input.select();
									onTextFocus();
								}
							}}
							aria-label={single.electrical ? "Net name" : "Text content"}
							defaultValue={single.text}
							rows={3}
							maxLength={2000}
							className="mt-2 block w-full resize-y rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
							onBlur={(event) =>
								onEdit({ kind: "text", text: event.currentTarget.value })
							}
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
				{symbol?.netSymbol && symbol.children.length > 0 && allowNetEdits && (
					<label className="mb-3 flex items-center justify-between gap-3 text-[12px] text-[#9ba7b8]">
						Label position
						<span className="relative mr-7 w-24 shrink-0">
							<select
								aria-label="Label position"
								value={symbolLabelPosition(symbol, "name")}
								className="w-full appearance-none rounded border border-[#ffffff20] bg-[#19212e] py-1 pr-3 pl-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
								onChange={(event) =>
									onEdit({
										kind: "symbol-label-position",
										position: event.currentTarget.value as SymbolLabelPosition,
									})
								}
							>
								<option value="default">Default</option>
								<option value="above">Above</option>
								<option value="below">Below</option>
								<option value="left">Left</option>
								<option value="right">Right</option>
								<option value="custom" disabled>
									Custom
								</option>
							</select>
							<ChevronDown
								aria-hidden="true"
								size={12}
								className="pointer-events-none absolute top-1/2 right-0.5 -translate-y-1/2 text-[#f0f3f8]"
							/>
						</span>
					</label>
				)}
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
						onChange={(alignment) =>
							onEdit({ kind: "text-alignment", alignment })
						}
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
									onEdit({
										kind: "line-style",
										lineStyle: event.currentTarget.value as LineStyle,
									})
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
								unit="mil"
								positive
								onCommit={(value) => {
									if (value !== null)
										onAttributeChange("lineWidth", fromMils(value));
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
								? "Drag the pin or lead to move it."
								: single && isNetLabel(single)
									? "Drag to move the label."
									: "Drag to move; drag handles to resize."}{" "}
					Arrow keys move {formatMils(snapStep || SCHEMATIC_STEP)}; Shift +
					arrows move {formatMils((snapStep || SCHEMATIC_STEP) * 10)} when the
					drawing is focused.
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
