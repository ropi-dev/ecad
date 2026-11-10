import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Check, FolderOpen } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type ReactNode, useState } from "react";
import { OpenProjectDialog } from "#/projects/OpenProjectDialog.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import {
	sidebarMenuContent,
	sidebarMenuItem,
	sidebarMenuLabel,
	useReportActive,
} from "#/projects/sidebarMenu.ts";
import { workspaceActionClassName } from "#/projects/WorkspaceControls.tsx";

const tile = (
	<>
		<FolderOpen size={18} aria-hidden="true" />
		Open
	</>
);

const projectLabel = (name: string) =>
	name.startsWith("Untitled-") ? `Untitled · ${name.slice(9, 17)}` : name;

/**
 * Opens another project. The desktop app asks for a project folder, so the
 * button opens the folder picker directly. The web app keeps its projects in
 * browser storage, so the button lists them in a menu.
 */
export function OpenProjectButton({
	onActiveChange,
	label = "Open project",
	className = workspaceActionClassName,
	children = tile,
}: {
	/** Reports whether the project menu or the save prompt is open. */
	onActiveChange?: (active: boolean) => void;
	/** Accessible name. The start page's card differs from the sidebar tile. */
	label?: string;
	className?: string;
	children?: ReactNode;
}) {
	const project = useProjectSelection(
		({ busy, list, mode, open, project, save }) => ({
			busy,
			list,
			mode,
			open,
			current: project?.directory,
			inMemory: project?.inMemory,
			save,
		}),
	);
	const [projects, setProjects] = useState<string[] | null>(null);
	const [listError, setListError] = useState("");
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [saveError, setSaveError] = useState("");
	const [menuOpen, setMenuOpen] = useState(false);
	useReportActive(menuOpen || confirmOpen, onActiveChange);
	if (!project) return null;

	if (project.mode === "web")
		return (
			<DropdownMenu.Root
				open={menuOpen}
				modal={false}
				onOpenChange={(open) => {
					setMenuOpen(open);
					if (!open) return;
					setListError("");
					void project
						.list()
						.then(setProjects)
						.catch((cause: unknown) => {
							setProjects([]);
							setListError(
								errorMessage(cause, "Unable to list the saved projects."),
							);
						});
				}}
			>
				<DropdownMenu.Trigger asChild>
					<button
						type="button"
						aria-label={label}
						disabled={project.busy}
						className={className}
					>
						{children}
					</button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						aria-label="Open project"
						align="start"
						sideOffset={6}
						collisionPadding={12}
						className={`${sidebarMenuContent} max-h-80`}
					>
						<DropdownMenu.Label className={sidebarMenuLabel}>
							Open project
						</DropdownMenu.Label>
						{projects === null ? (
							<output className="block px-2 py-1.5 text-xs text-fg-muted">
								Loading projects...
							</output>
						) : (
							projects.map((name) => {
								const current = name === project.current;
								return (
									<DropdownMenu.Item
										key={name}
										className={sidebarMenuItem}
										aria-current={current || undefined}
										onSelect={() => {
											if (!current) void project.open(name);
										}}
									>
										<Check
											size={14}
											aria-hidden="true"
											className={current ? "text-accent" : "invisible"}
										/>
										<span className="truncate">{projectLabel(name)}</span>
									</DropdownMenu.Item>
								);
							})
						)}
						{projects?.length === 0 && !listError && (
							<p className="m-0 px-2 py-1.5 text-xs text-fg-muted">
								No saved projects
							</p>
						)}
						{listError && (
							<p role="alert" className="m-0 px-2 py-1.5 text-xs text-warning">
								{listError}
							</p>
						)}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		);

	return (
		<>
			<button
				type="button"
				aria-label={label}
				disabled={project.busy}
				className={className}
				onClick={() => {
					if (project.inMemory) setConfirmOpen(true);
					else void project.open();
				}}
			>
				{children}
			</button>
			<OpenProjectDialog
				open={confirmOpen}
				busy={project.busy}
				error={saveError}
				onCancel={() => {
					setConfirmOpen(false);
					setSaveError("");
				}}
				onDiscard={() => {
					setSaveError("");
					setConfirmOpen(false);
					void project.open();
				}}
				onSave={() => {
					setSaveError("");
					void (async () => {
						if (!(await project.save())) return;
						setConfirmOpen(false);
						await project.open();
					})().catch((cause: unknown) =>
						setSaveError(errorMessage(cause, "Unable to save the project.")),
					);
				}}
			/>
		</>
	);
}
