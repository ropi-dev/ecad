import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { JSX } from "@solidjs/web";
import {
	type Accessor,
	createSignal,
	For,
	Match,
	Show,
	Switch,
} from "solid-js";
import { Check, FolderOpen } from "#/components/ui/icons.tsx";
import { DropdownMenu } from "#/components/ui/primitives.tsx";
import { TooltipTrigger } from "#/components/viewer/TooltipButton.tsx";
import { OpenProjectDialog } from "#/projects/OpenProjectDialog.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import {
	sidebarMenuContent,
	sidebarMenuItem,
	sidebarMenuLabel,
	useReportActive,
} from "#/projects/sidebarMenu.ts";

const projectLabel = (name: string) =>
	name.startsWith("Untitled-") ? `Untitled · ${name.slice(9, 17)}` : name;

/**
 * Opens another project. The desktop app asks for a project folder, so the
 * button opens the folder picker directly. The web app keeps its projects in
 * browser storage, so the button lists them in a menu.
 */
export function OpenProjectButton(props: {
	/** Reports whether the project menu or the save prompt is open. */
	registerActive?: (active: Accessor<boolean> | undefined) => void;
	class: string;
	onCloseAutoFocus?: (event: Event) => void;
}) {
	const withTooltip = (trigger: JSX.Element) => (
		<TooltipTrigger tooltip="Open project" side="right">
			{trigger}
		</TooltipTrigger>
	);
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
	const [projects, setProjects] = createSignal<string[] | null>(null);
	const [listError, setListError] = createSignal("");
	const [confirmOpen, setConfirmOpen] = createSignal(false);
	const [saveError, setSaveError] = createSignal("");
	const [menuOpen, setMenuOpen] = createSignal(false);
	useReportActive(
		() => menuOpen() || confirmOpen(),
		(active) => props.registerActive?.(active),
	);

	return (
		<Show when={project()}>
			{(current) => (
				<Switch>
					<Match when={current().mode === "web"}>
						<DropdownMenu.Root
							open={menuOpen()}
							modal={false}
							onOpenChange={(open) => {
								setMenuOpen(open);
								if (!open) return;
								setListError("");
								void current()
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
							{withTooltip(
								<DropdownMenu.Trigger>
									<button
										type="button"
										aria-label="Open project"
										disabled={current().busy}
										class={props.class}
									>
										<FolderOpen size={18} aria-hidden="true" />
									</button>
								</DropdownMenu.Trigger>,
							)}
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									aria-label="Open project"
									side="right"
									onCloseAutoFocus={(event) => props.onCloseAutoFocus?.(event)}
									align="start"
									sideOffset={12}
									collisionPadding={12}
									class={`${sidebarMenuContent} max-h-80`}
								>
									<DropdownMenu.Label class={sidebarMenuLabel}>
										Open project
									</DropdownMenu.Label>
									<Show
										when={projects()}
										fallback={
											<output class="block px-2 py-1.5 text-xs text-fg-muted">
												Loading projects...
											</output>
										}
									>
										{(names) => (
											<For each={names()}>
												{(name) => (
													<DropdownMenu.Item
														class={sidebarMenuItem}
														aria-current={
															name === current().current ? "true" : undefined
														}
														onSelect={() => {
															if (name !== current().current)
																void current().open(name);
														}}
													>
														<Check
															size={14}
															aria-hidden="true"
															class={
																name === current().current
																	? "text-accent"
																	: "invisible"
															}
														/>
														<span class="truncate">{projectLabel(name)}</span>
													</DropdownMenu.Item>
												)}
											</For>
										)}
									</Show>
									<Show when={projects()?.length === 0 && !listError()}>
										<p class="m-0 px-2 py-1.5 text-xs text-fg-muted">
											No saved projects
										</p>
									</Show>
									<Show when={listError()}>
										<p
											role="alert"
											class="m-0 px-2 py-1.5 text-xs text-warning"
										>
											{listError()}
										</p>
									</Show>
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					</Match>
					<Match when={current().mode !== "web"}>
						{withTooltip(
							<button
								type="button"
								aria-label="Open project"
								disabled={current().busy}
								class={props.class}
								onClick={() => {
									if (current().inMemory) setConfirmOpen(true);
									else void current().open();
								}}
							>
								<FolderOpen size={18} aria-hidden="true" />
							</button>,
						)}
						<OpenProjectDialog
							open={confirmOpen()}
							busy={current().busy}
							error={saveError()}
							onCancel={() => {
								setConfirmOpen(false);
								setSaveError("");
							}}
							onDiscard={() => {
								setSaveError("");
								setConfirmOpen(false);
								void current().open();
							}}
							onSave={() => {
								setSaveError("");
								const selection = current();
								void (async () => {
									if (!(await selection.save())) return;
									setConfirmOpen(false);
									await selection.open();
								})().catch((cause: unknown) =>
									setSaveError(
										errorMessage(cause, "Unable to save the project."),
									),
								);
							}}
						/>
					</Match>
				</Switch>
			)}
		</Show>
	);
}
