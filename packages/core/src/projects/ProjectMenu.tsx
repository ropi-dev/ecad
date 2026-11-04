import { FolderOpen } from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "#/lib/error-message.ts";
import { isProjectError } from "#/projects/errors.ts";
import { OpenProjectDialog } from "#/projects/OpenProjectDialog.tsx";
import { useProject } from "#/projects/ProjectProvider.tsx";

const SymbolLibrarySettings = lazy(() =>
	import("#/projects/SymbolLibrarySettings.tsx").then((module) => ({
		default: module.SymbolLibrarySettings,
	})),
);

const item =
	"cursor-pointer rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-white/10 data-[disabled]:opacity-40";

export function ProjectMenu() {
	const project = useProject();
	const [projects, setProjects] = useState<string[]>([]);
	const [error, setError] = useState("");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [saveError, setSaveError] = useState("");
	const [confirmOpen, setConfirmOpen] = useState(false);
	if (!project) return null;
	return (
		<>
			{saveError &&
				!confirmOpen &&
				createPortal(
					<div
						role="alert"
						aria-label="Project save failed"
						className="fixed bottom-4 left-16 z-50 max-w-[calc(100vw-5rem)] rounded-lg border border-amber-400/40 bg-slate-900 p-4 text-sm text-slate-200 shadow-lg"
					>
						<p>{saveError}</p>
						<button
							type="button"
							onClick={() => setSaveError("")}
							className="mt-3 rounded px-2 py-1 text-xs underline hover:bg-white/10 focus-visible:outline-2"
						>
							Dismiss save error
						</button>
					</div>,
					document.body,
				)}
			<DropdownMenu.Root
				onOpenChange={(open) => {
					if (open && project.mode === "web")
						void project
							.list()
							.then(setProjects)
							.catch((cause: unknown) => setError(String(cause)));
				}}
			>
				<DropdownMenu.Trigger asChild>
					<button
						type="button"
						aria-label="Project actions"
						title="Project actions"
						className="flex h-9 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 focus-visible:outline-2"
						disabled={project.busy}
					>
						<FolderOpen size={20} aria-hidden="true" />
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
							onSelect={() => {
								setSaveError("");
								void project.save().catch((cause: unknown) => {
									// The conflict notice explains a conflict.
									if (!isProjectError(cause, "ProjectConflict"))
										setSaveError(
											errorMessage(cause, "Unable to save the project."),
										);
								});
							}}
						>
							Save project
						</DropdownMenu.Item>
						<DropdownMenu.Item
							className={item}
							onSelect={() => setSettingsOpen(true)}
						>
							Symbol libraries...
						</DropdownMenu.Item>
						<DropdownMenu.Separator className="my-1 h-px bg-white/10" />
						{project.mode === "desktop" ? (
							<DropdownMenu.Item
								className={item}
								onSelect={() => {
									if (project.project?.inMemory) setConfirmOpen(true);
									else void project.open();
								}}
							>
								Open project...
							</DropdownMenu.Item>
						) : (
							<>
								<DropdownMenu.Label className="px-3 py-2 text-xs text-slate-500">
									Open project
								</DropdownMenu.Label>
								{projects.map((name) => (
									<DropdownMenu.Item
										key={name}
										className={item}
										onSelect={() => void project.open(name)}
									>
										{name.startsWith("Untitled-")
											? `Untitled · ${name.slice(9, 17)}`
											: name}
									</DropdownMenu.Item>
								))}
								{error && (
									<p role="alert" className="px-3 py-2 text-xs">
										{error}
									</p>
								)}
							</>
						)}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
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
						setSaveError(
							cause instanceof Error
								? cause.message
								: "Unable to save the project.",
						),
					);
				}}
			/>
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
