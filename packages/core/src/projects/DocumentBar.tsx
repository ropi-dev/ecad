import { ChevronRight, type LucideIcon } from "lucide-react";
import { Tooltip } from "radix-ui";
import { type ReactNode, useEffect, useMemo } from "react";
import { projectFileSelections } from "#/projects/file-url.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { primaryPcbId } from "#/projects/pcb.ts";
import {
	useWorkspaceControls,
	useWorkspaceRegistration,
} from "#/projects/WorkspaceControls.tsx";

/**
 * Names the open document. It floats at the top left of a workspace, so the
 * canvas keeps its size. Outside a project it
 * renders nothing.
 */
export function DocumentBar({
	icon: Icon,
	title,
	selection,
	path: suppliedPath,
	circuit = false,
	center,
	children,
}: {
	icon: LucideIcon;
	/** The open file's name. The main drawing takes its circuit's name. */
	title?: string;
	/** Id of the open file among `projectFileSelections`. */
	selection?: string;
	/** The open file's sidebar row, when it is not one of those selections. */
	path?: string;
	/** The file is open in its circuit view. */
	circuit?: boolean;
	/**
	 * A second bar for the top centre of the workspace, such as the page tabs.
	 * It stays centred while there is room and otherwise sits after this bar.
	 */
	center?: ReactNode;
	/** Controls for this document, such as the view switch. */
	children?: ReactNode;
}) {
	const project = useProjectSelection(({ project }) => ({ project }));
	const docked = useWorkspaceControls()?.sidebarDocked ?? false;
	const registerDocument = useWorkspaceRegistration()?.registerDocument;
	const snapshot = project?.project;
	const path = useMemo(
		() =>
			suppliedPath ??
			(snapshot && selection
				? projectFileSelections(snapshot).find(
						(entry) => entry.id === selection,
					)?.path
				: undefined),
		[snapshot, selection, suppliedPath],
	);
	useEffect(
		() => registerDocument?.({ path, circuit }),
		[registerDocument, path, circuit],
	);
	if (!project) return null;
	const name =
		title ??
		(selection === "drawing"
			? (snapshot?.circuits?.find((file) => file.circuit.id === primaryPcbId)
					?.circuit.name ?? "Drawing")
			: undefined);
	const projectName = snapshot?.manifest.name;
	return (
		<Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
			{/* The row mirrors the sidebar button's inset on the right, so a
			    centred bar is centred on the workspace. */}
			<div
				data-docked={docked}
				className={`pointer-events-none absolute top-[var(--chrome-top)] right-[calc(var(--chrome-gap)+var(--chrome-control)+6px)] left-[calc(var(--chrome-gap)+var(--chrome-control)+6px)] z-4 grid items-start gap-2 data-[docked=true]:right-[var(--chrome-gap)] data-[docked=true]:left-[var(--chrome-gap)] ${center ? "grid-cols-[minmax(min-content,1fr)_auto_minmax(0,1fr)] max-[600px]:grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"}`}
			>
				{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would disable nothing here and carries form semantics */}
				<div
					role="group"
					aria-label="Document"
					className="ui-panel pointer-events-auto flex h-[var(--chrome-control)] max-w-full min-w-0 items-center gap-2.5 justify-self-start px-3 py-0 has-[>[role=group]]:pr-1.5"
				>
					{/* Project first, then the open file. A file named like its project
				    is shown once. */}
					<p className="m-0 flex min-w-0 items-center gap-1.5">
						{name && projectName && name !== projectName && (
							<>
								<span className="hidden max-w-40 min-w-0 truncate text-xs text-fg-faint min-[1100px]:inline">
									{projectName}
								</span>
								<ChevronRight
									size={12}
									aria-hidden="true"
									className="hidden shrink-0 text-fg-disabled min-[1100px]:inline"
								/>
							</>
						)}
						<Icon
							size={16}
							aria-hidden="true"
							className="shrink-0 text-fg-faint"
						/>
						<span className="max-w-40 min-w-0 truncate pl-0.5 text-sm font-semibold text-fg min-[1100px]:max-w-64">
							{name ?? projectName}
						</span>
					</p>
					{children}
				</div>
				{center && (
					<div className="pointer-events-auto max-w-full min-w-0 max-[600px]:justify-self-center">
						{center}
					</div>
				)}
			</div>
		</Tooltip.Provider>
	);
}
