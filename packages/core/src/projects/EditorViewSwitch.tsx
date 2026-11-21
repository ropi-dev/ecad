import { createSignal, For, Show } from "solid-js";
import {
	CircuitBoard,
	Columns3,
	Grid2x2,
	Workflow,
} from "#/components/ui/icons.tsx";
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
		({ busy, project, splitViews, switchEditorView, setSplitEditorViews }) => ({
			busy,
			project,
			splitViews,
			switchEditorView,
			setSplitEditorViews,
		}),
	);
	const [switching, setSwitching] = createSignal(false);
	const splitViews = () => project()?.splitViews ?? [];
	const isSplit = () => splitViews().length >= 2;
	const run = (task: Promise<void>) => {
		setSwitching(true);
		void task.finally(() => setSwitching(false));
	};
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
						const shown = () => splitViews().includes(entry.id);
						const pressed = () => (isSplit() ? shown() : current());
						const Icon = entry.icon;
						return (
							<TooltipButton
								aria-label={
									isSplit()
										? shown()
											? `Hide ${entry.id} view`
											: `Show ${entry.id} view`
										: current()
											? `${entry.label} view`
											: `Switch to ${entry.id} view`
								}
								tooltip={
									isSplit()
										? shown()
											? `Hide ${entry.label} view`
											: `Show ${entry.label} view`
										: `${entry.label} view`
								}
								aria-pressed={pressed() ? "true" : "false"}
								data-view={entry.id}
								// The open view's side does nothing in single-view mode, so it takes no shortcut.
								data-shortcut-scope={
									!isSplit() && current() ? "none" : undefined
								}
								disabled={(isSplit() || !current()) && Boolean(project()?.busy)}
								aria-disabled={
									(isSplit() || !current()) && switching() ? "true" : undefined
								}
								class={`ui-toggle flex h-full w-8 cursor-pointer items-center justify-center rounded-sm [--toggle-on-bg:var(--color-pressed)] [--toggle-on-fg:var(--color-fg)] hover:[--toggle-bg:transparent] focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none aria-disabled:pointer-events-none ${isSplit() ? "" : "aria-pressed:cursor-default"} pointer-coarse:w-11 pointer-coarse:rounded-md`}
								onClick={(event) => {
									const state = project();
									if (!state || switching() || state.busy) return;
									if (isSplit()) {
										const currentViews = state.splitViews;
										const next = shown()
											? currentViews.filter((view) => view !== entry.id)
											: [...currentViews, entry.id];
										if (!next.length) return;
										run(
											state.setSplitEditorViews(
												next,
												shown() ? undefined : entry.id,
											),
										);
										return;
									}
									if (current()) return;
									if (event.shiftKey || event.ctrlKey || event.metaKey) {
										run(
											state.setSplitEditorViews(
												[props.view, entry.id],
												entry.id,
											),
										);
										return;
									}
									run(state.switchEditorView(entry.id));
								}}
							>
								<Icon size={15} aria-hidden="true" />
							</TooltipButton>
						);
					}}
				</For>
				<span aria-hidden="true" class="mx-0.5 h-4 w-px bg-line-subtle" />
				<TooltipButton
					aria-label={isSplit() ? "Exit split view" : "Split view"}
					tooltip={isSplit() ? "Exit split view" : "Split view"}
					aria-pressed={isSplit() ? "true" : "false"}
					data-split-toggle={isSplit() ? "true" : "false"}
					disabled={Boolean(project()?.busy)}
					aria-disabled={switching() ? "true" : undefined}
					class="ui-toggle flex h-full w-8 cursor-pointer items-center justify-center rounded-sm [--toggle-on-bg:var(--color-pressed)] [--toggle-on-fg:var(--color-fg)] hover:[--toggle-bg:transparent] focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none aria-disabled:pointer-events-none pointer-coarse:w-11 pointer-coarse:rounded-md"
					onClick={() => {
						const state = project();
						if (!state || switching() || state.busy) return;
						if (isSplit()) run(state.setSplitEditorViews([props.view]));
						else
							run(
								state.setSplitEditorViews(
									["schematic", "circuit", "pcb"],
									props.view,
								),
							);
					}}
				>
					<Columns3 size={15} aria-hidden="true" />
				</TooltipButton>
			</div>
		</Show>
	);
}
