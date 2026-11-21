import { Dynamic } from "@solidjs/web";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import {
	ChevronRight,
	CircuitBoard,
	Columns2,
	Columns3,
	Grid2x2,
	LayoutPanelLeft,
	type LucideIcon,
	Maximize2,
	Rows2,
	Workflow,
	X,
} from "#/components/ui/icons.tsx";
import { TooltipProvider } from "#/components/ui/primitives.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";
import { projectFileSelections } from "#/projects/file-url.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import type { EditorView } from "#/projects/ProjectSession.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import {
	useWorkspaceControls,
	useWorkspaceRegistration,
} from "#/projects/WorkspaceControls.tsx";

export type SplitLayout = "columns" | "grid";

const viewMeta: Record<EditorView, { label: string; icon: LucideIcon }> = {
	schematic: { label: "Schematic", icon: CircuitBoard },
	circuit: { label: "Circuit", icon: Workflow },
	pcb: { label: "PCB", icon: Grid2x2 },
};

/**
 * Shared top bar shown across the workspace when two or three views of a
 * circuit are open in split screen.
 */
export function SplitWorkspaceBar(props: {
	focusedView: EditorView;
	views: readonly EditorView[];
	layout: SplitLayout;
	onLayoutChange: (layout: SplitLayout) => void;
	selection?: string;
	title?: string;
}) {
	const project = useProjectSelection(({ project }) => ({ project }));
	const controls = useWorkspaceControls();
	const registerDocument = useWorkspaceRegistration()?.registerDocument;
	const snapshot = () => project()?.project;
	const path = createMemo(() => {
		const current = snapshot();
		const selection = props.selection;
		return current && selection
			? projectFileSelections(current).find((entry) => entry.id === selection)
					?.path
			: undefined;
	});
	createEffect(
		() => ({
			path: path(),
			view: props.focusedView === "schematic" ? undefined : props.focusedView,
		}),
		({ path, view }) => registerDocument?.({ path, view }),
	);
	const name = () =>
		props.title ??
		(props.selection === "drawing"
			? (snapshot()?.circuits?.find((file) => file.circuit.id === primaryPcbId)
					?.circuit.name ?? "Drawing")
			: undefined);
	const projectName = () => snapshot()?.manifest.name;
	const docked = () => controls?.sidebarDocked ?? false;
	return (
		<TooltipProvider delayDuration={350} skipDelayDuration={150}>
			<header
				data-docked={docked() ? "true" : "false"}
				class={[
					"flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-3",
					{
						"pl-[calc(var(--chrome-gap)+var(--chrome-control)+6px)]": !docked(),
					},
				]}
			>
				<h1 class="sr-only">{name() ?? projectName()} · Split view</h1>
				<div class="flex min-w-0 items-center gap-2.5">
					<p class="m-0 flex min-w-0 items-center gap-1.5">
						<Show when={name() && projectName() && name() !== projectName()}>
							<span class="hidden max-w-40 min-w-0 truncate text-xs text-fg-faint min-[900px]:inline">
								{projectName()}
							</span>
							<ChevronRight
								size={12}
								aria-hidden="true"
								class="hidden shrink-0 text-fg-disabled min-[900px]:inline"
							/>
						</Show>
						<span class="max-w-40 min-w-0 truncate text-sm font-semibold text-fg min-[1100px]:max-w-64">
							{name() ?? projectName()}
						</span>
					</p>
					<EditorViewSwitch view={props.focusedView} />
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would disable both buttons together */}
				<div
					role="group"
					aria-label="Split layout"
					class="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-line-subtle bg-field p-0.5"
				>
					<TooltipButton
						aria-label="Columns layout"
						tooltip="Columns layout"
						side="bottom"
						aria-pressed={props.layout === "columns" ? "true" : "false"}
						class="ui-toggle flex h-full w-8 cursor-pointer items-center justify-center rounded-sm [--toggle-on-bg:var(--color-pressed)] [--toggle-on-fg:var(--color-fg)] hover:[--toggle-bg:transparent] focus-visible:outline-2 focus-visible:outline-accent aria-pressed:cursor-default"
						onClick={() => props.onLayoutChange("columns")}
					>
						<Dynamic
							component={props.views.length === 2 ? Columns2 : Columns3}
							size={15}
							aria-hidden="true"
						/>
					</TooltipButton>
					<TooltipButton
						aria-label="Stacked layout"
						tooltip={
							props.views.length === 2 ? "Stacked layout" : "Grid layout"
						}
						side="bottom"
						aria-pressed={props.layout === "grid" ? "true" : "false"}
						class="ui-toggle flex h-full w-8 cursor-pointer items-center justify-center rounded-sm [--toggle-on-bg:var(--color-pressed)] [--toggle-on-fg:var(--color-fg)] hover:[--toggle-bg:transparent] focus-visible:outline-2 focus-visible:outline-accent aria-pressed:cursor-default"
						onClick={() => props.onLayoutChange("grid")}
					>
						<Dynamic
							component={props.views.length === 2 ? Rows2 : LayoutPanelLeft}
							size={15}
							aria-hidden="true"
						/>
					</TooltipButton>
				</div>
			</header>
		</TooltipProvider>
	);
}

/** Compact header strip at the top of each pane inside split view. */
export function SplitPaneHeader(props: {
	view: EditorView;
	focused: boolean;
	onMaximize: () => void;
	onClose: () => void;
}) {
	const meta = () => viewMeta[props.view];
	return (
		<TooltipProvider delayDuration={350} skipDelayDuration={150}>
			<div
				class={[
					"flex h-8 shrink-0 items-center justify-between gap-2 border-t-2 border-b border-b-line-subtle bg-panel px-2.5 select-none",
					props.focused ? "border-t-accent" : "border-t-transparent",
				]}
			>
				<div class="flex min-w-0 items-center gap-1.5">
					<Dynamic
						component={meta().icon}
						size={14}
						aria-hidden="true"
						class={[
							"shrink-0",
							props.focused ? "text-accent" : "text-fg-faint",
						]}
					/>
					<span
						class={[
							"truncate text-xs font-medium",
							props.focused ? "text-fg" : "text-fg-muted",
						]}
					>
						{meta().label}
					</span>
				</div>
				<div class="flex shrink-0 items-center gap-0.5">
					<TooltipButton
						aria-label={`Maximize ${meta().label} view`}
						tooltip={`Show only ${meta().label} view`}
						side="bottom"
						class="grid size-6 cursor-pointer place-items-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
						onClick={(event) => {
							event.stopPropagation();
							props.onMaximize();
						}}
					>
						<Maximize2 size={13} aria-hidden="true" />
					</TooltipButton>
					<TooltipButton
						aria-label={`Close ${meta().label} view`}
						tooltip={`Close ${meta().label} view`}
						side="bottom"
						class="grid size-6 cursor-pointer place-items-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
						onClick={(event) => {
							event.stopPropagation();
							props.onClose();
						}}
					>
						<X size={13} aria-hidden="true" />
					</TooltipButton>
				</div>
			</div>
		</TooltipProvider>
	);
}

/** Draggable 1px divider track placed between split panes in the CSS grid. */
export function SplitDivider(props: {
	orientation: "vertical" | "horizontal";
	value: number;
	column?: string;
	row?: string;
	onResize: (deltaPx: number) => void;
	onStep: (deltaFraction: number) => void;
	onReset: () => void;
}) {
	const [dragging, setDragging] = createSignal(false);
	let lastPosition = 0;
	const positionOf = (event: PointerEvent) =>
		props.orientation === "vertical" ? event.clientX : event.clientY;
	return (
		// biome-ignore lint/a11y/useSemanticElements: interactive split resizer needs role="separator" and tabindex
		// biome-ignore lint/a11y/useFocusableInteractive: Solid JSX uses lowercase tabindex
		<div
			role="separator"
			aria-orientation={props.orientation}
			aria-label="Resize split panes"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(props.value * 100)}
			tabindex={0}
			style={{
				"grid-column": props.column,
				"grid-row": props.row,
			}}
			class={[
				"group relative z-20 select-none focus-visible:outline-none",
				props.orientation === "vertical" ? "h-full w-px" : "h-px w-full",
				dragging()
					? "bg-accent"
					: "bg-line hover:bg-accent focus-visible:bg-accent",
			]}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				lastPosition = positionOf(event);
				setDragging(true);
			}}
			onPointerMove={(event) => {
				if (!dragging()) return;
				const next = positionOf(event);
				const delta = next - lastPosition;
				if (delta !== 0) {
					lastPosition = next;
					props.onResize(delta);
				}
			}}
			onPointerUp={() => setDragging(false)}
			onPointerCancel={() => setDragging(false)}
			onLostPointerCapture={() => setDragging(false)}
			onDblClick={() => props.onReset()}
			onKeyDown={(event) => {
				if (event.key === "Home") {
					event.preventDefault();
					props.onReset();
					return;
				}
				if (props.orientation === "vertical") {
					if (event.key === "ArrowLeft") {
						event.preventDefault();
						props.onStep(-0.02);
					} else if (event.key === "ArrowRight") {
						event.preventDefault();
						props.onStep(0.02);
					}
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					props.onStep(-0.02);
				} else if (event.key === "ArrowDown") {
					event.preventDefault();
					props.onStep(0.02);
				}
			}}
		>
			<div
				aria-hidden="true"
				class={[
					"absolute",
					props.orientation === "vertical"
						? "-inset-x-1.5 inset-y-0 cursor-col-resize"
						: "inset-x-0 -inset-y-1.5 cursor-row-resize",
				]}
			/>
		</div>
	);
}
