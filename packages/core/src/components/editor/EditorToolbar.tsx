import { jumpHistoryEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	Cable,
	Circle,
	CircleDashed,
	CircleDot,
	CircleSmall,
	Download,
	FileArchive,
	FileImage,
	FlipHorizontal2,
	Hand,
	ImageDown,
	Lock,
	LockOpen,
	MapPin,
	Minus,
	MousePointer2,
	RectangleVertical,
	RefreshCw,
	RotateCcw,
	RotateCw,
	Settings2,
	Shapes,
	ShieldCheck,
	SlidersHorizontal,
	Spline,
	Square,
	SquareDashed,
	SquareDashedBottom,
	SquareDashedMousePointer,
	Tag,
	Trash2,
	Triangle,
	Type,
	X,
	Zap,
} from "lucide-react";
import {
	type ComponentProps,
	type Dispatch,
	memo,
	type Ref,
	type SetStateAction,
	useState,
	useSyncExternalStore,
} from "react";
import { DrawingExport } from "#/components/editor/DrawingExport.tsx";
import { ErcButton } from "#/components/editor/ErcButton.tsx";
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
import {
	ToolbarGroup,
	ToolbarGroupButton,
	ToolbarSeparator,
} from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { useViewExport } from "#/components/viewer/ViewControls3D.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
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
	{ group: "shapes", kind: "text", label: "Text", icon: Type },
	{ group: "connections", kind: "wire", label: "Wire", icon: Cable },
	{ group: "connections", kind: "pin", label: "Pin", icon: MapPin },
	{ group: "connections", kind: "no-connect", label: "No connect", icon: X },
	{ group: "connections", kind: "net", label: "Net label", icon: Tag },
	{ group: "connections", kind: "supply", label: "Supply label", icon: Zap },
	{
		group: "pads",
		kind: "smd-pad",
		label: "Surface mount pad",
		icon: RectangleVertical,
	},
	{
		group: "pads",
		kind: "through-hole-pad",
		label: "Through-hole pad",
		icon: CircleDot,
	},
	{ group: "pads", kind: "via", label: "Via", icon: CircleSmall },
	{ group: "pads", kind: "hole", label: "Unplated hole", icon: CircleDashed },
	{ group: "routing", kind: "track", label: "Track", icon: Spline },
	{ group: "routing", kind: "via", label: "Via", icon: CircleSmall },
	{
		group: "routing",
		kind: "hole",
		label: "Unplated hole",
		icon: CircleDashed,
	},
	{ group: "routing", kind: "zone", label: "Copper zone", icon: SquareDashed },
	{
		group: "routing",
		kind: "outline",
		label: "Board outline",
		icon: SquareDashedBottom,
	},
] as const;
const footprintTools = tools.map((item) =>
	item.kind === "line" ? { ...item, label: "Wire", icon: Cable } : item,
);
type ToolItem = (typeof tools)[number];
type ToolGroup = "shapes" | "connections" | "pads" | "routing";

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
	sheetless: boolean;
	footprint?: {
		flat: boolean;
		available: boolean;
		onToggleFlat: () => void;
		toggle: Ref<HTMLButtonElement>;
	};
	symbolLibrary: ComponentProps<typeof SymbolPicker>["library"];
	finishDrag: (cancel?: boolean) => void;
	finishWire: () => void;
	setSymbolDefinition: Dispatch<SetStateAction<SymbolDefinition | null>>;
	setTool: Dispatch<SetStateAction<Tool>>;
	clearPlacementPreview: ReturnType<
		typeof useCanvasGestures
	>["clearPlacementPreview"];
	canRotatePlacement: boolean;
	allowLocked: boolean;
	session: ReturnType<typeof createEditorSession>;
	hasSelection: boolean;
	rotateItems: (angle: number) => void;
	selectionLocked: boolean;
	/** The selected item is fixed to its symbol, such as a pin. */
	lockDisabled?: boolean;
	editSelection: (edit: SelectionEdit) => void;
	removeSelected: () => void;
	ercOpen: boolean;
	/** Toggles the electrical rules check. Symbol drawings have none. */
	onErc?: () => void;
	settingsOpen: boolean;
	onSettings?: () => void;
	board?: {
		onSync: () => void;
		checksOpen: boolean;
		onChecks: () => void;
		setupOpen: boolean;
		onSetup: () => void;
		canFlip: boolean;
		onFlip: () => void;
		onExport: () => void;
		exporting: boolean;
	};
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
	sheetless,
	footprint,
	symbolLibrary,
	finishDrag,
	finishWire,
	setSymbolDefinition,
	setTool,
	clearPlacementPreview,
	canRotatePlacement,
	allowLocked,
	session,
	hasSelection,
	rotateItems,
	selectionLocked,
	lockDisabled = false,
	editSelection,
	removeSelected,
	ercOpen,
	onErc,
	settingsOpen,
	onSettings,
	board,
}: EditorToolbarProps) {
	const [exportOpen, setExportOpen] = useState(false);
	const viewExport = useViewExport();
	const chooseTool = (kind: ToolItem["kind"]) => {
		finishWire();
		clearPlacementPreview();
		setTool(kind);
	};
	const toolGroup = (group: ToolGroup) =>
		(footprint && !board ? footprintTools : tools).filter(
			(item) =>
				item.group === group &&
				!(sheetless && (item.kind === "net" || item.kind === "supply")),
		);
	const renderGroup = (
		group: ToolGroup,
		label: string,
		fallback: ToolItem["icon"],
	) => {
		const items = toolGroup(group);
		const current = items.find((item) => item.kind === tool);
		return (
			<ToolbarGroup
				label={label}
				icon={current?.icon ?? fallback}
				activeLabel={current?.label}
				disabled={!ready}
				active={!!current}
			>
				{items.map(({ kind, label, icon }) => (
					<ToolbarGroupButton
						key={kind}
						icon={icon}
						label={label}
						disabled={!ready}
						aria-pressed={tool === kind}
						onClick={() => chooseTool(kind)}
					/>
				))}
			</ToolbarGroup>
		);
	};
	const toggle = (
		props: ComponentProps<typeof TooltipButton>,
		key?: string,
	) => (
		<TooltipButton
			key={key}
			type="button"
			className={viewControlButtonClassName}
			{...props}
		/>
	);

	return (
		<fieldset aria-label="Drawing tools" className="contents">
			<HistoryControls
				history={history}
				disabled={!ready}
				onUndo={undo}
				onRedo={redo}
				onRestore={(id) => restoreHistory(jumpHistoryEffect(id))}
			/>
			<ToolbarSeparator />
			{tools
				.filter(({ group }) => group === "navigation")
				.map(({ kind, label, icon: Icon }) =>
					toggle(
						{
							disabled: !ready,
							"aria-label": label,
							tooltip: label,
							"aria-pressed": tool === kind,
							onClick: () => chooseTool(kind),
							children: <Icon size={18} aria-hidden="true" />,
						},
						kind,
					),
				)}
			<ToolbarSeparator />
			{board ? (
				<>
					{renderGroup("routing", "Routing", Spline)}
					{toggle({
						disabled: !ready,
						"aria-label": "Update from schematic",
						tooltip: "Update from schematic",
						onClick: board.onSync,
						children: <RefreshCw size={18} aria-hidden="true" />,
					})}
				</>
			) : footprint ? (
				renderGroup("pads", "Pads and vias", CircleDot)
			) : (
				<>
					<SymbolPicker
						library={symbolLibrary}
						allowNetSymbols={!sheetless}
						disabled={!ready}
						active={tool === "symbol"}
						onChoose={(definition) => {
							if (sheetless && definition.netSymbol) return;
							finishDrag();
							finishWire();
							setSymbolDefinition(definition);
							setTool("symbol");
						}}
					/>
					{renderGroup("connections", "Connections", Cable)}
				</>
			)}
			{renderGroup("shapes", "Shapes", Shapes)}
			<ToolbarSeparator />
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
			].map(({ label, shortcut, angle, icon: Icon }) =>
				toggle(
					{
						disabled: !ready || (!hasSelection && !canRotatePlacement),
						"aria-label": label,
						"aria-keyshortcuts": shortcut,
						tooltip: `${label} 90°`,
						shortcut,
						onClick: () => rotateItems(angle),
						children: <Icon size={18} aria-hidden="true" />,
					},
					label,
				),
			)}
			{board &&
				toggle({
					disabled: !ready || !board.canFlip,
					"aria-label": "Flip to the other side",
					"aria-keyshortcuts": "F",
					tooltip: "Flip to the other side",
					shortcut: "F",
					onClick: board.onFlip,
					children: <FlipHorizontal2 size={18} aria-hidden="true" />,
				})}
			{toggle({
				disabled: !ready || !hasSelection || lockDisabled,
				"aria-label": selectionLocked ? "Unlock selection" : "Lock selection",
				tooltip: lockDisabled
					? "Pins are fixed to their symbol"
					: selectionLocked
						? "Unlock selection"
						: "Lock selection",
				onClick: () =>
					editSelection({ kind: "lock", locked: !selectionLocked }),
				children: selectionLocked ? (
					<LockOpen size={18} aria-hidden="true" />
				) : (
					<Lock size={18} aria-hidden="true" />
				),
			})}
			{toggle({
				disabled: !hasSelection,
				"aria-label": "Delete",
				tooltip: "Delete selection",
				shortcut: "Delete",
				onClick: removeSelected,
				children: <Trash2 size={18} aria-hidden="true" />,
			})}
			<ToolbarSeparator />
			{toggle({
				disabled: !ready,
				"aria-label": "Select locked items",
				"aria-pressed": allowLocked,
				tooltip: "Select locked items",
				onClick: () => {
					finishDrag(true);
					session.setAllowLocked(!allowLocked);
				},
				children: <SquareDashedMousePointer size={18} aria-hidden="true" />,
			})}
			<ToolbarSeparator />
			{onErc && <ErcButton open={ercOpen} disabled={!ready} onClick={onErc} />}
			{onSettings &&
				toggle({
					disabled: !ready,
					"aria-label": "Schematic settings",
					"aria-haspopup": "dialog",
					"aria-expanded": settingsOpen,
					tooltip: "Schematic settings",
					onClick: onSettings,
					children: <SlidersHorizontal size={18} aria-hidden="true" />,
				})}
			{(onErc || onSettings) && <ToolbarSeparator />}
			{board && (
				<>
					{toggle({
						disabled: !ready,
						"aria-label": "Design rules check",
						"aria-pressed": board.checksOpen,
						tooltip: "Design rules check",
						onClick: board.onChecks,
						children: <ShieldCheck size={18} aria-hidden="true" />,
					})}
					{toggle({
						disabled: !ready,
						"aria-label": "Board setup",
						"aria-pressed": board.setupOpen,
						tooltip: "Board setup",
						onClick: board.onSetup,
						children: <Settings2 size={18} aria-hidden="true" />,
					})}
					<ToolbarSeparator />
				</>
			)}
			{footprint && (
				<>
					{toggle({
						ref: footprint.toggle,
						className: `${viewControlButtonClassName} px-2.5`,
						"aria-pressed": footprint.flat,
						disabled: footprint.flat && (!ready || !footprint.available),
						tooltip: footprint.flat
							? "Show layers in 3D"
							: "Show the flat top view",
						onClick: footprint.onToggleFlat,
						children: "2D",
					})}
					<ToolbarSeparator />
				</>
			)}
			<ToolbarGroup label="Export" icon={Download} disabled={!ready}>
				{board && (
					<ToolbarGroupButton
						icon={FileArchive}
						label="Export Gerber and drill files"
						disabled={board.exporting}
						aria-busy={board.exporting}
						onClick={board.onExport}
					/>
				)}
				<ToolbarGroupButton
					icon={FileImage}
					label="Export drawing"
					onClick={() => setExportOpen(true)}
				/>
				{viewExport.exportPng && (
					<ToolbarGroupButton
						icon={ImageDown}
						label="Export PNG"
						disabled={!viewExport.enabled || viewExport.exporting}
						aria-busy={viewExport.exporting}
						onClick={viewExport.exportPng}
					/>
				)}
			</ToolbarGroup>
			<LiveDrawingExport
				session={session}
				shapes={shapes}
				sheet={sheet}
				label={drawingName || "Schematic drawing"}
				open={exportOpen}
				onClose={() => setExportOpen(false)}
			/>
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
