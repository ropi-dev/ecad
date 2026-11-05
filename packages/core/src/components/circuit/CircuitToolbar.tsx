import {
	Cable,
	CirclePlus,
	Hand,
	type LucideIcon,
	Microchip,
	MousePointer2,
	Redo2,
	Shuffle,
	Trash2,
	Undo2,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { ErcButton } from "#/components/editor/ErcButton.tsx";
import {
	ToolbarDock,
	ToolbarSeparator,
} from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { ZoomControls } from "#/components/viewer/ZoomControls.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";

const CircuitComponentPicker = lazy(() =>
	import("#/components/circuit/CircuitComponentPicker.tsx").then((module) => ({
		default: module.CircuitComponentPicker,
	})),
);

export type CircuitTool = "select" | "connect" | "pan" | "component" | "net";

export function CircuitToolbar({
	tool,
	onToolChange,
	canDelete,
	onDelete,
	canUndo,
	canRedo,
	zoomLevel,
	onZoom,
	onFit,
	onUntangle,
	ercOpen,
	onErc,
	onChooseComponent,
	onUndo,
	onRedo,
}: {
	tool: CircuitTool;
	onToolChange(tool: CircuitTool): void;
	canDelete: boolean;
	onDelete(): void;
	canUndo: boolean;
	canRedo: boolean;
	zoomLevel: number;
	onZoom(factor: number): void;
	onFit(): void;
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
			key={id}
			className={button}
			tooltip={label}
			aria-label={label}
			aria-pressed={tool === id}
			onClick={() => onToolChange(toggles && tool === id ? "select" : id)}
		>
			<Icon size={18} aria-hidden="true" />
		</TooltipButton>
	);
	return (
		<ToolbarDock label="Circuit tools">
			<TooltipButton
				className={button}
				tooltip="Undo"
				aria-label="Undo"
				data-shortcut-keeps-focus
				shortcut="Ctrl/Cmd + Z"
				disabled={!canUndo}
				onClick={onUndo}
			>
				<Undo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				className={button}
				tooltip="Redo"
				aria-label="Redo"
				data-shortcut-keeps-focus
				shortcut="Ctrl/Cmd + Shift + Z"
				disabled={!canRedo}
				onClick={onRedo}
			>
				<Redo2 size={17} aria-hidden="true" />
			</TooltipButton>
			<ToolbarSeparator />
			{toolButton("select", "Select", MousePointer2)}
			{toolButton("pan", "Pan", Hand)}
			<ToolbarSeparator />
			<Suspense
				fallback={
					<button
						type="button"
						className={button}
						aria-label="Components"
						disabled
					>
						<Microchip size={18} aria-hidden="true" />
					</button>
				}
			>
				<CircuitComponentPicker
					active={tool === "component"}
					onChoose={onChooseComponent}
				/>
			</Suspense>
			{toolButton("connect", "Connect pins", Cable, true)}
			{toolButton("net", "Add net", CirclePlus, true)}
			<ToolbarSeparator />
			<TooltipButton
				className={button}
				tooltip="Untangle"
				aria-label="Untangle"
				onClick={onUntangle}
			>
				<Shuffle size={18} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				className={button}
				tooltip="Delete selection"
				aria-label="Delete"
				shortcut="Delete"
				disabled={!canDelete}
				onClick={onDelete}
			>
				<Trash2 size={18} aria-hidden="true" />
			</TooltipButton>
			<ToolbarSeparator />
			<ErcButton open={ercOpen} onClick={onErc} />
			<ToolbarSeparator />
			<ZoomControls
				zoom={onZoom}
				fit={onFit}
				canZoomIn={zoomLevel < 10 - 1e-6}
				canZoomOut={zoomLevel > 0.1 + 1e-6}
				buttonClassName={button}
				fitClassName={`${button} min-w-14 tabular-nums`}
				fitLabel="Fit graph"
				fitTitle="Fit graph"
			>
				{Math.round(zoomLevel * 100)}%
			</ZoomControls>
			<EditorViewSwitch view="circuit" />
		</ToolbarDock>
	);
}
