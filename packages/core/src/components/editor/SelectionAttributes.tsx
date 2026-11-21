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
import type { ShapeZone } from "@ecad/drawing-core/drawing/schema.ts";
import {
	boxBorder,
	boxText,
	type EditorShape,
	isBasicShape,
	isFillableShape,
	type PinShape,
	type ShapeAttribute,
	type SymbolLabelPosition,
	shapeBounds,
	symbolLabelPosition,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { extraAttributes } from "@ecad/drawing-core/drawing/symbol-attributes.ts";
import {
	horizontalAlignments,
	type TextAlignment,
	verticalAlignments,
} from "@ecad/drawing-core/drawing/text-alignment.ts";
import {
	formatLength,
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
	isCopperLayer,
	isOuterCopperLayer,
	type PadType,
	padTypeLabels,
	padTypes,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	isDrilled,
	isHole,
	isPad,
	isVia,
	type PadOutline,
	type PadShape,
	padCornerRadius,
	padMinorSize,
	padOutline,
	shapeLayer,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import type { JSX } from "@solidjs/web";
import {
	createEffect,
	createMemo,
	createRenderEffect,
	createSignal,
	For,
	Match,
	Show,
	Switch,
} from "solid-js";
import {
	type FootprintChoices,
	SymbolFootprintField,
} from "#/components/editor/SymbolFootprintField.tsx";
import { SymbolInstanceAttributeForm } from "#/components/editor/SymbolInstanceAttributeForm.tsx";
import { SymbolInstanceAttributeInput } from "#/components/editor/SymbolInstanceAttributeInput.tsx";
import { keepChecked } from "#/components/ui/checkbox.ts";
import { Lock, X } from "#/components/ui/icons.tsx";
import { Keyed } from "#/components/ui/Keyed.tsx";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type { LabelRole } from "#/drawing/placement.ts";
import { canCarryNet, type SelectionEdit } from "#/drawing/selection-edit.ts";

export const numberInputClassName = "ui-input w-28 pr-8 text-right";
export const textInputClassName = "ui-input w-36";

function MixedOption(props: { when: boolean; value: string }) {
	return (
		<Show when={props.when}>
			<option value={props.value} disabled>
				Mixed
			</option>
		</Show>
	);
}

/** A number input with its unit shown inside the field's right edge. */
export function UnitField(props: { unit?: string; children: JSX.Element }) {
	return (
		<span class="relative inline-flex">
			{props.children}
			<Show when={props.unit}>
				<span
					aria-hidden="true"
					class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-2xs text-fg-faint"
				>
					{props.unit}
				</span>
			</Show>
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
	via: "Via",
	"net label": "Net label",
	"supply label": "Supply label",
};

function PanelHeader(props: {
	title: JSX.Element;
	subtitle: JSX.Element;
	onClear: () => void;
}) {
	return (
		<header class="flex shrink-0 items-start gap-2 border-b border-line-subtle py-2.5 pr-2 pl-3">
			<div class="min-w-0 flex-1">
				{props.title}
				<div class="mt-0.5 flex gap-1 text-2xs text-fg-faint">
					{props.subtitle}
				</div>
			</div>
			<button
				type="button"
				class={panelIconButtonClassName}
				onClick={() => props.onClear()}
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

function Section(props: { title: string; children: JSX.Element }) {
	return (
		<section class="border-t border-line-subtle px-3 pt-2.5 pb-2 first:border-t-0">
			<h3 class="ui-section-label m-0 mb-1">{props.title}</h3>
			{props.children}
		</section>
	);
}

const rowClassName =
	"flex min-h-8 items-center justify-between gap-3 text-xs text-fg-muted";

function Rows(props: { children: JSX.Element }) {
	return <dl class="m-0">{props.children}</dl>;
}

function Row(props: { label: string; children: JSX.Element }) {
	return (
		<div class={rowClassName}>
			<dt>{props.label}</dt>
			<dd class="m-0 text-fg tabular-nums">{props.children}</dd>
		</div>
	);
}

function Tips(props: { children: JSX.Element }) {
	return (
		<details class="group border-t border-line-subtle px-3 py-2 text-xs text-fg-muted">
			<summary class="-mx-1 cursor-pointer rounded-sm px-1 py-0.5 font-medium select-none hover:text-fg">
				Keyboard tips
			</summary>
			<p class="m-0 mt-1.5 leading-[1.125rem]">{props.children}</p>
		</details>
	);
}

const actionClassName = "ui-button w-full";
const noDefinition = "This symbol's definition is read-only or unavailable.";

function SymbolDefinitionAction(props: {
	onEditSymbol?: () => void;
	onCopySymbol?: () => Promise<void>;
}) {
	const [copying, setCopying] = createSignal(false);
	return (
		<Show
			when={!props.onEditSymbol && props.onCopySymbol}
			fallback={
				<>
					<button
						type="button"
						onClick={() => props.onEditSymbol?.()}
						disabled={!props.onEditSymbol}
						title={
							props.onEditSymbol ? "Open the library definition" : noDefinition
						}
						class={actionClassName}
						data-variant="secondary"
					>
						Edit symbol
					</button>
					<Show when={!props.onEditSymbol}>
						<p class="m-0 text-xs text-fg-faint">{noDefinition}</p>
					</Show>
				</>
			}
		>
			{(onCopySymbol) => (
				<button
					type="button"
					onClick={() => {
						setCopying(true);
						void onCopySymbol()().finally(() => setCopying(false));
					}}
					disabled={copying()}
					title="Copy the definition into this project's symbols to edit it"
					class={actionClassName}
					data-variant="secondary"
				>
					{copying() ? "Copying…" : "Copy symbol to project"}
				</button>
			)}
		</Show>
	);
}

function CommitInput(props: {
	label: string;
	identity: string | number;
	value: string;
	maxlength?: number;
	onCommit: (value: string) => void;
}) {
	const identity = createMemo(() => props.identity);
	const value = createMemo(() => props.value);
	let input!: HTMLInputElement;
	const view = (
		<input
			ref={input}
			aria-label={props.label}
			maxlength={props.maxlength}
			class={textInputClassName}
			onBlur={(event) => props.onCommit(event.currentTarget.value)}
		/>
	);
	createRenderEffect(
		() => [identity(), value()] as const,
		([, text]) => {
			input.value = text;
		},
	);
	return view;
}

function AttributeInput(props: {
	label: string;
	value: number | "";
	identity?: string | number;
	unit?: string;
	positive?: boolean;
	nonNegative?: boolean;
	above?: number;
	below?: number;
	step?: string;
	placeholder?: string;
	onChange: (value: number) => void;
	onClear?: () => void;
}) {
	const unit = () => props.unit ?? "mil";
	const step = () => props.step ?? "any";
	const identity = createMemo(() => props.identity);
	const displayValue = createMemo(() => {
		const value = props.value;
		const converted =
			value === "" ? "" : unit() === "mil" ? toMils(value) : value;
		return converted === "" ? "" : Number(converted.toFixed(4)) || converted;
	});
	let input!: HTMLInputElement;
	const view = (
		<UnitField unit={unit()}>
			<input
				ref={input}
				type="number"
				aria-label={props.label}
				min={props.positive || props.nonNegative ? 0 : undefined}
				step={step()}
				title={step() === "90" ? "Angle in 90° increments" : undefined}
				placeholder={props.placeholder ?? "Mixed"}
				data-committed-value={props.value}
				class={numberInputClassName}
				onBlur={(event) => {
					const element = event.currentTarget;
					const value = props.value;
					const display = displayValue();
					if (
						props.onClear &&
						element.value === "" &&
						!element.validity.badInput
					) {
						if (value !== "") props.onClear();
						return;
					}
					const entered = element.valueAsNumber;
					const next = unit() === "mil" ? fromMils(entered) : entered;
					if (
						Number.isFinite(next) &&
						(!props.positive || next > 0) &&
						(!props.nonNegative || next >= 0) &&
						next > (props.above ?? Number.NEGATIVE_INFINITY) &&
						next < (props.below ?? Number.POSITIVE_INFINITY) &&
						(step() !== "90" || next % 90 === 0) &&
						(step() !== "1" || Number.isInteger(next))
					) {
						if (next !== value && entered !== display) props.onChange(next);
					} else element.value = String(display);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape")
						event.currentTarget.blur();
				}}
			/>
		</UnitField>
	);
	createRenderEffect(
		() => [identity(), displayValue()] as const,
		([id, display], previous) => {
			// Hide pointer-conversion noise without rewriting a value being typed.
			if (
				input.valueAsNumber !== display ||
				(previous !== undefined && previous[0] !== id)
			)
				input.value = String(display);
		},
	);
	return view;
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
	onCopySymbol?: () => Promise<void>;
	/** Shows the net symbol and label role controls. Reusable symbols have no nets. */
	allowNetEdits?: boolean;
	footprint?: boolean;
	/** Shows a symbol's footprint and the footprints it can use. */
	footprintChoices?: FootprintChoices;
	hiddenLayers?: ReadonlySet<FootprintLayer>;
	layers?: readonly FootprintLayer[];
	/** The board's nets, for tracks, vias and zones on a board. */
	boardNets?: readonly { id: string; name: string }[];
	unit?: LengthUnit;
	onEdit: (edit: SelectionEdit) => void;
	textFocusId: number | null;
	onTextFocus: () => void;
}

function PinSignalRows(props: {
	pin: Pick<PinShape, "electricalType" | "activeLow">;
	onEdit: (edit: SelectionEdit) => void;
}) {
	return (
		<>
			<Row label="Electrical type">
				<select
					aria-label="Electrical type"
					class="ui-select w-36"
					value={pinElectricalType(props.pin)}
					onChange={(event) =>
						props.onEdit({
							kind: "pin",
							attribute: "electricalType",
							value: event.currentTarget.value as PinElectricalType,
						})
					}
				>
					<For each={pinElectricalTypes}>
						{(type) => (
							<option value={type}>{pinElectricalTypeLabels[type]}</option>
						)}
					</For>
				</select>
			</Row>
			<Row label="Active level">
				<select
					aria-label="Active level"
					class="ui-select w-36"
					value={props.pin.activeLow ? "low" : "high"}
					onChange={(event) =>
						props.onEdit({
							kind: "pin",
							attribute: "activeLow",
							value: event.currentTarget.value === "low",
						})
					}
				>
					<option value="high">High</option>
					<option value="low">Low</option>
				</select>
			</Row>
		</>
	);
}

/** Show name and Show number checkboxes for one pin. */
function PinLabelRows(props: {
	pin: Pick<PinShape, "showLabels" | "showName" | "showNumber">;
	onEdit: (edit: SelectionEdit) => void;
}) {
	return (
		<For each={["showName", "showNumber"] as const}>
			{(attribute) => {
				const label = attribute === "showName" ? "Show name" : "Show number";
				return (
					<Row label={label}>
						<input
							type="checkbox"
							aria-label={label}
							class="ui-checkbox"
							checked={props.pin[attribute] ?? props.pin.showLabels ?? true}
							onChange={keepChecked((next) => {
								props.onEdit({
									kind: "pin",
									attribute,
									value: next,
								});
							})}
						/>
					</Row>
				);
			}}
		</For>
	);
}

function selectionType(shape: EditorShape, footprint: boolean): string {
	if (isPad(shape)) return "pad";
	if (isVia(shape)) return "via";
	if (isHole(shape)) return "unplated hole";
	if (shape.kind === "text" && shape.electrical)
		return `${shape.electrical} label`;
	if (shape.kind === "symbol" && shape.netSymbol) return "net symbol";
	return footprint && shape.kind === "line" ? "wire" : shape.kind;
}

function PadRows(props: {
	pad: PadShape;
	unit: LengthUnit;
	onEdit: (edit: SelectionEdit) => void;
	hiddenLayers?: ReadonlySet<FootprintLayer>;
}) {
	const pasteKeepsPadVisible = () =>
		props.pad.pad.paste === true &&
		props.hiddenLayers?.has(shapeLayer(props.pad)) === true;
	return (
		<>
			<Row label="Pad number">
				<CommitInput
					label="Pad number"
					identity={props.pad.id}
					value={props.pad.pad.number}
					maxlength={16}
					onCommit={(value) =>
						props.onEdit({
							kind: "pad",
							edit: { attribute: "number", value },
						})
					}
				/>
			</Row>
			<Row label="Pad type">
				<select
					aria-label="Pad type"
					class="ui-select w-36"
					value={props.pad.pad.type}
					onChange={(event) =>
						props.onEdit({
							kind: "pad",
							edit: {
								attribute: "type",
								value: event.currentTarget.value as PadType,
							},
						})
					}
				>
					<For each={padTypes}>
						{(type) => <option value={type}>{padTypeLabels[type]}</option>}
					</For>
				</select>
			</Row>
			<Row label="Pad shape">
				<select
					aria-label="Pad shape"
					class="ui-select w-36"
					value={padOutline(props.pad)}
					onChange={(event) =>
						props.onEdit({
							kind: "pad",
							edit: {
								attribute: "shape",
								value: event.currentTarget.value as PadOutline,
							},
						})
					}
				>
					<option value="rectangle">Rectangle</option>
					<option value="circle">Circle</option>
					<option value="oval">Oval</option>
				</select>
			</Row>
			<Show when={props.pad.kind === "rectangle"}>
				<Row label="Corner radius">
					<AttributeInput
						identity={props.pad.id}
						label="Corner radius"
						value={padCornerRadius(props.pad)}
						unit={props.unit}
						nonNegative
						onChange={(value) =>
							props.onEdit({
								kind: "pad",
								edit: { attribute: "cornerRadius", value },
							})
						}
					/>
				</Row>
			</Show>
			<Show when={props.pad.pad.type === "smd"}>
				<Row label="Solder paste">
					<input
						type="checkbox"
						aria-label="Solder paste"
						class="ui-checkbox"
						checked={props.pad.pad.paste ?? false}
						disabled={pasteKeepsPadVisible()}
						title={
							pasteKeepsPadVisible()
								? "Show the pad's copper layer to remove its paste"
								: undefined
						}
						onChange={keepChecked((next) => {
							props.onEdit({
								kind: "pad",
								edit: {
									attribute: "paste",
									value: next,
								},
							});
						})}
					/>
				</Row>
			</Show>
			<Show when={props.pad.pad.drill !== undefined}>
				<PadHoleRows
					pad={props.pad}
					drill={props.pad.pad.drill ?? 0}
					unit={props.unit}
					onEdit={props.onEdit}
				/>
			</Show>
		</>
	);
}

function PadHoleRows(props: {
	pad: PadShape;
	drill: number;
	unit: LengthUnit;
	onEdit: (edit: SelectionEdit) => void;
}) {
	const slot = () => props.pad.pad.slot;
	const drillLabel = () => (slot() === undefined ? "Drill" : "Slot width");
	return (
		<>
			<Row label="Hole">
				<select
					aria-label="Hole"
					class="ui-select w-36"
					value={slot() === undefined ? "round" : "slot"}
					onChange={(event) =>
						props.onEdit({
							kind: "pad",
							edit: {
								attribute: "hole",
								value: event.currentTarget.value === "slot" ? "slot" : "round",
							},
						})
					}
				>
					<option value="round">Round</option>
					<option value="slot">Slot</option>
				</select>
			</Row>
			<Row label={drillLabel()}>
				<AttributeInput
					identity={props.pad.id}
					label={drillLabel()}
					value={props.drill}
					unit={props.unit}
					positive
					below={Math.min(
						padMinorSize(props.pad),
						slot() ?? Number.POSITIVE_INFINITY,
					)}
					onChange={(value) =>
						props.onEdit({ kind: "pad", edit: { attribute: "drill", value } })
					}
				/>
			</Row>
			<Show when={slot()}>
				{(length) => (
					<Row label="Slot length">
						<AttributeInput
							identity={props.pad.id}
							label="Slot length"
							value={length()}
							unit={props.unit}
							above={props.drill}
							below={props.pad.width}
							onChange={(value) =>
								props.onEdit({
									kind: "pad",
									edit: { attribute: "slot", value },
								})
							}
						/>
					</Row>
				)}
			</Show>
		</>
	);
}

function DrillRow(props: {
	id: number;
	drill: number;
	below?: number;
	unit: LengthUnit;
	onChange: (drill: number) => void;
}) {
	return (
		<Row label="Drill">
			<AttributeInput
				identity={props.id}
				label="Drill"
				value={props.drill}
				unit={props.unit}
				positive
				below={props.below}
				onChange={(drill) => props.onChange(drill)}
			/>
		</Row>
	);
}

type ZoneShape = EditorShape & { readonly zone: ShapeZone };

function ZoneRows(props: {
	zone: ZoneShape;
	unit: LengthUnit;
	onEdit: (edit: SelectionEdit) => void;
}) {
	const settings = () => props.zone.zone;
	const ZoneLength = (row: {
		label: string;
		setting: "clearance" | "thermalGap" | "thermalSpokeWidth";
	}) => (
		<Row label={row.label}>
			<AttributeInput
				identity={props.zone.id}
				label={row.label}
				value={settings()[row.setting] ?? ""}
				unit={props.unit}
				positive
				below={row.setting === "clearance" ? undefined : 100 + 1e-9}
				placeholder="Board"
				onChange={(value) =>
					props.onEdit({ kind: "zone", zone: { [row.setting]: value } })
				}
				onClear={() =>
					props.onEdit({ kind: "zone", zone: { [row.setting]: undefined } })
				}
			/>
		</Row>
	);
	return (
		<>
			<ZoneLength label="Zone clearance" setting="clearance" />
			<Row label="Pad connection">
				<select
					aria-label="Pad connection"
					class="ui-select w-36"
					value={settings().padConnection ?? "thermal"}
					onChange={(event) =>
						props.onEdit({
							kind: "zone",
							zone: {
								padConnection:
									event.currentTarget.value === "solid" ? "solid" : undefined,
							},
						})
					}
				>
					<option value="thermal">Thermal relief</option>
					<option value="solid">Solid</option>
				</select>
			</Row>
			<Show when={settings().padConnection !== "solid"}>
				<ZoneLength label="Thermal gap" setting="thermalGap" />
				<ZoneLength label="Spoke width" setting="thermalSpokeWidth" />
			</Show>
			<Row label="Zone priority">
				<AttributeInput
					identity={props.zone.id}
					label="Zone priority"
					value={settings().priority ?? 0}
					unit=""
					nonNegative
					below={1001}
					step="1"
					onChange={(priority) =>
						props.onEdit({ kind: "zone-priority", priority })
					}
				/>
			</Row>
		</>
	);
}

/** Net, zone and side rows for items on a board. */
function BoardRows(props: {
	shapes: EditorShape[];
	nets: readonly { id: string; name: string }[];
	unit: LengthUnit;
	onEdit: (edit: SelectionEdit) => void;
}) {
	const net = createMemo(() => {
		const { shapes } = props;
		const copper = shapes.filter(
			(shape) =>
				canCarryNet(shape) && (isVia(shape) || isCopperLayer(shape.layer)),
		);
		if (copper.length !== shapes.length || !copper.length) return undefined;
		const first = "net" in copper[0] ? copper[0].net : undefined;
		const same = copper.every(
			(shape) => ("net" in shape ? shape.net : undefined) === first,
		);
		return {
			first,
			value: same ? (first ?? "") : "mixed",
			sorted: [...props.nets].sort((a, b) =>
				a.name.localeCompare(b.name, "en", { numeric: true }),
			),
		};
	});
	const zone = createMemo(() => {
		const { shapes } = props;
		const shape =
			shapes.length === 1 && shapes[0].kind === "rectangle"
				? shapes[0]
				: undefined;
		return shape?.zone ? (shape as ZoneShape) : undefined;
	});
	const side = createMemo(() => {
		const { shapes } = props;
		const footprints = shapes.filter(
			(shape) => shape.kind === "symbol" && shape.footprint,
		);
		if (footprints.length !== shapes.length || !footprints.length)
			return undefined;
		const back = footprints.every(
			(shape) => shape.kind === "symbol" && shape.flipped,
		);
		const front = footprints.every(
			(shape) => shape.kind === "symbol" && !shape.flipped,
		);
		return back ? "back" : front ? "front" : "mixed";
	});
	return (
		<>
			<Show when={net()}>
				{(current) => (
					<Row label="Net">
						<select
							aria-label="Net"
							class="ui-select w-36"
							value={current().value}
							onChange={(event) =>
								props.onEdit({
									kind: "net",
									net: event.currentTarget.value || undefined,
								})
							}
						>
							<MixedOption when={current().value === "mixed"} value="mixed" />
							<option value="">No net</option>
							<Show
								when={
									current().first &&
									!props.nets.some((item) => item.id === current().first)
								}
							>
								<option value={current().first}>Missing net</option>
							</Show>
							<For each={current().sorted}>
								{(item) => <option value={item.id}>{item.name}</option>}
							</For>
						</select>
					</Row>
				)}
			</Show>
			<Show when={zone()}>
				{(shape) => (
					<ZoneRows zone={shape()} unit={props.unit} onEdit={props.onEdit} />
				)}
			</Show>
			<Show when={side()}>
				{(value) => (
					<Row label="Side">
						<select
							aria-label="Side"
							class="ui-select w-36"
							value={value()}
							onChange={(event) =>
								props.onEdit({
									kind: "side",
									back: event.currentTarget.value === "back",
								})
							}
						>
							<MixedOption when={value() === "mixed"} value="mixed" />
							<option value="front">Front</option>
							<option value="back">Back</option>
						</select>
					</Row>
				)}
			</Show>
		</>
	);
}

export function SelectionAttributes(props: SelectionAttributesProps) {
	const only = createMemo(() =>
		props.shapes.length === 1 ? props.shapes[0] : undefined,
	);
	const fixed = () => (props.readOnly ? only() : undefined);
	const symbol = () => {
		const shape = only();
		return shape?.kind === "symbol" ? shape : undefined;
	};
	return (
		<Switch fallback={<SelectionAttributesPanel {...props} />}>
			<Match when={fixed()}>
				{(shape) => (
					<FixedChildAttributes
						shape={shape()}
						onClear={props.onClear}
						onEditSymbol={props.onEditSymbol}
						onCopySymbol={props.onCopySymbol}
						onEdit={props.onEdit}
						unit={props.unit}
					/>
				)}
			</Match>
			<Match when={symbol()}>
				{(shape) => (
					<Keyed key={`${shape().id}:${props.unit}`}>
						<SymbolInstanceAttributeForm
							symbol={shape()}
							millimetres={props.unit === "mm"}
						>
							<SelectionAttributesPanel {...props} />
						</SymbolInstanceAttributeForm>
					</Keyed>
				)}
			</Match>
		</Switch>
	);
}

function LockedCheckbox(props: {
	locked: boolean;
	mixed: boolean;
	onEdit: (edit: SelectionEdit) => void;
}) {
	let input!: HTMLInputElement;
	const view = (
		<input
			ref={input}
			type="checkbox"
			aria-label="Locked"
			checked={props.locked}
			onChange={keepChecked((next) => {
				props.onEdit({ kind: "lock", locked: next });
			})}
			class="ui-checkbox"
		/>
	);
	createRenderEffect(
		() => props.mixed,
		(mixed) => {
			input.indeterminate = mixed;
		},
	);
	return view;
}

function TextContentInput(props: {
	shape: Extract<EditorShape, { kind: "text" }>;
	textFocusId: number | null;
	onTextFocus: () => void;
	onEdit: (edit: SelectionEdit) => void;
	children?: JSX.Element;
}) {
	const identity = createMemo(() => props.shape.id);
	const text = createMemo(() => props.shape.text);
	const focus = createMemo(() => props.textFocusId === props.shape.id);
	const onFocused = createMemo(() => (focus() ? props.onTextFocus : undefined));
	let textarea!: HTMLTextAreaElement;
	const view = (
		<label class="flex flex-col gap-1.5 text-xs text-fg-muted">
			{props.shape.electrical ? "Net name" : "Text"}
			<textarea
				ref={textarea}
				aria-label={props.shape.electrical ? "Net name" : "Text content"}
				rows={3}
				maxlength={2000}
				class="ui-input block w-full resize-y"
				onBlur={(event) =>
					props.onEdit({ kind: "text", text: event.currentTarget.value })
				}
				onKeyDown={(event) => {
					if (event.key === "Escape") event.currentTarget.blur();
				}}
			/>
			{props.children}
		</label>
	);
	createRenderEffect(
		() => [identity(), text()] as const,
		([, value]) => {
			textarea.value = value;
		},
	);
	createEffect(onFocused, (focused) => {
		if (!focused) return;
		textarea.focus({ preventScroll: true });
		textarea.select();
		focused();
	});
	return view;
}

function SelectionAttributesPanel(props: SelectionAttributesProps) {
	const unit = (): LengthUnit => props.unit ?? "mil";
	const footprint = () => props.footprint ?? false;
	const allowNetEdits = () => props.allowNetEdits ?? false;
	const isSymbolChild = () => props.isSymbolChild ?? false;
	const layers = () => props.layers ?? footprintLayers;
	const basicShapes = createMemo(() =>
		props.shapes.flatMap((shape) => {
			const border =
				shape.kind === "symbol" ? boxBorder(shape)?.shape : undefined;
			if (isDrilled(shape)) return [];
			return isBasicShape(shape)
				? [shape]
				: border && isBasicShape(border)
					? [border]
					: [];
		}),
	);
	const textShapes = createMemo(() =>
		props.shapes.filter((shape) => shape.kind === "text"),
	);
	const lineStyle = createMemo(() => {
		const shapes = basicShapes();
		return shapes.length &&
			shapes.every(
				(shape) =>
					(shape.lineStyle ?? "solid") === (shapes[0].lineStyle ?? "solid"),
			)
			? (shapes[0].lineStyle ?? "solid")
			: "";
	});
	const outlinedShapes = createMemo(() =>
		props.shapes.flatMap((shape) =>
			shape.kind === "symbol"
				? symbolShapes(shape).filter((child) => child.kind !== "text")
				: shape.kind === "text" || isDrilled(shape)
					? []
					: [shape],
		),
	);
	const fillable = createMemo(() =>
		footprint()
			? props.shapes
					.filter(isFillableShape)
					.filter((shape) => !isDrilled(shape))
			: [],
	);
	const lineWidth = createMemo(() => {
		const shapes = outlinedShapes();
		return shapes.length &&
			shapes.every((shape) => shape.lineWidth === shapes[0].lineWidth)
			? shapes[0].lineWidth
			: "";
	});
	const onAttributeChange = (attribute: ShapeAttribute, value: number) =>
		props.onEdit({ kind: "attribute", attribute, value });
	const single = createMemo(() =>
		props.shapes.length === 1 ? props.shapes[0] : undefined,
	);
	const canCreateSymbol = createMemo(() =>
		props.shapes.every(
			(shape) =>
				shape.kind !== "symbol" && !(shape.kind === "text" && shape.electrical),
		),
	);
	const singleAs = <T extends EditorShape>(
		is: (shape: EditorShape) => shape is T,
	) =>
		createMemo(() => {
			const shape = single();
			return shape && is(shape) ? shape : undefined;
		});
	const symbol = singleAs((shape) => shape.kind === "symbol");
	const pin = singleAs((shape) => shape.kind === "pin");
	const text = singleAs((shape) => shape.kind === "text");
	const locked = createMemo(() =>
		props.shapes.every((shape) => shape.locked === true),
	);
	const partlyLocked = createMemo(
		() => !locked() && props.shapes.some((shape) => shape.locked),
	);
	const bounds = createMemo(() => {
		const boxes = props.shapes.map(shapeBounds);
		return {
			left: Math.min(...boxes.map((box) => box.minX)),
			right: Math.max(...boxes.map((box) => box.maxX)),
			bottom: Math.min(...boxes.map((box) => box.minY)),
			top: Math.max(...boxes.map((box) => box.maxY)),
		};
	});
	const distance = (value: number) => formatLength(value, unit());
	const pad = singleAs(isPad);
	const via = singleAs(isVia);
	const hole = singleAs(isHole);
	const layer = createMemo(() => {
		const { shapes } = props;
		return footprint() && shapes.every((shape) => shape.kind !== "symbol")
			? shapes.every((shape) => shapeLayer(shape) === shapeLayer(shapes[0]))
				? shapeLayer(shapes[0])
				: ""
			: undefined;
	});
	const throughEveryCopper = createMemo(() => {
		const shape = single();
		return (
			!!shape &&
			copperLayers.every((copper) => shapeLayers(shape).includes(copper))
		);
	});
	const type = createMemo(() => {
		const shape = single();
		return shape ? selectionType(shape, footprint()) : "";
	});
	const geometry = createMemo(() => {
		const shape = single();
		if (!shape) return undefined;
		if (shape.kind === "pin") return "pin";
		if (shape.kind === "symbol") return "symbol";
		if (shape.kind === "wire" || shape.kind === "line") return "linear";
		if (isNetLabel(shape) || shape.kind === "text") return "none";
		return "box";
	});
	const labelPositionSymbol = createMemo(() => {
		const current = symbol();
		return current?.netSymbol && current.children.length > 0 && allowNetEdits()
			? current
			: undefined;
	});
	const hasAppearance = createMemo(
		() =>
			!!pin() ||
			!!labelPositionSymbol() ||
			textShapes().length > 0 ||
			basicShapes().length > 0 ||
			fillable().length > 0 ||
			outlinedShapes().length > 0,
	);
	const title = createMemo(() => {
		const shape = single();
		const current = symbol();
		const currentPad = pad();
		if (!shape) return "Selected shapes";
		if (current)
			return current.netSymbol
				? current.attributes.name || "Net symbol"
				: [current.attributes.name, current.attributes.reference]
						.filter(Boolean)
						.join(" · ") || "Symbol";
		if (currentPad) return `Pad ${currentPad.pad.number}`.trim();
		return kindLabels[type()] ?? type();
	});
	const tip = createMemo(() => {
		const shape = single();
		if (symbol())
			return "Position edits move the whole symbol. Child positions are relative to the symbol center.";
		if (isSymbolChild())
			return "Drag to move this item. Size and appearance edits apply to this instance.";
		if (pin()) return "Drag the pin or lead to move it.";
		if (shape && isNetLabel(shape)) return "Drag to move the label.";
		return "Drag to move; drag handles to resize.";
	});
	const horizontalAlign = createMemo(() => {
		const shapes = textShapes();
		return shapes.every(
			(shape) =>
				(shape.horizontalAlign ?? "center") ===
				(shapes[0].horizontalAlign ?? "center"),
		)
			? (shapes[0].horizontalAlign ?? "center")
			: "";
	});
	const verticalAlign = createMemo(() => {
		const shapes = textShapes();
		return shapes.every(
			(shape) =>
				(shape.verticalAlign ?? "middle") ===
				(shapes[0].verticalAlign ?? "middle"),
		)
			? (shapes[0].verticalAlign ?? "middle")
			: "";
	});
	const symbolAttributeKeys = createMemo(() =>
		symbol()?.netSymbol
			? (["name"] as const)
			: (["name", "reference", "value"] as const),
	);
	const symbolExtraAttributes = createMemo(() => {
		const current = symbol();
		return current && !current.netSymbol
			? extraAttributes(current.attributes)
			: [];
	});
	const footprintField = createMemo(() => {
		const current = symbol();
		const choices = props.footprintChoices;
		return current &&
			choices &&
			!current.netSymbol &&
			current.children.some((child) => child.kind === "pin")
			? { symbol: current, choices }
			: undefined;
	});
	const selectionIds = createMemo(() =>
		props.shapes.map((shape) => shape.id).join(","),
	);
	const blurOnKey = (event: KeyboardEvent) => {
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
	};

	const Editable = (row: {
		label: string;
		attribute: ShapeAttribute;
		value: number;
	}) => {
		const position = () =>
			row.attribute === "x" ||
			row.attribute === "y" ||
			row.attribute === "angle";
		const step = () => {
			const kind = single()?.kind;
			if (
				row.attribute === "angle" &&
				(kind === "wire" || kind === "symbol" || kind === "pin")
			)
				return "90";
			return kind === "text" && (row.attribute === "x" || row.attribute === "y")
				? "0.1"
				: "any";
		};
		return (
			<Row label={row.label}>
				<Show
					when={symbol() && position()}
					fallback={
						<AttributeInput
							identity={single()?.id}
							label={row.label}
							value={row.value}
							nonNegative={row.attribute === "length"}
							positive={
								row.attribute !== "x" &&
								row.attribute !== "y" &&
								row.attribute !== "angle" &&
								row.attribute !== "length"
							}
							unit={row.attribute === "angle" ? "°" : unit()}
							step={step()}
							onChange={(next) => onAttributeChange(row.attribute, next)}
						/>
					}
				>
					<SymbolInstanceAttributeInput
						name={row.attribute as "x" | "y" | "angle"}
						label={row.label}
						value={row.value}
						unit={row.attribute === "angle" ? "°" : unit()}
						step={row.attribute === "angle" ? "90" : "any"}
						onCommit={(next) =>
							onAttributeChange(
								row.attribute,
								row.attribute === "angle" || unit() === "mm"
									? next
									: fromMils(next),
							)
						}
					/>
				</Show>
			</Row>
		);
	};
	const angle = (shape: EditorShape) => (shape.rotation * 180) / Math.PI;

	return (
		<Show when={props.shapes.length}>
			<FloatingPanel label="Selection attributes" position="top-right">
				<PanelHeader
					onClear={props.onClear}
					title={<p class={titleClassName}>{title()}</p>}
					subtitle={
						<Show
							when={single()}
							fallback={<span>{props.shapes.length} items</span>}
						>
							{(shape) => (
								// Reads "type · ID 3", with the ID as a labelled value.
								<dl class="m-0 flex gap-1">
									<div>
										<dt class="sr-only">Type</dt>
										<dd class="m-0">{type()}</dd>
									</div>
									<div class="flex gap-1 before:content-['·']">
										<dt>ID</dt>
										<dd class="m-0">{shape().id}</dd>
									</div>
								</dl>
							)}
						</Show>
					}
				/>
				<div
					class="m-0 min-h-0 overflow-y-auto overscroll-contain @max-[540px]:pb-4 @max-[540px]:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
					ref={(element) =>
						element.addEventListener("keydown", blurOnKey, { capture: true })
					}
				>
					{(symbol() || (!single() && props.onCreateSymbol) || text()) && (
						<div class="flex flex-col gap-2.5 px-3 pt-3 pb-2.5">
							{symbol() && (
								<SymbolDefinitionAction
									onEditSymbol={props.onEditSymbol}
									onCopySymbol={props.onCopySymbol}
								/>
							)}
							<Show when={!single() && props.onCreateSymbol}>
								{(onCreateSymbol) => (
									<>
										<button
											type="button"
											onClick={() => onCreateSymbol()()}
											disabled={!canCreateSymbol()}
											class={actionClassName}
											data-variant="secondary"
										>
											Create symbol
										</button>
										<Show when={!canCreateSymbol()}>
											<p class="m-0 text-xs text-fg-faint">
												Select shapes without existing symbols or electrical
												labels to create a symbol.
											</p>
										</Show>
									</>
								)}
							</Show>
							<Show when={text()}>
								{(shape) => (
									<>
										<Show when={allowNetEdits() && !isSymbolChild()}>
											<label class="flex flex-col gap-1.5 text-xs text-fg-muted">
												Label role
												<select
													aria-label="Label role"
													class="ui-select w-full"
													value={shape().electrical ?? "text"}
													onChange={(event) =>
														props.onEdit({
															kind: "label-role",
															role:
																event.currentTarget.value === "text"
																	? undefined
																	: (event.currentTarget.value as LabelRole),
														})
													}
												>
													<option value="text">Ordinary text</option>
													<option value="net">Net label</option>
													<option value="supply">Supply label</option>
												</select>
											</label>
										</Show>
										<TextContentInput
											shape={shape()}
											textFocusId={props.textFocusId}
											onTextFocus={props.onTextFocus}
											onEdit={props.onEdit}
										>
											<Show when={footprint() && !props.boardNets}>
												<span class="text-fg-faint">
													On a board, <code>{`\${REFERENCE}`}</code>,{" "}
													<code>{`\${VALUE}`}</code> and{" "}
													<code>{`\${FOOTPRINT_NAME}`}</code> show the
													component's reference, value and footprint name.
												</span>
											</Show>
										</TextContentInput>
										<Show when={isSymbolChild()}>
											<button
												type="button"
												onClick={() =>
													props.onEdit({ kind: "symbol-text-reset" })
												}
												disabled={!props.symbolTextMoved}
												title={
													props.symbolTextMoved
														? "Move this text back to where the symbol defines it"
														: "This text is already at its original position"
												}
												class={actionClassName}
												data-variant="secondary"
											>
												Reset position
											</button>
										</Show>
									</>
								)}
							</Show>
						</div>
					)}
					<Section title="Properties">
						<Rows>
							<Row label="Locked">
								<LockedCheckbox
									locked={locked()}
									mixed={partlyLocked()}
									onEdit={props.onEdit}
								/>
							</Row>
							<Show when={layer() !== undefined}>
								<Row label="Layer">
									<Switch
										fallback={
											<select
												aria-label="Layer"
												class="ui-select w-36"
												value={layer()}
												onChange={(event) =>
													props.onEdit({
														kind: "layer",
														layer: event.currentTarget.value as FootprintLayer,
													})
												}
											>
												<MixedOption when={layer() === ""} value="" />
												<For
													each={layers().filter(
														(item) => !pad() || isOuterCopperLayer(item),
													)}
												>
													{(item) => (
														<option
															value={item}
															disabled={props.hiddenLayers?.has(item)}
														>
															{footprintLayerLabels[item]}
															{props.hiddenLayers?.has(item) ? " (hidden)" : ""}
														</option>
													)}
												</For>
											</select>
										}
									>
										<Match when={throughEveryCopper()}>
											{layers().filter(isCopperLayer).length > 2
												? "Every copper layer"
												: "Both copper layers"}
										</Match>
										<Match when={props.shapes.every(isHole)}>
											Through the board
										</Match>
									</Switch>
								</Row>
							</Show>
							<Show when={pad()}>
								{(shape) => (
									<PadRows
										pad={shape()}
										unit={unit()}
										onEdit={props.onEdit}
										hiddenLayers={props.hiddenLayers}
									/>
								)}
							</Show>
							<Show when={via()}>
								{(shape) => (
									<DrillRow
										id={shape().id}
										drill={shape().via.drill}
										below={shape().width}
										unit={unit()}
										onChange={(drill) =>
											props.onEdit({ kind: "via-drill", drill })
										}
									/>
								)}
							</Show>
							<Show when={hole()}>
								{(shape) => (
									<DrillRow
										id={shape().id}
										drill={shape().hole.drill}
										unit={unit()}
										onChange={(drill) =>
											props.onEdit({ kind: "hole-drill", drill })
										}
									/>
								)}
							</Show>
							<Show when={props.boardNets}>
								{(nets) => (
									<BoardRows
										shapes={props.shapes}
										nets={nets()}
										unit={unit()}
										onEdit={props.onEdit}
									/>
								)}
							</Show>
							<Show when={pin()}>
								{(shape) => (
									<>
										<For each={["name", "number"] as const}>
											{(attribute) => {
												const label = attribute === "name" ? "Name" : "Number";
												return (
													<Row label={label}>
														<CommitInput
															label={label}
															identity={shape().id}
															value={shape()[attribute]}
															onCommit={(value) =>
																props.onEdit({ kind: "pin", attribute, value })
															}
														/>
													</Row>
												);
											}}
										</For>
										<PinSignalRows pin={shape()} onEdit={props.onEdit} />
									</>
								)}
							</Show>
							<Show when={symbol()}>
								{(shape) => (
									<>
										<Show when={allowNetEdits()}>
											<Row label="Net symbol">
												<input
													type="checkbox"
													aria-label="Net symbol"
													class="ui-checkbox"
													checked={shape().netSymbol ?? false}
													onChange={keepChecked((next) => {
														props.onEdit({
															kind: "net-symbol",
															netSymbol: next,
														});
													})}
												/>
											</Row>
										</Show>
										<For each={symbolAttributeKeys()}>
											{(key) => {
												const label = key[0].toUpperCase() + key.slice(1);
												return (
													<Row label={label}>
														<SymbolInstanceAttributeInput
															name={`attributes.${key}`}
															label={label}
															value={shape().attributes[key]}
															onCommit={(next) =>
																props.onEdit({
																	kind: "symbol-attribute",
																	attribute: key,
																	value: next,
																})
															}
														/>
													</Row>
												);
											}}
										</For>
										<For
											each={symbolExtraAttributes()}
											keyed={([attribute]) => attribute}
										>
											{(entry, index) => (
												<Row label={entry()[0]}>
													<SymbolInstanceAttributeInput
														name={`extraAttributes.${index()}`}
														label={entry()[0]}
														value={entry()[1]}
														onCommit={(next) =>
															props.onEdit({
																kind: "symbol-attribute",
																attribute: entry()[0],
																value: next,
															})
														}
													/>
												</Row>
											)}
										</For>
									</>
								)}
							</Show>
						</Rows>
					</Section>
					<Show when={footprintField()}>
						{(field) => (
							<Section title="Footprint">
								<SymbolFootprintField
									symbol={field().symbol}
									choices={field().choices}
									onChange={(next) =>
										props.onEdit({ kind: "symbol-footprint", footprint: next })
									}
								/>
							</Section>
						)}
					</Show>
					<Section title={single() ? "Position and size" : "Selection bounds"}>
						<Rows>
							<Show
								when={single()}
								fallback={
									<>
										<Row label="Left X">{distance(bounds().left)}</Row>
										<Row label="Bottom Y">{distance(bounds().bottom)}</Row>
										<Row label="Width">
											{distance(bounds().right - bounds().left)}
										</Row>
										<Row label="Height">
											{distance(bounds().top - bounds().bottom)}
										</Row>
									</>
								}
							>
								{(shape) => (
									<>
										<Editable
											label={shape().kind === "text" ? "Anchor X" : "Center X"}
											attribute="x"
											value={shape().x}
										/>
										<Editable
											label={shape().kind === "text" ? "Anchor Y" : "Center Y"}
											attribute="y"
											value={shape().y}
										/>
										<Switch>
											<Match when={pin()}>
												{(current) => (
													<>
														<Editable
															label="Lead length"
															attribute="length"
															value={current().length ?? 0}
														/>
														<Editable
															label="Angle"
															attribute="angle"
															value={angle(current())}
														/>
													</>
												)}
											</Match>
											<Match when={symbol()}>
												{(current) => (
													<>
														<Show when={boxText(current())}>
															{(box) => (
																<Editable
																	label="Font size"
																	attribute="fontSize"
																	value={box().shape.fontSize ?? 0}
																/>
															)}
														</Show>
														<Editable
															label="Angle"
															attribute="angle"
															value={angle(current())}
														/>
													</>
												)}
											</Match>
											<Match when={geometry() === "linear"}>
												<Editable
													label="Length"
													attribute="width"
													value={shape().width}
												/>
												<Editable
													label="Angle"
													attribute="angle"
													value={angle(shape())}
												/>
											</Match>
											<Match when={geometry() === "box"}>
												<Editable
													label="Width"
													attribute="width"
													value={shape().width}
												/>
												<Editable
													label="Height"
													attribute="height"
													value={shape().height}
												/>
											</Match>
										</Switch>
										<Show when={shape().kind === "circle"}>
											<Editable
												label="Radius"
												attribute="radius"
												value={shape().width / 2}
											/>
										</Show>
										<Show when={text()}>
											{(current) => (
												<>
													<Editable
														label="Font size"
														attribute="fontSize"
														value={current().fontSize}
													/>
													<Editable
														label="Angle"
														attribute="angle"
														value={angle(current())}
													/>
												</>
											)}
										</Show>
									</>
								)}
							</Show>
						</Rows>
					</Section>
					{hasAppearance() && (
						<Section title="Appearance">
							<Show when={pin()}>
								{(shape) => (
									<Rows>
										<PinLabelRows pin={shape()} onEdit={props.onEdit} />
									</Rows>
								)}
							</Show>
							<Show when={labelPositionSymbol()}>
								{(current) => (
									<label class={rowClassName}>
										Label position
										<select
											aria-label="Label position"
											value={symbolLabelPosition(current(), "name")}
											class="ui-select w-28"
											onChange={(event) =>
												props.onEdit({
													kind: "symbol-label-position",
													position: event.currentTarget
														.value as SymbolLabelPosition,
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
								)}
							</Show>
							<Show when={textShapes().length > 0}>
								<TextAlignmentInputs
									horizontalAlign={horizontalAlign()}
									verticalAlign={verticalAlign()}
									onChange={(value) =>
										props.onEdit({ kind: "text-alignment", alignment: value })
									}
								/>
							</Show>
							<Show when={fillable().length > 0}>
								<label class={rowClassName}>
									Filled
									<input
										type="checkbox"
										aria-label="Filled"
										class="ui-checkbox"
										checked={fillable().every((shape) => shape.filled)}
										onChange={keepChecked((next) => {
											props.onEdit({
												kind: "fill",
												filled: next,
											});
										})}
									/>
								</label>
							</Show>
							<Show when={basicShapes().length > 0}>
								<label class={rowClassName}>
									Line style
									<select
										aria-label="Line style"
										value={lineStyle()}
										class="ui-select w-28"
										onChange={(event) =>
											props.onEdit({
												kind: "line-style",
												lineStyle: event.currentTarget.value as LineStyle,
											})
										}
									>
										<MixedOption when={lineStyle() === ""} value="" />
										<For each={lineStyles}>
											{(style) => (
												<option value={style}>{lineStyleLabels[style]}</option>
											)}
										</For>
									</select>
								</label>
							</Show>
							<Show when={outlinedShapes().length > 0}>
								<div class={rowClassName}>
									<span>Line width</span>
									{symbol() ? (
										<SymbolInstanceAttributeInput
											name="lineWidth"
											label="Line width"
											value={lineWidth()}
											unit={unit()}
											positive
											onCommit={(value) => {
												if (value !== null)
													onAttributeChange(
														"lineWidth",
														unit() === "mm" ? value : fromMils(value),
													);
											}}
										/>
									) : (
										<AttributeInput
											identity={selectionIds()}
											label="Line width"
											value={lineWidth()}
											unit={unit()}
											positive
											onChange={(value) =>
												onAttributeChange("lineWidth", value)
											}
										/>
									)}
								</div>
							</Show>
						</Section>
					)}
					<Tips>
						{tip()} Arrow keys move {distance(props.snapStep || SCHEMATIC_STEP)}
						; Shift + arrows move{" "}
						{distance((props.snapStep || SCHEMATIC_STEP) * 10)} when the drawing
						is focused.
					</Tips>
				</div>
			</FloatingPanel>
		</Show>
	);
}

/** The attributes of a symbol child that only the symbol definition changes. */
function FixedChildAttributes(props: {
	shape: EditorShape;
	onClear: () => void;
	onEditSymbol?: () => void;
	onCopySymbol?: () => Promise<void>;
	onEdit: (edit: SelectionEdit) => void;
	unit?: LengthUnit;
}) {
	const length = (value: number) => formatLength(value, props.unit ?? "mil");
	const angle = () => {
		const degrees = (((props.shape.rotation * 180) / Math.PI) % 360) + 360;
		return `${Number((degrees % 360).toFixed(2))}°`;
	};
	const pin = createMemo(() =>
		props.shape.kind === "pin" ? props.shape : undefined,
	);
	return (
		<FloatingPanel label="Selection attributes" position="top-right">
			<PanelHeader
				onClear={props.onClear}
				title={
					<p class={titleClassName}>
						{pin()
							? `Pin ${[pin()?.number, pin()?.name].filter(Boolean).join(" · ")}`
							: `${props.shape.kind} ${props.shape.id}`}
						<Lock size={13} aria-label="Fixed" class="shrink-0 text-fg-faint" />
					</p>
				}
				subtitle={<span>Fixed by the symbol definition</span>}
			/>
			<div class="m-0 min-h-0 overflow-y-auto overscroll-contain">
				<div class="flex flex-col gap-2.5 px-3 pt-3 pb-2.5">
					<SymbolDefinitionAction
						onEditSymbol={props.onEditSymbol}
						onCopySymbol={props.onCopySymbol}
					/>
				</div>
				<Section title="Properties">
					<Rows>
						<Show
							when={pin()}
							fallback={
								<>
									<Row label="Type">{props.shape.kind}</Row>
									<Row label="Center X">{length(props.shape.x)}</Row>
									<Row label="Center Y">{length(props.shape.y)}</Row>
									<Row label="Angle">{angle()}</Row>
								</>
							}
						>
							{(shape) => (
								<>
									<Row label="Type">pin</Row>
									<Row label="Number">{shape().number || "—"}</Row>
									<Row label="Name">{shape().name || "—"}</Row>
									<PinSignalRows pin={shape()} onEdit={props.onEdit} />
									<Row label="Center X">{length(shape().x)}</Row>
									<Row label="Center Y">{length(shape().y)}</Row>
									<Row label="Lead length">{length(shape().length ?? 0)}</Row>
									<Row label="Angle">{angle()}</Row>
								</>
							)}
						</Show>
					</Rows>
				</Section>
				<Show when={pin()}>
					{(shape) => (
						<Section title="Appearance">
							<Rows>
								<PinLabelRows pin={shape()} onEdit={props.onEdit} />
							</Rows>
						</Section>
					)}
				</Show>
				<Tips>
					Pins are fixed by the symbol definition. Edit the symbol to change
					them. Electrical type, active level and label visibility changes apply
					to this placement only. Positions are relative to the symbol center.
					Dragging, arrow keys and rotation act on the whole symbol.
				</Tips>
			</div>
		</FloatingPanel>
	);
}

function TextAlignmentInputs(props: {
	label?: string;
	horizontalAlign: NonNullable<TextAlignment["horizontalAlign"]> | "";
	verticalAlign: NonNullable<TextAlignment["verticalAlign"]> | "";
	onChange: (alignment: TextAlignment) => void;
}) {
	return (
		<For each={["horizontalAlign", "verticalAlign"] as const}>
			{(axis) => {
				const horizontal = axis === "horizontalAlign";
				const value = () =>
					horizontal ? props.horizontalAlign : props.verticalAlign;
				return (
					<label class={rowClassName}>
						<span>{horizontal ? "Horizontal align" : "Vertical align"}</span>
						<select
							aria-label={`${props.label ?? "Text"} ${horizontal ? "horizontal" : "vertical"} alignment`}
							value={value()}
							class="ui-select w-28"
							onChange={(event) =>
								props.onChange({ [axis]: event.currentTarget.value })
							}
						>
							<MixedOption when={value() === ""} value="" />
							<For
								each={horizontal ? horizontalAlignments : verticalAlignments}
							>
								{(option) => (
									<option value={option}>
										{option[0].toUpperCase() + option.slice(1)}
									</option>
								)}
							</For>
						</select>
					</label>
				);
			}}
		</For>
	);
}
