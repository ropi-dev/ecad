import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Cable,
	CirclePlus,
	Hand,
	History,
	MousePointer2,
	Redo2,
	Scan,
	ShieldCheck,
	Shuffle,
	Trash2,
	Undo2,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import {
	ToolbarGroup,
	ToolbarGroups,
} from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { ZoomControls } from "#/components/viewer/ZoomControls.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";

const CircuitComponentPicker = lazy(() =>
	import("./CircuitComponentPicker.tsx").then((module) => ({
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
	onPan,
	onUntangle,
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
	onPan(x: number, y: number): void;
	onUntangle(): void;
	onErc(): void;
	onChooseComponent(definition: SymbolDefinition): void;
	onUndo(): void;
	onRedo(): void;
}) {
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const button = viewControlButtonClassName;
	return (
		<ToolbarGroups panelHost={host}>
			<div
				ref={setHost}
				role="toolbar"
				aria-label="Circuit tools"
				className="circuit-dock absolute bottom-4 left-1/2 z-10 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-lg border border-white/20 bg-slate-900/95 p-1 shadow-lg"
			>
				<div className="flex touch-pan-x flex-nowrap gap-0.5 overflow-x-auto overscroll-x-contain sm:gap-1 [scrollbar-width:thin] [&_button]:shrink-0">
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
					<TooltipButton
						className={button}
						tooltip="Untangle"
						aria-label="Untangle"
						onClick={onUntangle}
					>
						<Shuffle size={18} />
					</TooltipButton>
					<ToolbarGroup label="View tools" icon={Scan}>
						{[
							{ label: "Pan left", icon: ArrowLeft, x: -0.2, y: 0 },
							{ label: "Pan right", icon: ArrowRight, x: 0.2, y: 0 },
							{ label: "Pan up", icon: ArrowUp, x: 0, y: -0.2 },
							{ label: "Pan down", icon: ArrowDown, x: 0, y: 0.2 },
						].map(({ label, icon: Icon, x, y }) => (
							<TooltipButton
								key={label}
								className={button}
								tooltip={label}
								aria-label={label}
								onClick={() => onPan(x, y)}
							>
								<Icon size={18} />
							</TooltipButton>
						))}
					</ToolbarGroup>
					{(
						[
							{ id: "select", label: "Select", icon: MousePointer2 },
							{ id: "pan", label: "Pan", icon: Hand },
						] as const
					).map(({ id, label, icon: Icon }) => (
						<TooltipButton
							key={id}
							className={`${button} data-[active=true]:border-[#b88f61] data-[active=true]:bg-[#e8b77e12] data-[active=true]:text-[#e8b77e]`}
							tooltip={label}
							aria-label={label}
							aria-pressed={tool === id}
							data-active={tool === id}
							onClick={() => onToolChange(id)}
						>
							<Icon size={18} />
						</TooltipButton>
					))}
					<Suspense
						fallback={
							<button
								type="button"
								className={button}
								aria-label="Components"
								disabled
							>
								<span aria-hidden="true">…</span>
							</button>
						}
					>
						<CircuitComponentPicker
							active={tool === "component"}
							onChoose={onChooseComponent}
						/>
					</Suspense>
					<TooltipButton
						className={`${button} data-[active=true]:border-[#b88f61] data-[active=true]:bg-[#e8b77e12] data-[active=true]:text-[#e8b77e]`}
						tooltip="Connect pins"
						aria-label="Connect pins"
						aria-pressed={tool === "connect"}
						data-active={tool === "connect"}
						onClick={() =>
							onToolChange(tool === "connect" ? "select" : "connect")
						}
					>
						<Cable size={18} />
					</TooltipButton>
					<TooltipButton
						className={`${button} data-[active=true]:text-[#e8b77e]`}
						tooltip="Add net"
						aria-label="Add net"
						aria-pressed={tool === "net"}
						data-active={tool === "net"}
						onClick={() => onToolChange(tool === "net" ? "select" : "net")}
					>
						<CirclePlus size={18} />
					</TooltipButton>
					<ToolbarGroup label="History tools" icon={History}>
						<TooltipButton
							className={button}
							tooltip="Undo"
							aria-label="Undo"
							shortcut="Ctrl Z"
							disabled={!canUndo}
							onClick={onUndo}
						>
							<Undo2 size={18} />
						</TooltipButton>
						<TooltipButton
							className={button}
							tooltip="Redo"
							aria-label="Redo"
							shortcut="Ctrl Shift Z"
							disabled={!canRedo}
							onClick={onRedo}
						>
							<Redo2 size={18} />
						</TooltipButton>
					</ToolbarGroup>
					<TooltipButton
						className={button}
						tooltip="Delete selection"
						aria-label="Delete selection"
						shortcut="Del"
						disabled={!canDelete}
						onClick={onDelete}
					>
						<Trash2 size={18} />
					</TooltipButton>
					<TooltipButton
						className={button}
						tooltip="Electrical rules check"
						aria-label="Electrical rules check"
						onClick={onErc}
					>
						<ShieldCheck size={18} />
					</TooltipButton>
					<EditorViewSwitch view="circuit" />
				</div>
			</div>
		</ToolbarGroups>
	);
}
