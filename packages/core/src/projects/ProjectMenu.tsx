import { FilePlus2, FolderCog, Library } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { lazy, Suspense, useState } from "react";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import {
	sidebarMenuContent,
	sidebarMenuItem,
	useReportActive,
} from "#/projects/sidebarMenu.ts";
import { workspaceActionClassName } from "#/projects/WorkspaceControls.tsx";

const SymbolLibrarySettings = lazy(() =>
	import("#/projects/SymbolLibrarySettings.tsx").then((module) => ({
		default: module.SymbolLibrarySettings,
	})),
);

export function ProjectMenu({
	onActiveChange,
}: {
	/** Reports whether the menu or the Symbol libraries dialog is open. */
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
			<AppDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				size="lg"
				focusDialog
				title="Symbol libraries"
				description="Choose which libraries the symbol picker offers, and add your own."
				footer={
					<button
						type="button"
						className="ui-button"
						data-variant="primary"
						data-size="md"
						onClick={() => setSettingsOpen(false)}
					>
						Done
					</button>
				}
			>
				<div className={dialogBodyClassName}>
					{settingsOpen && (
						<Suspense
							fallback={
								<output className="text-sm text-fg-muted">
									Loading libraries...
								</output>
							}
						>
							<SymbolLibrarySettings />
						</Suspense>
					)}
				</div>
			</AppDialog>
		</>
	);
}
