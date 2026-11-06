import { FolderCog } from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { lazy, Suspense, useState } from "react";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { workspaceActionClassName } from "#/projects/WorkspaceControls.tsx";

const SymbolLibrarySettings = lazy(() =>
	import("#/projects/SymbolLibrarySettings.tsx").then((module) => ({
		default: module.SymbolLibrarySettings,
	})),
);

const item =
	"cursor-pointer rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-white/10 data-[disabled]:opacity-40";

export function ProjectMenu() {
	const project = useProjectSelection(({ busy, create }) => ({ busy, create }));
	const [settingsOpen, setSettingsOpen] = useState(false);
	if (!project) return null;
	return (
		<>
			<DropdownMenu.Root>
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
						className="z-50 max-h-80 min-w-48 overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-1 text-slate-300 shadow-lg"
					>
						<DropdownMenu.Item
							className={item}
							onSelect={() => void project.create("Untitled")}
						>
							New untitled project
						</DropdownMenu.Item>
						<DropdownMenu.Item
							className={item}
							onSelect={() => setSettingsOpen(true)}
						>
							Symbol libraries...
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
			<Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
					<Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-300 shadow-xl">
						<Dialog.Title className="text-base">Symbol libraries</Dialog.Title>
						<Dialog.Description className="mb-4 mt-2 text-sm text-slate-400">
							Manage user and project symbol libraries.
						</Dialog.Description>
						{settingsOpen && (
							<Suspense fallback={<output>Loading libraries...</output>}>
								<SymbolLibrarySettings />
							</Suspense>
						)}
						<Dialog.Close className="mt-4 rounded border border-slate-700 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2">
							Done
						</Dialog.Close>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
