import { componentWidth } from "@ecad/drawing-core/circuit/graph.ts";
import type {
	CircuitComponent,
	CircuitNet,
} from "@ecad/drawing-core/circuit/model.ts";
import { createMemo, For, Show } from "solid-js";
import { CircuitInlineFields } from "#/components/circuit/CircuitInlineFields.tsx";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import type { CircuitGraphActions } from "#/components/circuit/circuitEditorState.ts";
import { GraphButton } from "#/components/circuit/GraphButton.tsx";
import { ChevronDown, ChevronUp } from "#/components/ui/icons.tsx";
import { arrowDelta } from "#/lib/keyboard.ts";

/**
 * One component box on the circuit graph: its header handle, the collapse
 * button, inline reference and value editing, and a button for each visible
 * pin.
 */
export function CircuitComponentNode(props: {
	component: CircuitComponent;
	x: number;
	y: number;
	height: number;
	collapsed: boolean;
	connectsLeft: boolean;
	connectsRight: boolean;
	pinSides: string;
	pinNets: ReadonlyMap<string, CircuitNet>;
	noConnectPinIds: readonly string[];
	tool: CircuitTool;
	gridStep: number;
	selected: boolean;
	isEditing: boolean;
	/** Pins drawn as selected: the selected, pending and drag-source pins. */
	highlightedPins: Readonly<Record<string, boolean>>;
	/** The pin a dragged connection would end on. */
	targetPins: Readonly<Record<string, boolean>>;
	actions: CircuitGraphActions;
}) {
	const visiblePins = createMemo(() =>
		props.collapsed ? [] : props.component.pins,
	);
	const collapsedSides = createMemo(() => [
		...(props.connectsLeft ? (["left"] as const) : []),
		...(props.connectsRight ? (["right"] as const) : []),
	]);
	return (
		<g
			class={["circuit-component", { "is-selected": props.selected }]}
			transform={`translate(${props.x},${props.y})`}
		>
			<rect
				class={["circuit-component-body", { "is-selected": props.selected }]}
				width={componentWidth}
				height={props.height}
				rx="10"
			/>
			<GraphButton
				width={componentWidth}
				height={65}
				class="circuit-node-handle"
				aria-label={`Select component ${props.component.reference}`}
				onDblClick={() => {
					if (props.tool === "select")
						props.actions.edit({ kind: "component", id: props.component.id });
				}}
				onContextMenu={(event) =>
					props.actions.openMenu(event, {
						kind: "component",
						id: props.component.id,
					})
				}
				onClick={() => {
					if (props.tool === "select")
						props.actions.select({ kind: "component", id: props.component.id });
				}}
				onPointerDown={(event) =>
					props.actions.startDrag(event, {
						id: props.component.id,
						kind: "component",
						x: props.x,
						y: props.y,
					})
				}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						props.actions.select({ kind: "component", id: props.component.id });
					}
					const delta = arrowDelta(event.key, props.gridStep);
					if (delta) {
						event.preventDefault();
						props.actions.run({
							type: "move",
							positions: [
								{
									id: props.component.id,
									kind: "component",
									...props.actions.snap({
										x: props.x + delta.x,
										y: props.y + delta.y,
									}),
								},
							],
						});
					}
				}}
			>
				<rect width={componentWidth} height="65" rx="10" fill="transparent" />
				<text class="circuit-reference" x="18" y="28">
					{props.component.reference}
				</text>
				<text class="circuit-value" x="18" y="49">
					{props.component.value || props.component.part.name}
				</text>
			</GraphButton>
			<g
				class="circuit-collapse-footer"
				style={{ transform: `translateY(${props.height - 32}px)` }}
			>
				<GraphButton
					x={(componentWidth - 28) / 2}
					y={0}
					width={28}
					height={28}
					class="circuit-collapse-button"
					aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.component.reference}`}
					aria-expanded={props.collapsed ? "false" : "true"}
					title={props.collapsed ? "Show pins" : "Hide pins"}
					onPointerDown={(event) => {
						if (props.tool === "select") event.stopPropagation();
					}}
					onClick={(event) => {
						event.stopPropagation();
						if (props.tool !== "select") return;
						props.actions.select({ kind: "component", id: props.component.id });
						props.actions.run({
							type: "set-component-collapsed",
							id: props.component.id,
							collapsed: !props.collapsed,
						});
					}}
				>
					<rect
						class="circuit-collapse-control"
						x={(componentWidth - 28) / 2}
						y={0}
						width={28}
						height={28}
						rx={4}
					/>
					<Show
						when={props.collapsed}
						fallback={
							<ChevronUp x={(componentWidth - 20) / 2} y={4} size={20} />
						}
					>
						<ChevronDown x={(componentWidth - 20) / 2} y={4} size={20} />
					</Show>
				</GraphButton>
			</g>
			<Show when={props.collapsed}>
				<For each={collapsedSides()}>
					{(side) => (
						<circle
							data-side={side}
							class="circuit-collapsed-anchor"
							cx={side === "left" ? 0 : componentWidth}
							cy={32}
							r={6}
						/>
					)}
				</For>
			</Show>
			<Show when={props.isEditing}>
				<CircuitInlineFields
					x={8}
					y={4}
					width={componentWidth - 16}
					fields={[
						{
							label: "Reference",
							value: props.component.reference,
							maxLength: 200,
							required: true,
						},
						{
							label: "Value",
							value: props.component.value,
							maxLength: 200,
						},
					]}
					onCancel={props.actions.finishEditing}
					onCommit={([reference, value]) => {
						if (
							(reference === props.component.reference &&
								value === props.component.value) ||
							props.actions.run({
								type: "update-component",
								id: props.component.id,
								reference,
								value,
							})
						) {
							props.actions.finishEditing();
							return true;
						}
						return false;
					}}
				/>
			</Show>
			<For each={visiblePins()} keyed={(pin) => pin.id}>
				{(pin, index) => {
					const left = () => props.pinSides[index()] === "l";
					return (
						<GraphButton
							x={-24}
							y={70 + index() * 30}
							width={248}
							height={28}
							aria-label={`Pin ${props.component.reference}.${pin().number}`}
							data-circuit-pin-id={pin().id}
							onContextMenu={(event) =>
								props.actions.openMenu(event, { kind: "pin", id: pin().id })
							}
							class={[
								"circuit-pin",
								{
									"is-selected": props.highlightedPins[pin().id] === true,
									"is-target": props.targetPins[pin().id] === true,
								},
							]}
							onPointerDown={(event) =>
								props.actions.startConnectionDrag(event, pin().id)
							}
							onClick={() => props.actions.selectPin(pin().id)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									props.actions.selectPin(pin().id);
								}
							}}
						>
							<rect
								x="8"
								y={70 + index() * 30}
								width="202"
								height="28"
								fill="transparent"
							/>
							<text x="18" y={89 + index() * 30}>
								{pin().number}
								<tspan
									class="circuit-pin-name"
									dx="10"
									text-decoration={pin().activeLow ? "overline" : undefined}
								>
									{pin().name}
								</tspan>
							</text>
							<circle
								class={{ connected: props.pinNets.has(pin().id) }}
								cx={left() ? 0 : componentWidth}
								cy={84 + index() * 30}
								r="6"
							/>
							<Show when={props.noConnectPinIds.includes(pin().id)}>
								<path
									class="circuit-no-connect"
									d={`M ${left() ? -21 : 211} ${79 + index() * 30} l 10 10 m 0 -10 l -10 10`}
								/>
							</Show>
						</GraphButton>
					);
				}}
			</For>
		</g>
	);
}
