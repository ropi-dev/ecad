import {
	type LineStyle,
	lineStyleLabels,
	lineStyles,
} from "@ecad/drawing-core/drawing/line-style.ts";
import { isNetLabel } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	type PinElectricalType,
	pinElectricalType,
	pinElectricalTypeLabels,
	pinElectricalTypes,
} from "@ecad/drawing-core/drawing/pin-types.ts";
import {
	boxBorder,
	boxText,
	type EditorShape,
	type EditorSymbol,
	isBasicShape,
	isFillableShape,
	type PinShape,
	type ShapeAttribute,
	type SymbolLabelPosition,
	shapeBounds,
	symbolLabelPosition,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	horizontalAlignments,
	type TextAlignment,
	verticalAlignments,
} from "@ecad/drawing-core/drawing/text-alignment.ts";
import {
	formatMils,
	fromMils,
	type LengthUnit,
	SCHEMATIC_STEP,
	toMils,
} from "@ecad/drawing-core/drawing/units.ts";
import {
	copperLayers,
	type FootprintLayer,
	footprintLayerLabels,
	footprintLayers,
	type PadType,
	padTypeLabels,
	padTypes,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	isPad,
	type PadShape,
	padMinorSize,
	shapeLayer,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { Lock, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { SymbolInstanceAttributeForm } from "#/components/editor/SymbolInstanceAttributeForm.tsx";
import { SymbolInstanceAttributeInput } from "#/components/editor/SymbolInstanceAttributeInput.tsx";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type { LabelRole } from "#/drawing/placement.ts";
import type { SelectionEdit } from "#/drawing/selection-edit.ts";

export const numberInputClassName = "ui-input w-28 pr-8 text-right";
export const textInputClassName = "ui-input w-36";

/** A number input with its unit shown inside the field's right edge. */
export function UnitField({
	unit,
	children,
}: {
	unit?: string;
	children: ReactNode;
}) {
	return (
		<span className="relative inline-flex">
			{children}
			{unit && (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-2xs text-fg-faint"
				>
					{unit}
				</span>
			)}
		</span>
	);
}

const kindLabels: Record<string, string> = {
	rectangle: "Rectangle",
	circle: "Circle",
	triangle: "Triangle",
	"no-connect": "No connect",
	line: "Line",
	wire: "Wire",
	pin: "Pin",
	text: "Text",
	"net label": "Net label",
	"supply label": "Supply label",
};

function PanelHeader({
	title,
	subtitle,
	onClear,
}: {
	title: ReactNode;
	subtitle: ReactNode;
	onClear: () => void;
}) {
	return (
		<header className="flex shrink-0 items-start gap-2 border-b border-line-subtle py-2.5 pr-2 pl-3">
			<div className="min-w-0 flex-1">
				{title}
				<div className="mt-0.5 flex gap-1 text-2xs text-fg-faint">
					{subtitle}
				</div>
			</div>
			<button
				type="button"
				className={panelIconButtonClassName}
				onClick={onClear}
				aria-label="Clear selection"
				title="Clear selection"
			>
				<X size={16} aria-hidden="true" />
			</button>
		</header>
	);
}

const titleClassName =
	"m-0 flex items-center gap-1.5 text-sm font-semibold break-words text-fg";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="border-t border-line-subtle px-3 pt-2.5 pb-2 first:border-t-0">
			<h3 className="ui-section-label m-0 mb-1">{title}</h3>
			{children}
		</section>
	);
}

const rowClassName =
	"flex min-h-8 items-center justify-between gap-3 text-xs text-fg-muted";

function Rows({ rows }: { rows: [string, ReactNode][] }) {
	return (
		<dl className="m-0">
			{rows.map(([label, value]) => (
				<div key={label} className={rowClassName}>
					<dt>{label}</dt>
					<dd className="m-0 text-fg tabular-nums">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function Tips({ children }: { children: ReactNode }) {
	return (
		<details className="group border-t border-line-subtle px-3 py-2 text-xs text-fg-muted">
			<summary className="-mx-1 cursor-pointer rounded-sm px-1 py-0.5 font-medium select-none hover:text-fg">
				Keyboard tips
			</summary>
			<p className="m-0 mt-1.5 leading-[1.125rem]">{children}</p>
		</details>
	);
}

const actionClassName = "ui-button w-full";
const noDefinition = "This symbol's definition is read-only or unavailable.";

function AttributeInput({
	label,
	value,
	unit = "mil",
	positive = false,
	nonNegative = false,
	below = Number.POSITIVE_INFINITY,
	step = "any",
	onChange,
}: {
	label: string;
	value: number | "";
	unit?: string;
	positive?: boolean;
	nonNegative?: boolean;
	below?: number;
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
		<UnitField unit={unit}>
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
				className={numberInputClassName}
				onBlur={(event) => {
					const entered = event.currentTarget.valueAsNumber;
					const next = unit === "mil" ? fromMils(entered) : entered;
					if (
						Number.isFinite(next) &&
						(!positive || next > 0) &&
						(!nonNegative || next >= 0) &&
						next < below &&
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
		</UnitField>
	);
}

interface SelectionAttributesProps {
	isSymbolChild?: boolean;
	symbolTextMoved?: boolean;
	/** Shows the attributes without inputs, for a pin fixed to its symbol. */
	readOnly?: boolean;
	shapes: EditorShape[];
	snapStep?: number;
	onClear: () => void;
	onCreateSymbol?: () => void;
	onEditSymbol?: () => void;
	/** Shows the net symbol and label role controls. Reusable symbols have no nets. */
	allowNetEdits?: boolean;
	footprint?: boolean;
	unit?: LengthUnit;
	onEdit: (edit: SelectionEdit) => void;
	textFocusId: number | null;
	onTextFocus: () => void;
}

function PinTypeSelect({
	pin,
	onEdit,
}: {
	pin: { readonly electricalType?: PinElectricalType };
	onEdit: (edit: SelectionEdit) => void;
}) {
	return (
		<select
			aria-label="Electrical type"
			className="ui-select w-36"
			value={pinElectricalType(pin)}
			onChange={(event) =>
				onEdit({
					kind: "pin",
					attribute: "electricalType",
					value: event.currentTarget.value as PinElectricalType,
				})
			}
		>
			{pinElectricalTypes.map((type) => (
				<option key={type} value={type}>
					{pinElectricalTypeLabels[type]}
				</option>
			))}
		</select>
	);
}

/** Show name and Show number checkboxes for one pin. */
function pinLabelRows(
	pin: Pick<PinShape, "showLabels" | "showName" | "showNumber">,
	onEdit: (edit: SelectionEdit) => void,
): [string, ReactNode][] {
	return (["showName", "showNumber"] as const).map((attribute) => {
		const label = attribute === "showName" ? "Show name" : "Show number";
		return [
			label,
			<input
				key={attribute}
				type="checkbox"
				aria-label={label}
				className="ui-checkbox"
				checked={pin[attribute] ?? pin.showLabels ?? true}
				onChange={(event) =>
					onEdit({
						kind: "pin",
						attribute,
						value: event.currentTarget.checked,
					})
				}
			/>,
		];
	});
}

function selectionType(shape: EditorShape, footprint: boolean): string {
	if (isPad(shape)) return "pad";
	if (shape.kind === "text" && shape.electrical)
		return `${shape.electrical} label`;
	if (shape.kind === "symbol" && shape.netSymbol) return "net symbol";
	return footprint && shape.kind === "line" ? "wire" : shape.kind;
}

function padRows(
	pad: PadShape,
	unit: LengthUnit,
	onEdit: (edit: SelectionEdit) => void,
): [string, ReactNode][] {
	return [
		[
			"Pad number",
			<input
				key={`${pad.id}:number:${pad.pad.number}`}
				aria-label="Pad number"
				defaultValue={pad.pad.number}
				maxLength={16}
				className={textInputClassName}
				onBlur={(event) =>
					onEdit({
						kind: "pad",
						edit: { attribute: "number", value: event.currentTarget.value },
					})
				}
			/>,
		],
		[
			"Pad type",
			<select
				key="type"
				aria-label="Pad type"
				className="ui-select w-36"
				value={pad.pad.type}
				onChange={(event) =>
					onEdit({
						kind: "pad",
						edit: {
							attribute: "type",
							value: event.currentTarget.value as PadType,
						},
					})
				}
			>
				{padTypes.map((type) => (
					<option key={type} value={type}>
						{padTypeLabels[type]}
					</option>
				))}
			</select>,
		],
		[
			"Pad shape",
			<select
				key="shape"
				aria-label="Pad shape"
				className="ui-select w-36"
				value={pad.kind}
				onChange={(event) =>
					onEdit({
						kind: "pad",
						edit: {
							attribute: "shape",
							value: event.currentTarget.value as PadShape["kind"],
						},
					})
				}
			>
				<option value="rectangle">Rectangle</option>
				<option value="circle">Circle</option>
			</select>,
		],
		...(pad.pad.drill === undefined
			? []
			: [
					[
						"Drill",
						<AttributeInput
							key={`${pad.id}:drill`}
							label="Drill"
							value={pad.pad.drill}
							unit={unit}
							positive
							below={padMinorSize(pad)}
							onChange={(value) =>
								onEdit({ kind: "pad", edit: { attribute: "drill", value } })
							}
						/>,
					] as [string, ReactNode],
				]),
	];
}

export function SelectionAttributes(props: SelectionAttributesProps) {
	const symbol = props.shapes.length === 1 ? props.shapes[0] : undefined;
	if (props.readOnly && symbol)
		return (
			<FixedChildAttributes
				shape={symbol}
				onClear={props.onClear}
				onEditSymbol={props.onEditSymbol}
				onEdit={props.onEdit}
			/>
		);
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
	symbolTextMoved,
	shapes,
	snapStep = 0,
	onClear,
	allowNetEdits = false,
	footprint = false,
	unit = "mil",
	onEdit,
	onCreateSymbol,
	onEditSymbol,
	textFocusId,
	onTextFocus,
}: SelectionAttributesProps) {
	const basicShapes = shapes.flatMap((shape) => {
		const border =
			shape.kind === "symbol" ? boxBorder(shape)?.shape : undefined;
		if (isPad(shape)) return [];
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
			: shape.kind === "text" || isPad(shape)
				? []
				: [shape],
	);
	const fillable = footprint
		? shapes.filter(isFillableShape).filter((shape) => !isPad(shape))
		: [];
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
			className="ui-checkbox"
		/>,
	];
	const bounds = shapes.map(shapeBounds);
	const left = Math.min(...bounds.map((box) => box.minX));
	const right = Math.max(...bounds.map((box) => box.maxX));
	const bottom = Math.min(...bounds.map((box) => box.minY));
	const top = Math.max(...bounds.map((box) => box.maxY));
	const distance =
		unit === "mil"
			? formatMils
			: (value: number) => `${Number(value.toFixed(4))} mm`;
	const pad = single && isPad(single) ? single : undefined;
	const layer =
		footprint && shapes.every((shape) => shape.kind !== "symbol")
			? shapes.every((shape) => shapeLayer(shape) === shapeLayer(shapes[0]))
				? shapeLayer(shapes[0])
				: ""
			: undefined;
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
				unit={attribute === "angle" ? "°" : unit}
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
	const type = single ? selectionType(single, footprint) : "";
	const properties: [string, ReactNode][] = [
		lockAttribute,
		...(layer === undefined
			? []
			: pad?.pad.type === "through-hole"
				? [["Layer", "Both copper layers"] as [string, ReactNode]]
				: [
						[
							"Layer",
							<select
								key="layer"
								aria-label="Layer"
								className="ui-select w-36"
								value={layer}
								onChange={(event) =>
									onEdit({
										kind: "layer",
										layer: event.currentTarget.value as FootprintLayer,
									})
								}
							>
								{layer === "" && (
									<option value="" disabled>
										Mixed
									</option>
								)}
								{footprintLayers
									.filter((item) => !pad || copperLayers.includes(item))
									.map((item) => (
										<option key={item} value={item}>
											{footprintLayerLabels[item]}
										</option>
									))}
							</select>,
						] as [string, ReactNode],
					]),
		...(pad ? padRows(pad, unit, onEdit) : []),
		...(single?.kind === "pin"
			? (["name", "number"] as const).map((attribute): [string, ReactNode] => [
					attribute === "name" ? "Name" : "Number",
					<input
						key={`${single.id}:${attribute}:${single[attribute]}`}
						aria-label={attribute === "name" ? "Name" : "Number"}
						defaultValue={single[attribute]}
						className={textInputClassName}
						onBlur={(event) =>
							onEdit({
								kind: "pin",
								attribute,
								value: event.currentTarget.value,
							})
						}
					/>,
				])
			: []),
		...(single?.kind === "pin"
			? [
					[
						"Electrical type",
						<PinTypeSelect key="electricalType" pin={single} onEdit={onEdit} />,
					] as [string, ReactNode],
				]
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
										className="ui-checkbox"
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
					...(symbol.netSymbol ? ["name"] : ["name", "reference", "value"]).map(
						(attribute) => {
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
						},
					),
				]
			: []),
	];
	const geometry: [string, ReactNode][] = single
		? [
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
				["Left X", distance(left)],
				["Bottom Y", distance(bottom)],
				["Width", distance(right - left)],
				["Height", distance(top - bottom)],
			];
	const pinLabels = single?.kind === "pin" ? pinLabelRows(single, onEdit) : [];
	const labelPosition = symbol?.netSymbol &&
		symbol.children.length > 0 &&
		allowNetEdits && (
			<label className={rowClassName}>
				Label position
				<select
					aria-label="Label position"
					value={symbolLabelPosition(symbol, "name")}
					className="ui-select w-28"
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
			</label>
		);
	const hasAppearance =
		pinLabels.length > 0 ||
		!!labelPosition ||
		textShapes.length > 0 ||
		basicShapes.length > 0 ||
		fillable.length > 0 ||
		outlinedShapes.length > 0;
	return (
		<FloatingPanel label="Selection attributes" position="top-right">
			<PanelHeader
				onClear={onClear}
				title={
					<p className={titleClassName}>
						{single
							? symbol
								? symbol.netSymbol
									? symbol.attributes.name || "Net symbol"
									: [symbol.attributes.name, symbol.attributes.reference]
											.filter(Boolean)
											.join(" · ") || "Symbol"
								: pad
									? `Pad ${pad.pad.number}`.trim()
									: (kindLabels[type] ?? type)
							: "Selected shapes"}
					</p>
				}
				subtitle={
					single ? (
						// Reads "type · ID 3", with the ID as a labelled value.
						<dl className="m-0 flex gap-1">
							<div>
								<dt className="sr-only">Type</dt>
								<dd className="m-0">{type}</dd>
							</div>
							<div className="flex gap-1 before:content-['·']">
								<dt>ID</dt>
								<dd className="m-0">{single.id}</dd>
							</div>
						</dl>
					) : (
						<span>{shapes.length} items</span>
					)
				}
			/>
			<div
				className="m-0 min-h-0 overflow-y-auto overscroll-contain max-[760px]:pb-4 max-[760px]:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
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
				{(symbol || (!single && onCreateSymbol) || single?.kind === "text") && (
					<div className="flex flex-col gap-2.5 px-3 pt-3 pb-2.5">
						{symbol && (
							<button
								type="button"
								onClick={onEditSymbol}
								disabled={!onEditSymbol}
								title={
									onEditSymbol ? "Open the library definition" : noDefinition
								}
								className={actionClassName}
								data-variant="secondary"
							>
								Edit symbol
							</button>
						)}
						{symbol && !onEditSymbol && (
							<p className="m-0 text-xs text-fg-faint">{noDefinition}</p>
						)}
						{!single && onCreateSymbol && (
							<>
								<button
									type="button"
									onClick={onCreateSymbol}
									disabled={!canCreateSymbol}
									className={actionClassName}
									data-variant="secondary"
								>
									Create symbol
								</button>
								{!canCreateSymbol && (
									<p className="m-0 text-xs text-fg-faint">
										Select shapes without existing symbols or electrical labels
										to create a symbol.
									</p>
								)}
							</>
						)}
						{single?.kind === "text" && allowNetEdits && !isSymbolChild && (
							<label className="flex flex-col gap-1.5 text-xs text-fg-muted">
								Label role
								<select
									aria-label="Label role"
									className="ui-select w-full"
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
							<label className="flex flex-col gap-1.5 text-xs text-fg-muted">
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
									className="ui-input block w-full resize-y"
									onBlur={(event) =>
										onEdit({ kind: "text", text: event.currentTarget.value })
									}
									onKeyDown={(event) => {
										if (event.key === "Escape") event.currentTarget.blur();
									}}
								/>
							</label>
						)}
						{isSymbolChild && single?.kind === "text" && (
							<button
								type="button"
								onClick={() => onEdit({ kind: "symbol-text-reset" })}
								disabled={!symbolTextMoved}
								title={
									symbolTextMoved
										? "Move this text back to where the symbol defines it"
										: "This text is already at its original position"
								}
								className={actionClassName}
								data-variant="secondary"
							>
								Reset position
							</button>
						)}
					</div>
				)}
				<Section title="Properties">
					<Rows rows={properties} />
				</Section>
				<Section title={single ? "Position and size" : "Selection bounds"}>
					<Rows rows={geometry} />
				</Section>
				{hasAppearance && (
					<Section title="Appearance">
						{pinLabels.length > 0 && <Rows rows={pinLabels} />}
						{labelPosition}
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
						{fillable.length > 0 && (
							<label className={rowClassName}>
								Filled
								<input
									type="checkbox"
									aria-label="Filled"
									className="ui-checkbox"
									checked={fillable.every((shape) => shape.filled)}
									onChange={(event) =>
										onEdit({
											kind: "fill",
											filled: event.currentTarget.checked,
										})
									}
								/>
							</label>
						)}
						{basicShapes.length > 0 && (
							<label className={rowClassName}>
								Line style
								<select
									aria-label="Line style"
									value={lineStyle}
									className="ui-select w-28"
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
							</label>
						)}
						{outlinedShapes.length > 0 && (
							<div className={rowClassName}>
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
										unit={unit}
										positive
										onChange={(value) => onAttributeChange("lineWidth", value)}
									/>
								)}
							</div>
						)}
					</Section>
				)}
				<Tips>
					{symbol
						? "Position edits move the whole symbol. Child positions are relative to the symbol center."
						: isSymbolChild
							? "Drag to move this item. Size and appearance edits apply to this instance."
							: single?.kind === "pin"
								? "Drag the pin or lead to move it."
								: single && isNetLabel(single)
									? "Drag to move the label."
									: "Drag to move; drag handles to resize."}{" "}
					Arrow keys move {distance(snapStep || SCHEMATIC_STEP)}; Shift + arrows
					move {distance((snapStep || SCHEMATIC_STEP) * 10)} when the drawing is
					focused.
				</Tips>
			</div>
		</FloatingPanel>
	);
}

/** The attributes of a symbol child that only the symbol definition changes. */
function FixedChildAttributes({
	shape,
	onClear,
	onEditSymbol,
	onEdit,
}: {
	shape: EditorShape;
	onClear: () => void;
	onEditSymbol?: () => void;
	onEdit: (edit: SelectionEdit) => void;
}) {
	const degrees = (((shape.rotation * 180) / Math.PI) % 360) + 360;
	const angle = `${Number((degrees % 360).toFixed(2))}°`;
	const attributes: [string, ReactNode][] =
		shape.kind === "pin"
			? [
					["Type", "pin"],
					["Number", shape.number || "—"],
					["Name", shape.name || "—"],
					[
						"Electrical type",
						<PinTypeSelect key="electricalType" pin={shape} onEdit={onEdit} />,
					],
					["Center X", formatMils(shape.x)],
					["Center Y", formatMils(shape.y)],
					["Lead length", formatMils(shape.length ?? 0)],
					["Angle", angle],
				]
			: [
					["Type", shape.kind],
					["Center X", formatMils(shape.x)],
					["Center Y", formatMils(shape.y)],
					["Angle", angle],
				];
	return (
		<FloatingPanel label="Selection attributes" position="top-right">
			<PanelHeader
				onClear={onClear}
				title={
					<p className={titleClassName}>
						{shape.kind === "pin"
							? `Pin ${[shape.number, shape.name].filter(Boolean).join(" · ")}`
							: `${shape.kind} ${shape.id}`}
						<Lock
							size={13}
							aria-label="Fixed"
							className="shrink-0 text-fg-faint"
						/>
					</p>
				}
				subtitle={<span>Fixed by the symbol definition</span>}
			/>
			<div className="m-0 min-h-0 overflow-y-auto overscroll-contain">
				<div className="px-3 pt-3 pb-2.5">
					<button
						type="button"
						onClick={onEditSymbol}
						disabled={!onEditSymbol}
						title={onEditSymbol ? "Open the library definition" : noDefinition}
						className={actionClassName}
						data-variant="secondary"
					>
						Edit symbol
					</button>
					{!onEditSymbol && (
						<p className="m-0 mt-2.5 text-xs text-fg-faint">{noDefinition}</p>
					)}
				</div>
				<Section title="Properties">
					<Rows rows={attributes} />
				</Section>
				{shape.kind === "pin" && (
					<Section title="Appearance">
						<Rows rows={pinLabelRows(shape, onEdit)} />
					</Section>
				)}
				<Tips>
					Pins are fixed by the symbol definition. Edit the symbol to change
					them. Electrical type and label visibility changes apply to this
					placement only. Positions are relative to the symbol center. Dragging,
					arrow keys and rotation act on the whole symbol.
				</Tips>
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
		<>
			{(["horizontalAlign", "verticalAlign"] as const).map((axis) => {
				const horizontal = axis === "horizontalAlign";
				const title = `${label} ${horizontal ? "horizontal" : "vertical"} alignment`;
				const value = horizontal ? horizontalAlign : verticalAlign;
				return (
					<label key={axis} className={rowClassName}>
						<span>{horizontal ? "Horizontal align" : "Vertical align"}</span>
						<select
							aria-label={title}
							value={value}
							className="ui-select w-28"
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
		</>
	);
}
