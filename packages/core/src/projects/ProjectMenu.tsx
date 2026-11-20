import { type Accessor, createSignal, Show } from "solid-js";
import { FilePlus2, FolderCog, Library } from "#/components/ui/icons.tsx";
import { DropdownMenu } from "#/components/ui/primitives.tsx";
import { TooltipTrigger } from "#/components/viewer/TooltipButton.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import {
	sidebarMenuContent,
	sidebarMenuItem,
	useReportActive,
} from "#/projects/sidebarMenu.ts";
import { LazySettingsDialog } from "#/settings/LazySettingsDialog.tsx";

export function ProjectMenu(props: {
	registerActive?: (active: Accessor<boolean> | undefined) => void;
	class: string;
	onCloseAutoFocus?: (event: Event) => void;
}) {
	const project = useProjectSelection(({ busy, create }) => ({ busy, create }));
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	useReportActive(
		() => menuOpen() || settingsOpen(),
		(active) => props.registerActive?.(active),
	);
	return (
		<Show when={project()}>
			{(current) => (
				<>
					<DropdownMenu.Root open={menuOpen()} onOpenChange={setMenuOpen}>
						<TooltipTrigger tooltip="Project actions" side="right">
							<DropdownMenu.Trigger>
								<button
									type="button"
									aria-label="Project actions"
									class={props.class}
									disabled={current().busy}
								>
									<FolderCog size={18} aria-hidden="true" />
								</button>
							</DropdownMenu.Trigger>
						</TooltipTrigger>
						<DropdownMenu.Content
							aria-label="Project actions"
							side="right"
							onCloseAutoFocus={(event) => props.onCloseAutoFocus?.(event)}
							align="start"
							sideOffset={12}
							collisionPadding={12}
							class={sidebarMenuContent}
						>
							<DropdownMenu.Item
								class={sidebarMenuItem}
								onSelect={() => void current().create("Untitled")}
							>
								<FilePlus2 size={14} aria-hidden="true" />
								New untitled project
							</DropdownMenu.Item>
							<DropdownMenu.Item
								class={sidebarMenuItem}
								onSelect={() => setSettingsOpen(true)}
							>
								<Library size={14} aria-hidden="true" />
								Symbol libraries...
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<LazySettingsDialog
						open={settingsOpen()}
						onOpenChange={setSettingsOpen}
						section="libraries"
					/>
				</>
			)}
		</Show>
	);
}
