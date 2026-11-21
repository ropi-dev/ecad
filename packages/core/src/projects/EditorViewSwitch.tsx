import { Dynamic } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import {
	CircuitBoard,
	Columns2,
	Columns3,
	Grid2x2,
	type LucideIcon,
	Maximize2,
	Workflow,
	X,
} from "#/components/ui/icons.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import type { EditorView } from "#/projects/ProjectSession.ts";

const views = [
	{ id: "schematic", label: "Schematic", icon: CircuitBoard },
	{ id: "circuit", label: "Circuit", icon: Workflow },
	{ id: "pcb", label: "PCB", icon: Grid2x2 },
] as const;

export interface EditorSplitControls {
	paneCount: number;
	onSelectView: (view: EditorView) => void;
	onSplitTwo: () => void;
	onSplitThree: () => void;
	onFocusOnly: () => void;
	onClosePane: () => void;
	onSwitchView?: (view: EditorView) => void;
}

const groupClass =
	"flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-line-subtle bg-field p-0.5 pointer-coarse:h-full pointer-coarse:border-0 pointer-coarse:bg-transparent pointer-coarse:p-0";
const buttonClass =
	"ui-toggle flex h-full w-8 cursor-pointer items-center justify-center rounded-sm [--toggle-on-bg:var(--color-pressed)] [--toggle-on-fg:var(--color-fg)] hover:[--toggle-bg:transparent] focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none aria-pressed:cursor-default pointer-coarse:w-11 pointer-coarse:rounded-md";

function SplitButton(props: {
	label: string;
	tooltip: string;
	icon: LucideIcon;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<TooltipButton
			aria-label={props.label}
			tooltip={props.tooltip}
			disabled={props.disabled}
			class={buttonClass}
			onClick={() => props.onClick()}
		>
			<Dynamic component={props.icon} size={15} aria-hidden="true" />
		</TooltipButton>
	);
}

function SplitGroup(props: { split: EditorSplitControls; disabled: boolean }) {
	const splitThree = () => (
		<SplitButton
			label="Split into 3 views"
			tooltip="Show all 3 views"
			icon={Columns3}
			disabled={props.disabled}
			onClick={props.split.onSplitThree}
		/>
	);
	const closePane = () => (
		<SplitButton
			label="Close pane"
			tooltip="Close pane"
			icon={X}
			onClick={props.split.onClosePane}
		/>
	);
	const content = () =>
		props.split.paneCount <= 1 ? (
			<>
				<SplitButton
					label="Split into 2 views"
					tooltip="Split into 2 views"
					icon={Columns2}
					disabled={props.disabled}
					onClick={props.split.onSplitTwo}
				/>
				{splitThree()}
			</>
		) : props.split.paneCount === 2 ? (
			<>
				{splitThree()}
				{closePane()}
			</>
		) : (
			<>
				<SplitButton
					label="Show only this view"
					tooltip="Show only this view"
					icon={Maximize2}
					onClick={props.split.onFocusOnly}
				/>
				{closePane()}
			</>
		);
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would disable both buttons together
		<div role="group" aria-label="Split view" class={groupClass}>
			{content()}
		</div>
	);
}

export function EditorViewSwitch(props: {
	view: EditorView;
	split?: EditorSplitControls;
}) {
	const project = useProjectSelection(
		({ busy, project, switchEditorView }) => ({
			busy,
			project,
			switchEditorView,
		}),
	);
	const [switching, setSwitching] = createSignal(false);
	return (
		<Show when={project()?.project}>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would disable both buttons together */}
			<div role="group" aria-label="Editor view" class={groupClass}>
				<For each={views}>
					{(entry) => {
						const current = () => entry.id === props.view;
						const Icon = entry.icon;
						return (
							<TooltipButton
								aria-label={
									current()
										? `${entry.label} view`
										: `Switch to ${entry.id} view`
								}
								tooltip={`${entry.label} view`}
								aria-pressed={current() ? "true" : "false"}
								data-view={entry.id}
								// The open view's side does nothing, so it takes no shortcut.
								data-shortcut-scope={current() ? "none" : undefined}
								disabled={!current() && (switching() || project()?.busy)}
								class={buttonClass}
								onClick={() => {
									if (current()) return;
									if (props.split && props.split.paneCount > 1) {
										props.split.onSelectView(entry.id);
										return;
									}
									const switchEditorView = project()?.switchEditorView;
									if (!switchEditorView) return;
									props.split?.onSwitchView?.(entry.id);
									setSwitching(true);
									void switchEditorView(entry.id).finally(() =>
										setSwitching(false),
									);
								}}
							>
								<Icon size={15} aria-hidden="true" />
							</TooltipButton>
						);
					}}
				</For>
			</div>
			<Show when={props.split}>
				{(split) => <SplitGroup split={split()} disabled={!!project()?.busy} />}
			</Show>
		</Show>
	);
}
