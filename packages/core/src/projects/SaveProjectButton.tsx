import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Save } from "lucide-react";
import { toastManager } from "#/components/ui/toast.ts";
import { isProjectError } from "#/projects/errors.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { workspaceActionClassName } from "#/projects/WorkspaceControls.tsx";

/**
 * Saves the open project. An in-memory project asks for a folder first. The
 * icon is highlighted while there is something to save.
 */
export function SaveProjectButton() {
	const project = useProjectSelection(({ busy, dirty, project, save }) => ({
		busy,
		unsaved: dirty || !!project?.inMemory,
		save,
	}));
	if (!project) return null;
	return (
		<button
			type="button"
			aria-label="Save project"
			disabled={project.busy}
			className={`${workspaceActionClassName} ${project.unsaved ? "text-[#e8b77e]" : "text-[#98a4b6]"}`}
			onClick={() => {
				toastManager.close("project-save");
				void project
					.save()
					.then((saved) => {
						if (saved)
							toastManager.add({
								id: "project-save",
								type: "success",
								title: "Project saved",
							});
					})
					.catch((cause: unknown) => {
						if (!isProjectError(cause, "ProjectConflict"))
							toastManager.add({
								id: "project-save",
								type: "error",
								title: "Project save failed",
								description: errorMessage(cause, "Unable to save the project."),
							});
					});
			}}
		>
			<Save size={20} aria-hidden="true" />
		</button>
	);
}
