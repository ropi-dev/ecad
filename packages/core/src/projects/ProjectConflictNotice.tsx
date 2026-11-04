import { RefreshCw, TriangleAlert } from "lucide-react";
import { useProject } from "#/projects/ProjectProvider.tsx";

/** Shown when saving stopped because the project changed on disk. */
export function ProjectConflictNotice() {
	const project = useProject();
	if (!project?.conflict) return null;
	return (
		<div
			role="alert"
			aria-labelledby="project-conflict-title"
			className="fixed top-3 left-1/2 z-30 flex w-[min(620px,calc(100%-32px))] -translate-x-1/2 items-start gap-3 rounded-lg border border-[#72543a] bg-[#392e25] py-2.5 pr-2.5 pl-3 text-[13px] text-[#edc49a] shadow-lg shadow-black/40"
		>
			<TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
			<div className="min-w-0 flex-1">
				<p id="project-conflict-title" className="m-0 font-semibold">
					This project changed on disk
				</p>
				<p className="m-0 mt-0.5 text-[#e2c3a3]">
					Another program or window changed its files after you opened it.{" "}
					{project.dirty
						? "Saving, and opening other files or projects, is paused so neither version is overwritten."
						: "Saving is paused so neither version is overwritten."}
				</p>
				{project.dirty && (
					<p className="m-0 mt-0.5 text-[#e2c3a3]">
						Your unsaved changes are still here. Reloading from disk discards
						them.
					</p>
				)}
			</div>
			<button
				type="button"
				className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[#b88f61] bg-[#e8b77e1c] px-2.5 py-1.5 text-[12px] font-medium text-[#f3d2ad] hover:bg-[#e8b77e30] focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-default disabled:opacity-60"
				disabled={project.busy}
				onClick={() => void project.reload()}
			>
				<RefreshCw size={14} aria-hidden="true" />
				Reload from disk
			</button>
		</div>
	);
}
