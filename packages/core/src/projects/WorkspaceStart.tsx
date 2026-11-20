import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { createSignal, For, Match, Switch } from "solid-js";
import { House } from "#/components/ui/icons.tsx";
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
	const controls = useWorkspaceControls();
	const sidebar = () => controls?.sidebar;
	const [importing, setImporting] = createSignal(false);
	let fileInput!: HTMLInputElement;
	const viewerLinks: Record<string, HTMLAnchorElement | undefined> = {};
	const modifier = shortcutModifier().key;

	async function openExample() {
		const current = project();
		if (!current) return;
		setImporting(true);
		try {
			await current.openBoard(await current.importExample("rp2350a"));
			viewerLinks["/editor"]?.click();
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
		const current = project();
		if (!current || !files.length) return;
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
						await addProjectFiles(current.importAssets, group, kind)
					).assets;
			const kind = added.gerber.length ? "gerber" : "step";
			const assets = added[kind];
			if (assets.length) {
				current.selectAsset(assets.length === 1 ? assets[0] : null, {
					reload: true,
				});
				viewerLinks[`/${kind}`]?.click();
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
		<main class="workspace-start workspace-plain relative flex h-full min-h-dvh flex-col">
			<DocumentBar icon={House} />
			<div class="workspace-start-message">
				<Switch
					fallback={
						<dl
							class="workspace-start-instructions"
							aria-label="Workspace instructions"
							data-shortcut-scope="none"
						>
							<div data-keyboard>
								<dt>Create a file</dt>
								<dd>
									<button
										type="button"
										aria-keyshortcuts={`${modifier}+Shift+N`}
										disabled={!sidebar() || !project()?.ready}
										class="workspace-start-action"
										onClick={() => sidebar()?.openAddMenu()}
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
										disabled={!project()?.ready || importing()}
										class="workspace-start-action"
										onClick={() => fileInput.click()}
									>
										{importing() ? "Adding files..." : "Import Gerber or STEP"}
									</button>
									<input
										ref={fileInput}
										type="file"
										multiple
										hidden
										tabindex={-1}
										onChange={(event) => {
											const files = Array.from(event.currentTarget.files ?? []);
											event.currentTarget.value = "";
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
										disabled={!project()?.ready || importing()}
										class="workspace-start-action"
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
										disabled={!sidebar()}
										class="workspace-start-action"
										onClick={() => sidebar()?.openSettings()}
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
										class="workspace-start-action"
										onClick={() => revealButtonShortcuts()}
									>
										{formatShortcut("Hold Ctrl")}
									</button>
								</dd>
							</div>
						</dl>
					}
				>
					<Match when={project()?.busy}>
						<output>Opening your workspace...</output>
					</Match>
					<Match when={project()?.error}>
						<div role="alert">
							<p class="m-0">{project()?.error}</p>
							<button
								type="button"
								class="ui-button mt-3"
								data-variant="secondary"
								onClick={() => void project()?.reload()}
							>
								Try again
							</button>
						</div>
					</Match>
				</Switch>
			</div>
			<For each={["/editor", "/gerber", "/step"] as const}>
				{(href) => (
					<ProjectLink
						href={href}
						ref={(node) => {
							viewerLinks[href] = node;
						}}
						hidden
						tabindex={-1}
					>
						Open {href.slice(1)}
					</ProjectLink>
				)}
			</For>
		</main>
	);
}
