import { jumpHistoryEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { formatMils } from "@ecad/drawing-core/drawing/units.ts";
import {
	Cable,
	Circle,
	Hand,
	History as HistoryIcon,
	Lock,
	LockKeyhole,
	Magnet,
	MapPin,
	Minus,
	MousePointer2,
	RotateCcw,
	RotateCw,
	Shapes,
	Square,
	Trash2,
	Triangle,
	Type,
	Unlock,
	X,
} from "lucide-react";
import {
	type ComponentProps,
	type Dispatch,
	memo,
	type ReactNode,
	type SetStateAction,
	useSyncExternalStore,
} from "react";
import { DrawingExport } from "#/components/editor/DrawingExport.tsx";
import type {
	createEditorSession,
	DrawingCommand,
} from "#/components/editor/editorSession.ts";
import { HistoryControls } from "#/components/editor/HistoryControls.tsx";
import { SymbolPicker } from "#/components/editor/SymbolPicker.tsx";
import type {
	CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { ToolbarGroup } from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/ViewControls3D.tsx";
import type { SelectionEdit } from "#/drawing/selection-edit.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";

const tools = [
	{ group: "navigation", kind: "select", label: "Select", icon: MousePointer2 },
	{ group: "navigation", kind: "pan", label: "Pan", icon: Hand },
	{ group: "shapes", kind: "rectangle", label: "Rectangle", icon: Square },
	{ group: "shapes", kind: "circle", label: "Circle", icon: Circle },
	{ group: "shapes", kind: "triangle", label: "Triangle", icon: Triangle },
	{ group: "shapes", kind: "line", label: "Line", icon: Minus },
	{ group: "connections", kind: "wire", label: "Wire", icon: Cable },
	{ group: "connections", kind: "pin", label: "Pin", icon: MapPin },
	{ group: "connections", kind: "no-connect", label: "No connect", icon: X },
	{ group: "connections", kind: "net", label: "Net label", icon: Type },
	{ group: "connections", kind: "supply", label: "Supply label", icon: Type },
	{ group: "shapes", kind: "text", label: "Text", icon: Type },
] as const;
interface EditorToolbarProps {
	shapes: EditorShape[];
	sheet: SheetSize;
	drawingName?: string;
	ready: boolean;
	history: ReturnType<
		ReturnType<typeof createDrawingStore>["getSnapshot"]
	>["history"];
	undo: () => void;
	redo: () => void;
	restoreHistory: (program: DrawingCommand<unknown>) => void;
	tool: Tool;
	isSymbol: boolean;
	symbolLibrary: ComponentProps<typeof SymbolPicker>["library"];
	finishDrag: (cancel?: boolean) => void;
	finishWire: () => void;
	setSymbolDefinition: Dispatch<SetStateAction<SymbolDefinition | null>>;
	setTool: Dispatch<SetStateAction<Tool>>;
	clearPlacementPreview: ReturnType<
		typeof useCanvasGestures
	>["clearPlacementPreview"];
	canRotatePlacement: boolean;
	snapEnabled: boolean;
	setSnapEnabled: Dispatch<SetStateAction<boolean>>;
	gridStep: number;
	allowLocked: boolean;
	session: ReturnType<typeof createEditorSession>;
	hasSelection: boolean;
	rotateItems: (angle: number) => void;
	selectionLocked: boolean;
	editSelection: (edit: SelectionEdit) => void;
	removeSelected: () => void;
	viewSwitch?: ReactNode;
}

export const EditorToolbar = memo(function EditorToolbar({
	shapes,
	sheet,
	drawingName,
	ready,
	history,
	undo,
	redo,
	restoreHistory,
	tool,
	isSymbol,
	symbolLibrary,
	finishDrag,
	finishWire,
	setSymbolDefinition,
	setTool,
	clearPlacementPreview,
	canRotatePlacement,
	snapEnabled,
	setSnapEnabled,
	gridStep,
	allowLocked,
	session,
	hasSelection,
	rotateItems,
	selectionLocked,
	editSelection,
	removeSelected,
	viewSwitch,
}: EditorToolbarProps) {
	const renderTool = ({ kind, label, icon: Icon }: (typeof tools)[number]) => (
		<TooltipButton
			key={kind}
			type="button"
			className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
			disabled={!ready}
			aria-label={label}
			tooltip={label}
			aria-pressed={tool === kind}
			onClick={() => {
				finishWire();
				clearPlacementPreview();
				setTool(kind);
			}}
		>
			<Icon size={18} aria-hidden="true" />
		</TooltipButton>
	);

	return (
		<fieldset aria-label="Drawing tools" className="contents">
			<LiveDrawingExport
				session={session}
				shapes={shapes}
				sheet={sheet}
				label={drawingName || "Schematic drawing"}
				disabled={!ready}
			/>
			<ToolbarGroup label="History tools" icon={HistoryIcon} disabled={!ready}>
				<HistoryControls
					history={history}
					disabled={!ready}
					onUndo={undo}
					onRedo={redo}
					onRestore={(id) => restoreHistory(jumpHistoryEffect(id))}
				/>
			</ToolbarGroup>
			{tools.filter(({ group }) => group === "navigation").map(renderTool)}
			<ToolbarGroup
				label="Shapes"
				icon={Shapes}
				disabled={!ready}
				active={tools.some(
					(item) => item.group === "shapes" && item.kind === tool,
				)}
			>
				{tools.filter(({ group }) => group === "shapes").map(renderTool)}
			</ToolbarGroup>
			<ToolbarGroup
				label="Connections"
				icon={Cable}
				disabled={!ready}
				active={tools.some(
					(item) => item.group === "connections" && item.kind === tool,
				)}
			>
				{tools
					.filter(
						({ kind, group }) =>
							group === "connections" &&
							(!isSymbol || (kind !== "net" && kind !== "supply")),
					)
					.map(renderTool)}
			</ToolbarGroup>
			<SymbolPicker
				library={symbolLibrary}
				allowNetSymbols={!isSymbol}
				disabled={!ready}
				active={tool === "symbol"}
				onChoose={(definition) => {
					if (isSymbol && definition.netSymbol) return;
					finishDrag();
					finishWire();
					setSymbolDefinition(definition);
					setTool("symbol");
				}}
			/>
			<TooltipButton
				type="button"
				className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
				disabled={!ready}
				aria-label="Snap to grid"
				aria-pressed={snapEnabled}
				tooltip={`Snap to grid, ${formatMils(gridStep)}`}
				onClick={() => setSnapEnabled((enabled) => !enabled)}
			>
				<Magnet size={18} aria-hidden="true" />
			</TooltipButton>
			<TooltipButton
				type="button"
				aria-label="Select locked items"
				aria-pressed={allowLocked}
				tooltip="Select locked items"
				disabled={!ready}
				className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:bg-[#e8b77e12] aria-pressed:text-[#e8b77e]`}
				onClick={() => {
					finishDrag(true);
					session.setAllowLocked(!allowLocked);
				}}
			>
				<LockKeyhole size={18} aria-hidden="true" />
			</TooltipButton>

			{[
				{
					label: "Rotate counterclockwise",
					shortcut: "R",
					angle: Math.PI / 2,
					icon: RotateCcw,
				},
				{
					label: "Rotate clockwise",
					shortcut: "Shift+R",
					angle: -Math.PI / 2,
					icon: RotateCw,
				},
			].map(({ label, shortcut, angle, icon: Icon }) => (
				<TooltipButton
					key={label}
					type="button"
					className={viewControlButtonClassName}
					disabled={!ready || (!hasSelection && !canRotatePlacement)}
					aria-label={label}
					aria-keyshortcuts={shortcut}
					tooltip={`${label} 90°`}
					shortcut={shortcut}
					onClick={() => rotateItems(angle)}
				>
					<Icon size={18} aria-hidden="true" />
				</TooltipButton>
			))}
			<TooltipButton
				type="button"
				className={viewControlButtonClassName}
				disabled={!ready || !hasSelection}
				aria-label={selectionLocked ? "Unlock selection" : "Lock selection"}
				tooltip={selectionLocked ? "Unlock selection" : "Lock selection"}
				onClick={() =>
					editSelection({ kind: "lock", locked: !selectionLocked })
				}
			>
				{selectionLocked ? (
					<Unlock size={18} aria-hidden="true" />
				) : (
					<Lock size={18} aria-hidden="true" />
				)}
			</TooltipButton>

			<TooltipButton
				type="button"
				className={viewControlButtonClassName}
				disabled={!hasSelection}
				aria-label="Delete"
				tooltip="Delete selected shapes"
				shortcut="Delete"
				onClick={removeSelected}
			>
				<Trash2 size={18} aria-hidden="true" />
			</TooltipButton>
			{viewSwitch}
		</fieldset>
	);
});

function LiveDrawingExport({
	session,
	shapes,
	...props
}: ComponentProps<typeof DrawingExport> & {
	session: ReturnType<typeof createEditorSession>;
}) {
	const draft = useSyncExternalStore(
		session.subscribe,
		() => session.getState().draft,
		() => session.getState().draft,
	);
	return <DrawingExport {...props} shapes={draft ?? shapes} />;
}
