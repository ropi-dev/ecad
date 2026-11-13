import { RefreshCw, TriangleAlert } from "lucide-react";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";

export function ProjectConflictNotice() {
	const project = useProjectSelection(
		({ busy, conflict, dirty, otherUnsavedEdits, reload }) => ({
			busy,
			conflict,
			dirty,
			otherUnsavedEdits,
			reload,
		}),
	);
	if (!project?.conflict) return null;
	return (
		<div
			role="alert"
			aria-labelledby="project-conflict-title"
			className="ui-notice fixed top-[calc(var(--chrome-gap)+var(--chrome-bar))] left-1/2 z-40 flex w-[min(620px,calc(100%-2*var(--chrome-gap)))] -translate-x-1/2 items-start gap-3 py-2.5 pr-2.5 pl-3 shadow-pop"
		>
			<TriangleAlert
				size={16}
				aria-hidden="true"
				className="mt-0.5 shrink-0 text-warning"
			/>
			<div className="min-w-0 flex-1">
				<p id="project-conflict-title" className="m-0 text-sm font-semibold">
					This project changed on disk
				</p>
				<p className="m-0 mt-0.5 text-fg-muted">
					Another program or window changed its files after you opened it.{" "}
					{project.dirty
						? "Saving, and opening other files or projects, is paused so neither version is overwritten."
						: "Saving is paused so neither version is overwritten."}
				</p>
				{(project.dirty || project.otherUnsavedEdits) && (
					<p className="m-0 mt-0.5 text-fg-muted">
						Your unsaved changes are still here. Reloading from disk discards
						them.
					</p>
				)}
			</div>
			<button
				type="button"
				className="ui-button"
				data-variant="primary"
				disabled={project.busy}
				onClick={() => void project.reload()}
			>
				<RefreshCw size={14} aria-hidden="true" />
				Reload from disk
			</button>
		</div>
	);
}
