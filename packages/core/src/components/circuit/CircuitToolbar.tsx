import { Loading, lazy } from "solid-js";
import { ErcButton } from "#/components/editor/ErcButton.tsx";
import {
	Cable,
	CirclePlus,
	Cpu,
	Hand,
	type LucideIcon,
	MousePointer2,
	Redo2,
	Shuffle,
	Trash2,
	Undo2,
} from "#/components/ui/icons.tsx";
import {
	ToolbarDock,
	ToolbarSeparator,
} from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { ZoomControls } from "#/components/viewer/ZoomControls.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

const CircuitComponentPicker = lazy(() =>
	import("#/components/circuit/CircuitComponentPicker.tsx").then((module) => ({
		default: module.CircuitComponentPicker,
	})),
);

export type CircuitTool = "select" | "connect" | "pan" | "component" | "net";

export function CircuitToolbar(props: {
	tool: CircuitTool;
	onToolChange(tool: CircuitTool): void;
	canDelete: boolean;
	onDelete(): void;
	canUndo: boolean;
	canRedo: boolean;
	zoomLevel: number;
	onZoom(factor: number): void;
	onFit(): void;
	untangling: boolean;
	onUntangle(): void;
	ercOpen: boolean;
	onErc(): void;
	onChooseComponent(definition: SymbolDefinition): void;
	onUndo(): void;
	onRedo(): void;
}) {
	const button = viewControlButtonClassName;
	const toolButton = (
		id: CircuitTool,
		label: string,
		Icon: LucideIcon,
		toggles = false,
	) => (
		<TooltipButton
			class={button}
			tooltip={label}
			aria-label={label}
			aria-pressed={props.tool === id ? "true" : "false"}
			onClick={() =>
				props.onToolChange(toggles && props.tool === id ? "select" : id)
			}
		>
			<Icon size={18} aria-hidden="true" />
		</TooltipButton>
	);
	return (
		<ToolbarDock label="Circuit tools">
			<TooltipButton
				class={button}
				tooltip="Undo"
				aria-label="Undo"
				data-shortcut-keeps-focus
				shortcut="Ctrl/Cmd + Z"
				disabled={!props.canUndo}
				onClick={() => props.onUndo()}
			>
				<Undo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				class={button}
				tooltip="Redo"
				aria-label="Redo"
				data-shortcut-keeps-focus
				shortcut="Ctrl/Cmd + Shift + Z"
				disabled={!props.canRedo}
				onClick={() => props.onRedo()}
			>
				<Redo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<ToolbarSeparator />
			{toolButton("select", "Select", MousePointer2)}
			{toolButton("pan", "Pan", Hand)}
			<ToolbarSeparator />
			<Loading
				fallback={
					<button type="button" class={button} aria-label="Components" disabled>
						<Cpu size={18} aria-hidden="true" />
					</button>
				}
			>
				<CircuitComponentPicker
					active={props.tool === "component"}
					onChoose={(definition) => props.onChooseComponent(definition)}
				/>
			</Loading>
			{toolButton("connect", "Connect pins", Cable, true)}
			{toolButton("net", "Add net", CirclePlus, true)}
			<ToolbarSeparator />
			<TooltipButton
				class={button}
				tooltip="Untangle"
				aria-label="Untangle"
				aria-busy={props.untangling ? "true" : "false"}
				aria-disabled={props.untangling ? "true" : "false"}
				onClick={() => props.onUntangle()}
			>
				<Shuffle size={18} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				class={button}
				tooltip="Delete selection"
				aria-label="Delete"
				shortcut="Delete"
				disabled={!props.canDelete}
				onClick={() => props.onDelete()}
			>
				<Trash2 size={18} aria-hidden="true" />
			</TooltipButton>
			<ToolbarSeparator />
			<ErcButton open={props.ercOpen} onClick={() => props.onErc()} />
			<ToolbarSeparator />
			<ZoomControls
				zoom={(factor) => props.onZoom(factor)}
				fit={() => props.onFit()}
				canZoomIn={props.zoomLevel < 10 - 1e-6}
				canZoomOut={props.zoomLevel > 0.1 + 1e-6}
				buttonClassName={button}
				fitClassName={`${button} min-w-14 tabular-nums`}
				fitLabel="Fit graph"
				fitTitle="Fit graph"
			>
				{Math.round(props.zoomLevel * 100)}%
			</ZoomControls>
		</ToolbarDock>
	);
}
