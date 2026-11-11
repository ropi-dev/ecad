import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	CircuitBoard,
	FilePlus2,
	FolderOpen,
	House,
	Layers,
	type LucideIcon,
	PanelLeft,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";
import { toastManager } from "#/components/ui/toast.ts";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";
import { addProjectFiles } from "#/projects/add-project-files.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import { isProjectError } from "#/projects/errors.ts";
import { OpenProjectButton } from "#/projects/OpenProjectButton.tsx";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { useWorkspaceControls } from "#/projects/WorkspaceControls.tsx";

const CreateFileDialog = lazy(() =>
	import("#/components/editor/CreateFileDialog.tsx").then((module) => ({
		default: module.CreateFileDialog,
	})),
);

const cardClassName =
	"group relative flex min-h-[4.5rem] w-full cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left text-fg no-underline hover:border-line-strong hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40 has-[:disabled]:cursor-default has-[:disabled]:opacity-40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";

function CardBody({
	icon: Icon,
	title,
	children,
	primary = false,
}: {
	icon: LucideIcon;
	title: string;
	children: ReactNode;
	primary?: boolean;
}) {
	return (
		<>
			<span
				className={`grid size-10 shrink-0 place-items-center rounded-lg ${primary ? "bg-accent text-on-accent" : "bg-hover text-fg-muted group-hover:text-fg"}`}
			>
				<Icon size={20} aria-hidden="true" />
			</span>
			<span className="min-w-0">
				<span className="block text-sm font-semibold">{title}</span>
				<span className="block text-xs text-fg-muted">{children}</span>
			</span>
		</>
	);
}

/** Start page: what the app is, and the four ways into a project. */
export function WorkspaceStart() {
	const project = useProjectSelection(
		({
			busy,
			error,
			reload,
			project,
			createDrawing,
			importAssets,
			selectEditorFile,
		}) => ({
			busy,
			error,
			reload,
			ready: project !== null,
			createDrawing,
			importAssets,
			selectEditorFile,
		}),
	);
	const openSidebar = useWorkspaceControls()?.openSidebar;
	const [creating, setCreating] = useState(false);
	const [importing, setImporting] = useState(false);
	const links = useRef<Record<string, HTMLAnchorElement | null>>({});
	const disabled = !project?.ready || project.busy;

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
			// Open the viewer for what was just added: the board, else the model.
			if (added) links.current[gerber.length ? "/gerber" : "/step"]?.click();
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
		<main className="workspace-plain relative flex h-full min-h-dvh flex-col items-center overflow-y-auto px-4 pt-24 pb-10 sm:justify-center sm:pt-10">
			<DocumentBar icon={House} plain />
			<div className="w-full max-w-[36rem]">
				<p className="ui-section-label m-0 text-accent">ECAD</p>
				<h1 className="m-0 mt-2 text-xl font-semibold text-fg">
					Design circuits, review boards
				</h1>
				<p className="m-0 mt-1.5 text-sm text-fg-muted">
					Draw schematics and symbols, connect circuits, and inspect Gerber
					layers and STEP models. Everything stays on this device.
				</p>
				{project?.busy ? (
					<output className="mt-8 block text-sm text-fg-muted">
						Opening your workspace...
					</output>
				) : project?.error ? (
					<div role="alert" className="ui-notice mt-8 px-3 py-2.5 text-sm">
						<p className="m-0">{project.error}</p>
						<button
							type="button"
							className="ui-button mt-2"
							data-variant="secondary"
							onClick={() => void project.reload()}
						>
							Try again
						</button>
					</div>
				) : (
					<>
						<div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
							<ProjectLink
								href="/editor"
								aria-label="Open schematic"
								aria-disabled={disabled || undefined}
								className={`${cardClassName} aria-disabled:pointer-events-none aria-disabled:opacity-40`}
								onClick={() => project?.selectEditorFile()}
							>
								<CardBody icon={CircuitBoard} title="Open schematic" primary>
									Continue in the editor
								</CardBody>
							</ProjectLink>
							<button
								type="button"
								aria-label="New drawing"
								disabled={disabled}
								className={cardClassName}
								onClick={() => setCreating(true)}
							>
								<CardBody icon={FilePlus2} title="New drawing">
									Start a blank sheet
								</CardBody>
							</button>
							<OpenProjectButton
								label="Open a project"
								className={cardClassName}
							>
								<CardBody icon={FolderOpen} title="Open a project">
									Switch to saved work
								</CardBody>
							</OpenProjectButton>
							<label className={cardClassName}>
								<CardBody
									icon={Layers}
									title={importing ? "Adding files..." : "Import a board"}
								>
									Gerber layers or a STEP model
								</CardBody>
								<input
									type="file"
									multiple
									aria-label="Import a board"
									disabled={disabled || importing}
									className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
									onChange={(event) => {
										const files = Array.from(event.target.files ?? []);
										event.target.value = "";
										void importBoard(files);
									}}
								/>
							</label>
						</div>
						<dl
							aria-label="Workspace instructions"
							className="m-0 mt-8 flex flex-col gap-2 border-t border-line-subtle pt-5 text-xs text-fg-muted"
						>
							<div className="flex min-h-7 items-center justify-between gap-4">
								<dt>Files, imports and project actions</dt>
								<dd className="m-0">
									<button
										type="button"
										className="ui-button -mr-2"
										data-variant="ghost"
										disabled={!openSidebar}
										onClick={() => openSidebar?.()}
									>
										<PanelLeft size={14} aria-hidden="true" />
										Open sidebar
									</button>
								</dd>
							</div>
							{/* Keyboard hints are no use on a touch screen. */}
							{(
								[
									["Pin or compact the sidebar", "Ctrl+Shift+S"],
									["Open settings", "Ctrl+,"],
									["Show every shortcut", "Hold Ctrl"],
								] as const
							).map(([label, keys]) => (
								<div
									key={label}
									className="flex min-h-7 items-center justify-between gap-4 [@media(hover:none)]:hidden"
								>
									<dt>{label}</dt>
									<dd className="m-0">
										<kbd className="ui-kbd">{formatShortcut(keys)}</kbd>
									</dd>
								</div>
							))}
						</dl>
					</>
				)}
			</div>
			{(["/editor", "/gerber", "/step"] as const).map((href) => (
				<ProjectLink
					key={href}
					href={href}
					ref={(node) => {
						links.current[href] = node;
					}}
					hidden
					tabIndex={-1}
				>
					Open {href.slice(1)}
				</ProjectLink>
			))}
			{creating && project && (
				<Suspense fallback={null}>
					<CreateFileDialog
						kind="drawing"
						description="Create an empty drawing file in this project and open it for editing."
						onClose={() => setCreating(false)}
						onCreate={async (name) => {
							try {
								project.selectEditorFile(await project.createDrawing(name));
								setCreating(false);
								links.current["/editor"]?.click();
							} catch (cause) {
								return errorMessage(cause, "Unable to create the drawing.");
							}
						}}
					/>
				</Suspense>
			)}
		</main>
	);
}
