import { Show } from "solid-js";
import { Plus } from "#/components/ui/icons.tsx";
import { workspaceLinkClassName } from "#/projects/EditorHeader.tsx";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";
import { useWorkspaceControls } from "#/projects/WorkspaceControls.tsx";

const link = {
	class: workspaceLinkClassName,
	"data-variant": "secondary",
	"data-size": "md",
} as const;

export function GerberHeader(props: {
	loading: boolean;
	onOpenFile: (files: File[]) => void;
}) {
	const project = useProjectActions();
	const workspaceControls = useWorkspaceControls();
	return (
		<Show when={!workspaceControls}>
			<header class="absolute top-[var(--chrome-top)] left-[var(--chrome-gap)] z-2 flex max-w-[calc(100%-2*var(--chrome-gap))] flex-wrap items-center gap-2">
				<ProjectLink href="/" {...link}>
					Workspace
				</ProjectLink>
				<Show when={!project()}>
					<label
						class={`${workspaceLinkClassName} relative focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}
						data-variant="primary"
						data-size="md"
					>
						<Plus size={15} aria-hidden="true" />{" "}
						{props.loading ? "Reading…" : "Add files"}
						<input
							type="file"
							class="absolute inset-0 size-full cursor-pointer opacity-0"
							multiple
							aria-label="Open Gerber file"
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								if (files.length) props.onOpenFile(files);
								event.currentTarget.value = "";
							}}
						/>
					</label>
				</Show>
				<ProjectLink href="/step" {...link}>
					STEP viewer
				</ProjectLink>
				<ProjectLink href="/editor" {...link}>
					Schematic editor
				</ProjectLink>
			</header>
		</Show>
	);
}
