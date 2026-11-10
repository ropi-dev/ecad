import { CircuitBoard, Workflow } from "lucide-react";
import { useState } from "react";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";

const views = [
	{ id: "schematic", label: "Schematic", icon: CircuitBoard },
	{ id: "circuit", label: "Circuit", icon: Workflow },
] as const;

/**
 * Two-way switch between the schematic and the circuit view of one design.
 * The pressed side is the view on screen; the other side switches to it.
 * Each side is an icon whose tooltip names its view.
 */
export function EditorViewSwitch({ view }: { view: "circuit" | "schematic" }) {
	const project = useProjectSelection(
		({ busy, project, switchEditorView }) => ({
			busy,
			project,
			switchEditorView,
		}),
	);
	const [switching, setSwitching] = useState(false);
	if (!project?.project) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would disable both buttons together
		<div
			role="group"
			aria-label="Editor view"
			className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-line-subtle bg-field p-0.5 pointer-coarse:h-full pointer-coarse:border-0 pointer-coarse:bg-transparent pointer-coarse:p-0"
		>
			{views.map(({ id, label, icon: Icon }) => {
				const current = id === view;
				const name = current ? `${label} view` : `Switch to ${id} view`;
				return (
					<TooltipButton
						key={id}
						aria-label={name}
						tooltip={`${label} view`}
						aria-pressed={current}
						data-view={id}
						// The open view's side does nothing, so it takes no shortcut.
						data-shortcut-scope={current ? "none" : undefined}
						disabled={!current && (switching || project.busy)}
						className="ui-toggle flex h-full w-8 cursor-pointer items-center justify-center rounded-sm [--toggle-on-bg:var(--color-pressed)] [--toggle-on-fg:var(--color-fg)] hover:[--toggle-bg:transparent] focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none aria-pressed:cursor-default pointer-coarse:w-11 pointer-coarse:rounded-md"
						onClick={() => {
							if (current) return;
							setSwitching(true);
							void project
								.switchEditorView(id)
								.finally(() => setSwitching(false));
						}}
					>
						<Icon size={15} aria-hidden="true" />
					</TooltipButton>
				);
			})}
		</div>
	);
}
