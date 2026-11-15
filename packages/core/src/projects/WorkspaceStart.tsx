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
import type { ProjectAsset } from "#/projects/format.ts";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { useWorkspaceControls } from "#/projects/WorkspaceControls.tsx";
import "#/projects/WorkspaceStart.css";

export function WorkspaceStart() {
	const project = useProjectSelection(
		({
			busy,
			error,
			reload,
			project,
			importAssets,
			importExample,
			selectAsset,
			selectEditorFile,
			openBoard,
		}) => ({
			busy,
			error,
			reload,
			ready: project !== null,
			importAssets,
			importExample,
			selectAsset,
			selectEditorFile,
			openBoard,
		}),
	);
	const sidebar = useWorkspaceControls()?.sidebar;
	const [importing, setImporting] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const viewerLinks = useRef<Record<string, HTMLAnchorElement | null>>({});
	const modifier = shortcutModifier().key;

	async function openExample() {
		if (!project) return;
		setImporting(true);
		try {
			await project.openBoard(await project.importExample("rp2350a"));
			viewerLinks.current["/editor"]?.click();
		} catch (cause) {
			if (!isProjectError(cause, "ProjectConflict"))
				toastManager.add({
					type: "error",
					title: "Unable to add the example.",
					description: errorMessage(cause, "Unable to add the example."),
				});
		} finally {
			setImporting(false);
		}
	}

	async function importBoard(files: File[]) {
		if (!project || !files.length) return;
		const step = files.filter((file) => /\.(step|stp)$/i.test(file.name));
		const gerber = files.filter((file) => !step.includes(file));
		setImporting(true);
		try {
			const added = {
				gerber: [] as ProjectAsset[],
				step: [] as ProjectAsset[],
			};
			for (const [kind, group] of [
				["gerber", gerber],
				["step", step],
			] as const)
				if (group.length)
					added[kind] = (
						await addProjectFiles(project.importAssets, group, kind)
					).assets;
			const kind = added.gerber.length ? "gerber" : "step";
			const assets = added[kind];
			if (assets.length) {
				project.selectAsset(assets.length === 1 ? assets[0] : null, {
					reload: true,
				});
				viewerLinks.current[`/${kind}`]?.click();
			}
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
						<div>
							<dt>Open an example</dt>
							<dd>
								<button
									type="button"
									disabled={!project?.ready || importing}
									className="workspace-start-action"
									onClick={() => void openExample()}
								>
									RP2350A reference design
								</button>
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
			{(["/editor", "/gerber", "/step"] as const).map((href) => (
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
