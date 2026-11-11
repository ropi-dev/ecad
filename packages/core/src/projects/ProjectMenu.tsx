import { FilePlus2, FolderCog, Library } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import {
	sidebarMenuContent,
	sidebarMenuItem,
	useReportActive,
} from "#/projects/sidebarMenu.ts";
import { workspaceActionClassName } from "#/projects/WorkspaceControls.tsx";
import { LazySettingsDialog } from "#/settings/LazySettingsDialog.tsx";

export function ProjectMenu({
	onActiveChange,
}: {
	onActiveChange?: (active: boolean) => void;
}) {
	const project = useProjectSelection(({ busy, create }) => ({ busy, create }));
	const [menuOpen, setMenuOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	useReportActive(menuOpen || settingsOpen, onActiveChange);
	if (!project) return null;
	return (
		<>
			<DropdownMenu.Root
				open={menuOpen}
				onOpenChange={setMenuOpen}
				modal={false}
			>
				<DropdownMenu.Trigger asChild>
					<button
						type="button"
						aria-label="Project actions"
						className={workspaceActionClassName}
						disabled={project.busy}
					>
						<FolderCog size={18} aria-hidden="true" />
						Project
					</button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						aria-label="Project actions"
						align="start"
						sideOffset={6}
						collisionPadding={12}
						className={sidebarMenuContent}
					>
						<DropdownMenu.Item
							className={sidebarMenuItem}
							onSelect={() => void project.create("Untitled")}
						>
							<FilePlus2 size={14} aria-hidden="true" />
							New untitled project
						</DropdownMenu.Item>
						<DropdownMenu.Item
							className={sidebarMenuItem}
							onSelect={() => setSettingsOpen(true)}
						>
							<Library size={14} aria-hidden="true" />
							Symbol libraries...
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
			<LazySettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				section="libraries"
			/>
		</>
	);
}
