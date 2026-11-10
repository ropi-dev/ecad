import { Plus } from "lucide-react";
import { workspaceLinkClassName } from "#/projects/EditorHeader.tsx";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";
import { useWorkspaceControls } from "#/projects/WorkspaceControls.tsx";

export function GerberHeader({
	loading,
	onOpenFile,
}: {
	loading: boolean;
	onOpenFile: (files: File[]) => void;
}) {
	const project = useProjectActions();
	const workspaceControls = useWorkspaceControls();
	if (workspaceControls) return null;
	const link = {
		className: workspaceLinkClassName,
		"data-variant": "secondary",
		"data-size": "md",
	} as const;
	return (
		<header className="absolute top-[var(--chrome-top)] left-[var(--chrome-gap)] z-2 flex max-w-[calc(100%-2*var(--chrome-gap))] flex-wrap items-center gap-2">
			<ProjectLink href="/" {...link}>
				Workspace
			</ProjectLink>
			{!project && (
				<label
					className={`${workspaceLinkClassName} relative focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}
					data-variant="primary"
					data-size="md"
				>
					<Plus size={15} aria-hidden="true" />{" "}
					{loading ? "Reading…" : "Add files"}
					<input
						type="file"
						className="absolute inset-0 size-full cursor-pointer opacity-0"
						multiple
						aria-label="Open Gerber file"
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							if (files.length) onOpenFile(files);
							event.target.value = "";
						}}
					/>
				</label>
			)}
			<ProjectLink href="/step" {...link}>
				STEP viewer
			</ProjectLink>
			<ProjectLink href="/editor" {...link}>
				Schematic editor
			</ProjectLink>
		</header>
	);
}
