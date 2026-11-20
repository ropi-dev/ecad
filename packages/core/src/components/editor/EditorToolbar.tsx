import { jumpHistoryEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { LengthUnit } from "@ecad/drawing-core/drawing/units.ts";
import type { JSX } from "@solidjs/web";
import {
	type ComponentProps,
	createEffect,
	createMemo,
	createSignal,
	For,
	omit,
	Show,
} from "solid-js";
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
	Pentagon,
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
} from "#/components/ui/icons.tsx";
import {
	ToolbarGroup,
	ToolbarGroupButton,
	ToolbarSeparator,
} from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { useViewExport } from "#/components/viewer/ViewControls3D.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type { DrawingZoneFill } from "#/drawing/export.ts";
import type { SelectionEdit } from "#/drawing/selection-edit.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import { fromExternalStore } from "#/lib/external-store.ts";

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
		kind: "zone-polygon",
		label: "Polygon copper zone",
		icon: Pentagon,
	},
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

const navigationTools = tools.filter(({ group }) => group === "navigation");
const rotations = [
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
];
const pressed = (on: boolean) => (on ? "true" : "false");

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
		toggle: (button: HTMLButtonElement) => void;
		unit: LengthUnit;
		onUnitChange: (unit: LengthUnit) => void;
	};
	symbolLibrary: ComponentProps<typeof SymbolPicker>["library"];
	finishDrag: (cancel?: boolean) => void;
	finishWire: () => void;
	setSymbolDefinition: (definition: SymbolDefinition) => void;
	setTool: (tool: Tool) => void;
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
	onErc?: (() => void) | undefined;
	settingsOpen: boolean;
	onSettings?: (() => void) | undefined;
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
		zoneFills: () => Promise<readonly DrawingZoneFill[]>;
		maskMargin?: number | undefined;
		copperLayers?: number | undefined;
	};
}

function Toggle(props: ComponentProps<typeof TooltipButton>) {
	return (
		<TooltipButton
			type="button"
			class={viewControlButtonClassName}
			{...props}
		/>
	);
}

export function EditorToolbar(props: EditorToolbarProps) {
	const [exportOpen, setExportOpen] = createSignal(false);
	const viewExport = useViewExport();
	const [footprintToggle, setFootprintToggle] =
		createSignal<HTMLButtonElement>();
	const registerFootprintToggle = createMemo(() => props.footprint?.toggle);
	createEffect(
		() => [footprintToggle(), registerFootprintToggle()] as const,
		([button, register]) => {
			if (button && register) register(button);
		},
	);
	const ready = () => props.ready;
	const chooseTool = (kind: ToolItem["kind"]) => {
		props.finishWire();
		props.clearPlacementPreview();
		props.setTool(kind);
	};
	const renderGroup = (
		group: ToolGroup,
		label: string,
		fallback: ToolItem["icon"],
	): JSX.Element => {
		const items = createMemo(() =>
			(props.footprint && !props.board ? footprintTools : tools).filter(
				(item) =>
					item.group === group &&
					!(props.sheetless && (item.kind === "net" || item.kind === "supply")),
			),
		);
		const current = createMemo(() =>
			items().find((item) => item.kind === props.tool),
		);
		return (
			<ToolbarGroup
				label={label}
				icon={current()?.icon ?? fallback}
				activeLabel={current()?.label}
				disabled={!ready()}
				active={!!current()}
			>
				<For each={items()}>
					{(item) => (
						<ToolbarGroupButton
							icon={item.icon}
							label={item.label}
							disabled={!ready()}
							aria-pressed={pressed(props.tool === item.kind)}
							onClick={() => chooseTool(item.kind)}
						/>
					)}
				</For>
			</ToolbarGroup>
		);
	};

	return (
		<fieldset aria-label="Drawing tools" class="contents">
			<HistoryControls
				history={props.history}
				disabled={!ready()}
				onUndo={() => props.undo()}
				onRedo={() => props.redo()}
				onRestore={(id) => props.restoreHistory(jumpHistoryEffect(id))}
			/>
			<ToolbarSeparator />
			<For each={navigationTools}>
				{(item) => (
					<Toggle
						disabled={!ready()}
						aria-label={item.label}
						tooltip={item.label}
						aria-pressed={pressed(props.tool === item.kind)}
						onClick={() => chooseTool(item.kind)}
					>
						<item.icon size={18} aria-hidden="true" />
					</Toggle>
				)}
			</For>
			<ToolbarSeparator />
			<Show
				when={props.board}
				fallback={
					<Show
						when={props.footprint}
						fallback={
							<>
								<SymbolPicker
									library={props.symbolLibrary}
									allowNetSymbols={!props.sheetless}
									disabled={!ready()}
									active={props.tool === "symbol"}
									onChoose={(definition) => {
										if (props.sheetless && definition.netSymbol) return;
										props.finishDrag();
										props.finishWire();
										props.setSymbolDefinition(definition);
										props.setTool("symbol");
									}}
								/>
								{renderGroup("connections", "Connections", Cable)}
							</>
						}
					>
						{renderGroup("pads", "Pads and vias", CircleDot)}
					</Show>
				}
			>
				{renderGroup("routing", "Routing", Spline)}
				<Toggle
					disabled={!ready()}
					aria-label="Update from schematic"
					tooltip="Update from schematic"
					onClick={() => props.board?.onSync()}
				>
					<RefreshCw size={18} aria-hidden="true" />
				</Toggle>
			</Show>
			{renderGroup("shapes", "Shapes", Shapes)}
			<ToolbarSeparator />
			<For each={rotations}>
				{(rotation) => (
					<Toggle
						disabled={
							!ready() || (!props.hasSelection && !props.canRotatePlacement)
						}
						aria-label={rotation.label}
						aria-keyshortcuts={rotation.shortcut}
						tooltip={`${rotation.label} 90°`}
						shortcut={rotation.shortcut}
						onClick={() => props.rotateItems(rotation.angle)}
					>
						<rotation.icon size={18} aria-hidden="true" />
					</Toggle>
				)}
			</For>
			<Show when={props.board}>
				{(board) => (
					<Toggle
						disabled={!ready() || !board().canFlip}
						aria-label="Flip to the other side"
						aria-keyshortcuts="F"
						tooltip="Flip to the other side"
						shortcut="F"
						onClick={() => props.board?.onFlip()}
					>
						<FlipHorizontal2 size={18} aria-hidden="true" />
					</Toggle>
				)}
			</Show>
			<Toggle
				disabled={
					!ready() || !props.hasSelection || (props.lockDisabled ?? false)
				}
				aria-label={
					props.selectionLocked ? "Unlock selection" : "Lock selection"
				}
				tooltip={
					props.lockDisabled
						? "Pins are fixed to their symbol"
						: props.selectionLocked
							? "Unlock selection"
							: "Lock selection"
				}
				onClick={() =>
					props.editSelection({ kind: "lock", locked: !props.selectionLocked })
				}
			>
				<Show
					when={props.selectionLocked}
					fallback={<Lock size={18} aria-hidden="true" />}
				>
					<LockOpen size={18} aria-hidden="true" />
				</Show>
			</Toggle>
			<Toggle
				disabled={!props.hasSelection}
				aria-label="Delete"
				tooltip="Delete selection"
				shortcut="Delete"
				onClick={() => props.removeSelected()}
			>
				<Trash2 size={18} aria-hidden="true" />
			</Toggle>
			<ToolbarSeparator />
			<Toggle
				disabled={!ready()}
				aria-label="Select locked items"
				aria-pressed={pressed(props.allowLocked)}
				tooltip="Select locked items"
				onClick={() => {
					props.finishDrag(true);
					props.session.setAllowLocked(!props.allowLocked);
				}}
			>
				<SquareDashedMousePointer size={18} aria-hidden="true" />
			</Toggle>
			<ToolbarSeparator />
			<Show when={props.onErc}>
				<ErcButton
					open={props.ercOpen}
					disabled={!ready()}
					onClick={() => props.onErc?.()}
				/>
			</Show>
			<Show when={props.onSettings}>
				<Toggle
					disabled={!ready()}
					aria-label="Schematic settings"
					aria-haspopup="dialog"
					aria-expanded={pressed(props.settingsOpen)}
					tooltip="Schematic settings"
					onClick={() => props.onSettings?.()}
				>
					<SlidersHorizontal size={18} aria-hidden="true" />
				</Toggle>
			</Show>
			<Show when={props.onErc || props.onSettings}>
				<ToolbarSeparator />
			</Show>
			<Show when={props.board}>
				{(board) => (
					<>
						<Toggle
							disabled={!ready()}
							aria-label="Design rules check"
							aria-pressed={pressed(board().checksOpen)}
							tooltip="Design rules check"
							onClick={() => props.board?.onChecks()}
						>
							<ShieldCheck size={18} aria-hidden="true" />
						</Toggle>
						<Toggle
							disabled={!ready()}
							aria-label="Board setup"
							aria-pressed={pressed(board().setupOpen)}
							tooltip="Board setup"
							onClick={() => props.board?.onSetup()}
						>
							<Settings2 size={18} aria-hidden="true" />
						</Toggle>
						<ToolbarSeparator />
					</>
				)}
			</Show>
			<Show when={props.footprint}>
				{(footprint) => (
					<>
						<Toggle
							ref={setFootprintToggle}
							class={`${viewControlButtonClassName} px-2.5`}
							aria-pressed={pressed(footprint().flat)}
							disabled={
								footprint().flat && (!ready() || !footprint().available)
							}
							tooltip={
								footprint().flat
									? "Show layers in 3D"
									: "Show the flat top view"
							}
							onClick={() => props.footprint?.onToggleFlat()}
						>
							2D
						</Toggle>
						<Toggle
							class={`${viewControlButtonClassName} w-11`}
							aria-label={`Units: ${footprint().unit}`}
							tooltip={
								footprint().unit === "mm"
									? "Show lengths in mils"
									: "Show lengths in millimetres"
							}
							onClick={() => {
								const current = props.footprint;
								current?.onUnitChange(current.unit === "mm" ? "mil" : "mm");
							}}
						>
							{footprint().unit}
						</Toggle>
						<ToolbarSeparator />
					</>
				)}
			</Show>
			<ToolbarGroup label="Export" icon={Download} disabled={!ready()}>
				<Show when={props.board}>
					{(board) => (
						<ToolbarGroupButton
							icon={FileArchive}
							label="Export Gerber and drill files"
							disabled={board().exporting}
							aria-busy={pressed(board().exporting)}
							onClick={() => props.board?.onExport()}
						/>
					)}
				</Show>
				<ToolbarGroupButton
					icon={FileImage}
					label="Export drawing"
					onClick={() => setExportOpen(true)}
				/>
				<Show when={viewExport.exportPng}>
					<ToolbarGroupButton
						icon={ImageDown}
						label="Export PNG"
						disabled={!viewExport.enabled || viewExport.exporting}
						aria-busy={pressed(viewExport.exporting)}
						onClick={() => viewExport.exportPng?.()}
					/>
				</Show>
			</ToolbarGroup>
			<LiveDrawingExport
				session={props.session}
				shapes={props.shapes}
				sheet={props.sheet}
				label={props.drawingName || "Schematic drawing"}
				layered={props.footprint !== undefined}
				zoneFills={props.board?.zoneFills}
				maskMargin={props.board?.maskMargin}
				copperLayers={props.board?.copperLayers}
				open={exportOpen()}
				onClose={() => setExportOpen(false)}
			/>
		</fieldset>
	);
}

function LiveDrawingExport(
	props: ComponentProps<typeof DrawingExport> & {
		session: ReturnType<typeof createEditorSession>;
	},
) {
	const draftStore = createMemo(() => {
		const session = props.session;
		return fromExternalStore(
			(listener) => session.subscribe(listener),
			() => session.getState().draft,
		);
	});
	const rest = omit(props, "session", "shapes");
	return <DrawingExport {...rest} shapes={draftStore()() ?? props.shapes} />;
}
