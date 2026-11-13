import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { toastManager } from "#/components/ui/toast.ts";
import { isProjectError } from "#/projects/errors.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";

export function useSaveProject() {
	const project = useProjectSelection(({ busy, dirty, project, save }) => ({
		busy,
		unsaved: dirty || !!project?.inMemory,
		save,
	}));
	if (!project) return null;
	return {
		busy: project.busy,
		unsaved: project.unsaved,
		save() {
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
		},
	};
}
