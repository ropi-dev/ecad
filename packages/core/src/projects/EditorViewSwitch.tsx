import { createSignal, For, Show } from "solid-js";
import { CircuitBoard, Grid2x2, Workflow } from "#/components/ui/icons.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import type { EditorView } from "#/projects/ProjectSession.ts";

const views = [
	{ id: "schematic", label: "Schematic", icon: CircuitBoard },
	{ id: "circuit", label: "Circuit", icon: Workflow },
	{ id: "pcb", label: "PCB", icon: Grid2x2 },
] as const;

export function EditorViewSwitch(props: { view: EditorView }) {
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
			<div
				role="group"
				aria-label="Editor view"
				class="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-line-subtle bg-field p-0.5 pointer-coarse:h-full pointer-coarse:border-0 pointer-coarse:bg-transparent pointer-coarse:p-0"
			>
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
								class="ui-toggle flex h-full w-8 cursor-pointer items-center justify-center rounded-sm [--toggle-on-bg:var(--color-pressed)] [--toggle-on-fg:var(--color-fg)] hover:[--toggle-bg:transparent] focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none aria-pressed:cursor-default pointer-coarse:w-11 pointer-coarse:rounded-md"
								onClick={() => {
									const switchEditorView = project()?.switchEditorView;
									if (current() || !switchEditorView) return;
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
		</Show>
	);
}
