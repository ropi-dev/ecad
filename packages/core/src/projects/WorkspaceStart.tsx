import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { House } from "lucide-react";
import { useRef, useState } from "react";
import { toastManager } from "#/components/ui/toast.ts";
import {
	formatShortcut,
	shortcutModifier,
} from "#/components/viewer/shortcutModifier.ts";
import { revealButtonShortcuts } from "#/components/viewer/useButtonShortcuts.ts";
import { addProjectFiles } from "#/projects/add-project-files.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import { isProjectError } from "#/projects/errors.ts";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { useWorkspaceControls } from "#/projects/WorkspaceControls.tsx";
import "#/projects/WorkspaceStart.css";

export function WorkspaceStart() {
	const project = useProjectSelection(
		({ busy, error, reload, project, importAssets }) => ({
			busy,
			error,
			reload,
			ready: project !== null,
			importAssets,
		}),
	);
	const sidebar = useWorkspaceControls()?.sidebar;
	const [importing, setImporting] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const viewerLinks = useRef<Record<string, HTMLAnchorElement | null>>({});
	const modifier = shortcutModifier().key;

	async function importBoard(files: File[]) {
		if (!project || !files.length) return;
		const step = files.filter((file) => /\.(step|stp)$/i.test(file.name));
		const gerber = files.filter((file) => !step.includes(file));
		setImporting(true);
		try {
			let added = 0;
			for (const [kind, group] of [
				["gerber", gerber],
				["step", step],
			] as const)
				if (group.length)
					added += (await addProjectFiles(project.importAssets, group, kind))
						.added;
			if (added)
				viewerLinks.current[gerber.length ? "/gerber" : "/step"]?.click();
		} catch (cause) {
			if (!isProjectError(cause, "ProjectConflict"))
				toastManager.add({
					type: "error",
					title: "Unable to add project files.",
					description: errorMessage(cause, "Unable to add project files."),
				});
		} finally {
			setImporting(false);
		}
	}

	return (
		<main className="workspace-start workspace-plain relative flex h-full min-h-dvh flex-col">
			<DocumentBar icon={House} />
			<div className="workspace-start-message">
				{project?.busy ? (
					<output>Opening your workspace...</output>
				) : project?.error ? (
					<div role="alert">
						<p className="m-0">{project.error}</p>
						<button
							type="button"
							className="ui-button mt-3"
							data-variant="secondary"
							onClick={() => void project.reload()}
						>
							Try again
						</button>
					</div>
				) : (
					<dl
						className="workspace-start-instructions"
						aria-label="Workspace instructions"
						data-shortcut-scope="none"
					>
						<div data-keyboard>
							<dt>Create a file</dt>
							<dd>
								<button
									type="button"
									aria-keyshortcuts={`${modifier}+Shift+N`}
									disabled={!sidebar || !project?.ready}
									className="workspace-start-action"
									onClick={() => sidebar?.openAddMenu()}
								>
									{formatShortcut("Ctrl+Shift+N")}
								</button>
							</dd>
						</div>
						<div>
							<dt>View a board</dt>
							<dd>
								<button
									type="button"
									disabled={!project?.ready || importing}
									className="workspace-start-action"
									onClick={() => fileInput.current?.click()}
								>
									{importing ? "Adding files..." : "Import Gerber or STEP"}
								</button>
								<input
									ref={fileInput}
									type="file"
									multiple
									hidden
									tabIndex={-1}
									onChange={(event) => {
										const files = Array.from(event.target.files ?? []);
										event.target.value = "";
										void importBoard(files);
									}}
								/>
							</dd>
						</div>
						<div data-keyboard>
							<dt>Open settings</dt>
							<dd>
								<button
									type="button"
									aria-keyshortcuts={`${modifier}+,`}
									disabled={!sidebar}
									className="workspace-start-action"
									onClick={() => sidebar?.openSettings()}
								>
									{formatShortcut("Ctrl+,")}
								</button>
							</dd>
						</div>
						<div data-keyboard>
							<dt>Show every shortcut</dt>
							<dd>
								<button
									type="button"
									className="workspace-start-action"
									onClick={revealButtonShortcuts}
								>
									{formatShortcut("Hold Ctrl")}
								</button>
							</dd>
						</div>
					</dl>
				)}
			</div>
			{(["/gerber", "/step"] as const).map((href) => (
				<ProjectLink
					key={href}
					href={href}
					ref={(node) => {
						viewerLinks.current[href] = node;
					}}
					hidden
					tabIndex={-1}
				>
					Open {href.slice(1)}
				</ProjectLink>
			))}
		</main>
	);
}
