import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	Match,
	Show,
	Switch,
} from "solid-js";
import { PlugZap } from "#/components/ui/icons.tsx";
import { Popover } from "#/components/ui/primitives.tsx";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipTrigger } from "#/components/viewer/TooltipButton.tsx";
import type {
	EditorMcpConnection,
	EditorMcpConnector,
	EditorMcpState,
} from "#/mcp/editor-connection.ts";
import { useReportActive } from "#/projects/sidebarMenu.ts";

const fieldClassName = "ui-input w-full font-mono text-2xs";
const fieldLabel = "text-xs font-medium text-fg-muted";

export function McpControls(props: {
	store: ReturnType<typeof createDrawingStore>;
	connect: EditorMcpConnector;
	autoEnable?: boolean;
	registerActive?: (active: Accessor<boolean> | undefined) => void;
}) {
	const fieldId = createUniqueId();
	const [enabled, setEnabled] = createSignal(() => props.autoEnable ?? false);
	const [panelOpen, setPanelOpen] = createSignal(
		() => props.autoEnable ?? false,
	);
	let trigger: HTMLButtonElement | undefined;
	useReportActive(panelOpen, (active) => props.registerActive?.(active));
	const [connection, setConnection] = createSignal<EditorMcpState | null>(null);
	const [copyMessage, setCopyMessage] = createSignal("");
	let activeConnection: EditorMcpConnection | null = null;
	createEffect(
		() => (enabled() ? props.connect : undefined),
		(connect) => {
			if (!connect) return;
			let mounted = true;
			const opened = connect({
				getStore: () => props.store,
				onState: (state) => {
					if (!mounted) return;
					setConnection(state);
					if (state.status === "error") {
						setEnabled(false);
						setPanelOpen(true);
					}
				},
			});
			activeConnection = opened;
			return () => {
				mounted = false;
				opened.disconnect();
				if (activeConnection === opened) activeConnection = null;
			};
		},
	);
	const connected = createMemo(() => {
		const state = connection();
		return state?.status === "connected" ? state : null;
	});
	const failure = createMemo(() => {
		const state = connection();
		return state?.status === "error" ? state : null;
	});
	const configuration = createMemo(() => {
		const state = connected();
		return state
			? JSON.stringify(
					{
						mcpServers: {
							ecad: {
								url: state.url,
								headers: { Authorization: `Bearer ${state.token}` },
							},
						},
					},
					null,
					2,
				)
			: "";
	});
	const label = () =>
		enabled()
			? connection()?.status === "connected"
				? "MCP connected"
				: "MCP connecting..."
			: "Enable MCP";
	return (
		<Popover.Root
			open={panelOpen()}
			onOpenChange={(open: boolean) => setPanelOpen(open)}
		>
			<TooltipTrigger tooltip={label()} side="right">
				<Popover.Trigger>
					<button
						ref={(button) => {
							trigger = button;
						}}
						type="button"
						aria-label={label()}
						aria-pressed={enabled() ? "true" : "false"}
						aria-expanded={panelOpen() ? "true" : "false"}
						aria-controls={`${fieldId}-panel`}
						data-icon
						class="ui-button ui-toggle size-9"
						onClick={() => {
							if (enabled()) return;
							setConnection(null);
							setCopyMessage("");
							setEnabled(true);
						}}
					>
						<PlugZap size={18} aria-hidden="true" />
					</button>
				</Popover.Trigger>
			</TooltipTrigger>
			<Show
				when={
					panelOpen() && connection() && connection()?.status !== "disconnected"
				}
			>
				<Popover.Content
					id={`${fieldId}-panel`}
					role="region"
					aria-label="MCP connection"
					side="right"
					align="start"
					sideOffset={12}
					collisionPadding={12}
					onCloseAutoFocus={(event: Event) => {
						event.preventDefault();
						quietFocus(trigger ?? null);
					}}
					class="ui-popover z-30 grid max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-1.5rem))] w-[min(360px,calc(100vw-1.5rem))] max-w-[var(--radix-popover-content-available-width)] gap-3 overflow-auto p-3 text-xs"
				>
					<header class="flex items-center justify-between gap-3">
						<h2 class="m-0 text-sm font-semibold">MCP connection</h2>
						{enabled() && (
							<button
								type="button"
								class="ui-button"
								data-variant="danger"
								onClick={() => {
									activeConnection?.disconnect();
									setEnabled(false);
									setPanelOpen(false);
									setConnection(null);
									setCopyMessage("");
								}}
							>
								Disable MCP
							</button>
						)}
					</header>
					<Switch>
						<Match when={connection()?.status === "connecting"}>
							<output class="text-fg-muted">Starting the MCP server...</output>
						</Match>
						<Match when={failure()}>
							{(error) => (
								<p role="alert" class="m-0 text-danger">
									{error().message}
								</p>
							)}
						</Match>
						<Match when={connected()}>
							{(live) => (
								<>
									<output class="flex items-center gap-2 font-medium text-success">
										<span
											aria-hidden="true"
											class="size-1.5 rounded-full bg-success"
										/>
										Connected to the open drawing
									</output>
									<p class="m-0 text-fg-muted">
										MCP tools can read and edit the drawing open in the editor.
										Keep ECAD open. Disable MCP to disconnect.
									</p>
									<div class="grid gap-1.5">
										<label for={`${fieldId}-url`} class={fieldLabel}>
											MCP URL
										</label>
										<input
											id={`${fieldId}-url`}
											class={fieldClassName}
											readonly
											value={live().url}
										/>
									</div>
									<div class="grid gap-1.5">
										<label for={`${fieldId}-token`} class={fieldLabel}>
											MCP bearer token
										</label>
										<input
											id={`${fieldId}-token`}
											class={fieldClassName}
											readonly
											type="password"
											value={live().token}
										/>
									</div>
									<div class="grid gap-1.5">
										<label for={`${fieldId}-configuration`} class={fieldLabel}>
											MCP configuration
										</label>
										<textarea
											id={`${fieldId}-configuration`}
											class={fieldClassName}
											readonly
											rows={9}
											value={configuration()}
										/>
									</div>
									<button
										type="button"
										class="ui-button"
										data-variant="primary"
										data-size="md"
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(configuration());
												setCopyMessage("Configuration copied.");
											} catch {
												setCopyMessage(
													"Select and copy the configuration above.",
												);
											}
										}}
									>
										Copy configuration
									</button>
									<Show when={copyMessage()}>
										<output class="text-fg-muted">{copyMessage()}</output>
									</Show>
								</>
							)}
						</Match>
					</Switch>
				</Popover.Content>
			</Show>
		</Popover.Root>
	);
}
