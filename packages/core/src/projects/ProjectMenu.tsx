import { FilePlus2, FolderCog, Library } from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { lazy, Suspense, useState } from "react";
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
						title="Project actions"
						className={`${workspaceActionClassName} text-[#98a4b6] data-[state=open]:bg-white/10`}
						disabled={project.busy}
					>
						<FolderCog size={20} aria-hidden="true" />
					</button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						aria-label="Project actions"
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
			<Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
					<Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-[#414955] bg-[#191c22] p-5 text-[#c7d0dc] shadow-xl">
						<Dialog.Title className="m-0 text-base font-semibold text-[#e8edf5]">
							Symbol libraries
						</Dialog.Title>
						<Dialog.Description className="mb-4 mt-2 text-sm text-[#9ba7b8]">
							Manage user and project symbol libraries.
						</Dialog.Description>
						{settingsOpen && (
							<Suspense fallback={<output>Loading libraries...</output>}>
								<SymbolLibrarySettings />
							</Suspense>
						)}
						<Dialog.Close className="mt-4 cursor-pointer rounded border border-[#414955] px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e]">
							Done
						</Dialog.Close>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
