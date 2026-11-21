import { Dynamic, type JSX } from "@solidjs/web";
import { children, createEffect, createMemo, Show } from "solid-js";
import { ChevronRight, type LucideIcon } from "#/components/ui/icons.tsx";
import { TooltipProvider } from "#/components/ui/primitives.tsx";
import { projectFileSelections } from "#/projects/file-url.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { primaryPcbId } from "#/projects/pcb.ts";
import {
	useWorkspaceControls,
	useWorkspaceRegistration,
} from "#/projects/WorkspaceControls.tsx";

/**
 * Names the open document. It floats at the top left of a workspace, so the
 * canvas keeps its size. Outside a project it
 * renders nothing.
 */
export function DocumentBar(props: {
	icon: LucideIcon;
	/** The open file's name. The main drawing takes its circuit's name. */
	title?: string;
	/** Id of the open file among `projectFileSelections`. */
	selection?: string;
	/** The open file's sidebar row, when it is not one of those selections. */
	path?: string;
	/** The view the file is open in, when it is not the schematic. */
	view?: "circuit" | "pcb";
	/**
	 * A second bar for the top centre of the workspace, such as the page tabs.
	 * It stays centred while there is room and otherwise sits after this bar.
	 */
	center?: JSX.Element;
	active?: boolean;
	clearSidebar?: boolean;
	split?: boolean;
	/** Controls for this document, such as the view switch. */
	children?: JSX.Element;
}) {
	const project = useProjectSelection(({ project }) => ({ project }));
	const controls = useWorkspaceControls();
	const registerDocument = useWorkspaceRegistration()?.registerDocument;
	const snapshot = () => project()?.project;
	const path = createMemo(() => {
		if (props.path !== undefined) return props.path;
		const current = snapshot();
		const selection = props.selection;
		return current && selection
			? projectFileSelections(current).find((entry) => entry.id === selection)
					?.path
			: undefined;
	});
	createEffect(
		() => ({
			active: props.active ?? true,
			path: path(),
			view: props.view,
		}),
		({ active, path, view }) =>
			active ? registerDocument?.({ path, view }) : undefined,
	);
	const name = () =>
		props.title ??
		(props.selection === "drawing"
			? (snapshot()?.circuits?.find((file) => file.circuit.id === primaryPcbId)
					?.circuit.name ?? "Drawing")
			: undefined);
	const projectName = () => snapshot()?.manifest.name;
	const center = children(() => props.center);
	const undocked = () => !controls?.sidebarDocked;
	return (
		<Show when={project()}>
			<TooltipProvider delayDuration={350} skipDelayDuration={150}>
				{/* The row mirrors the sidebar button's inset on the right, so a
				    centred bar is centred on the workspace. */}
				<div
					data-docked={controls?.sidebarDocked ? "true" : "false"}
					class={[
						"pointer-events-none absolute top-[var(--chrome-top)] z-4 grid items-start gap-2",
						undocked() && (props.clearSidebar ?? true)
							? "left-[calc(var(--chrome-gap)+var(--chrome-control)+6px)]"
							: "left-[var(--chrome-gap)]",
						undocked() && !props.split
							? "right-[calc(var(--chrome-gap)+var(--chrome-control)+6px)]"
							: "right-[var(--chrome-gap)]",
						center.toArray().length
							? "grid-cols-[minmax(min-content,1fr)_auto_minmax(0,1fr)] @max-[600px]:grid-cols-[minmax(0,1fr)]"
							: "grid-cols-[minmax(0,1fr)]",
					]}
				>
					{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would disable nothing here and carries form semantics */}
					<div
						role="group"
						aria-label="Document"
						class="ui-panel pointer-events-auto flex h-[var(--chrome-control)] max-w-full min-w-0 items-center gap-2.5 justify-self-start px-3 py-0 has-[>[role=group]]:pr-1.5"
					>
						{/* Project first, then the open file. A file named like its project
					    is shown once. */}
						<p class="m-0 flex min-w-0 items-center gap-1.5">
							<Show when={name() && projectName() && name() !== projectName()}>
								<span class="hidden max-w-40 min-w-0 truncate text-xs text-fg-faint @min-[1100px]:inline">
									{projectName()}
								</span>
								<ChevronRight
									size={12}
									aria-hidden="true"
									class="hidden shrink-0 text-fg-disabled @min-[1100px]:inline"
								/>
							</Show>
							<Dynamic
								component={props.icon}
								size={16}
								aria-hidden="true"
								class="shrink-0 text-fg-faint"
							/>
							<span class="max-w-40 min-w-0 truncate pl-0.5 text-sm font-semibold text-fg @min-[1100px]:max-w-64">
								{name() ?? projectName()}
							</span>
						</p>
						{props.children}
					</div>
					<Show when={center.toArray().length}>
						<div class="pointer-events-auto max-w-full min-w-0 @max-[600px]:justify-self-center">
							{center()}
						</div>
					</Show>
				</div>
			</TooltipProvider>
		</Show>
	);
}
