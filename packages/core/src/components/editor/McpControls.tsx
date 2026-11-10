import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import { PlugZap } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import {
	connectEditorMcp,
	type EditorMcpState,
} from "#/mcp/editor-connection.ts";
import { workspaceActionClassName } from "#/projects/WorkspaceControls.tsx";

export function McpControls({
	store,
	compact = false,
}: {
	store: ReturnType<typeof createDrawingStore>;
	compact?: boolean;
}) {
	const fieldId = useId();
	const [enabled, setEnabled] = useState(false);
	const [panelOpen, setPanelOpen] = useState(false);
	const [connection, setConnection] = useState<EditorMcpState | null>(null);
	const [copyMessage, setCopyMessage] = useState("");
	const activeConnection = useRef<ReturnType<typeof connectEditorMcp> | null>(
		null,
	);
	useEffect(() => {
		if (!enabled) return;
		let mounted = true;
		const connection = connectEditorMcp({
			store,
			onState: (state) => {
				if (!mounted) return;
				setConnection(state);
				if (state.status === "error") {
					setEnabled(false);
					setPanelOpen(true);
				}
			},
		});
		activeConnection.current = connection;
		return () => {
			mounted = false;
			connection.disconnect();
			if (activeConnection.current === connection)
				activeConnection.current = null;
		};
	}, [enabled, store]);
	const configuration =
		connection?.status === "connected"
			? JSON.stringify(
					{
						mcpServers: {
							ecad: {
								url: connection.url,
								headers: { Authorization: `Bearer ${connection.token}` },
							},
						},
					},
					null,
					2,
				)
			: "";
	const fieldClassName = "ui-input w-full font-mono text-2xs";
	const fieldLabel = "text-xs font-medium text-fg-muted";
	const label = enabled
		? connection?.status === "connected"
			? "MCP connected"
			: "MCP connecting..."
		: "Enable MCP";
	return (
		<Popover.Root open={panelOpen} onOpenChange={setPanelOpen}>
			<Popover.Trigger asChild>
				<button
					type="button"
					aria-label={label}
					aria-pressed={enabled}
					aria-expanded={panelOpen}
					aria-controls={`${fieldId}-panel`}
					data-size={compact ? undefined : "md"}
					className={
						compact
							? workspaceActionClassName
							: "ui-button ui-toggle shadow-panel [--toggle-bg:var(--color-panel)] [--toggle-fg:var(--color-fg)] [--toggle-line:var(--color-line)] [--toggle-on-bg:var(--color-panel)] [--toggle-on-line:var(--color-accent-line)] hover:[--toggle-bg:var(--color-panel)] hover:[--toggle-line:var(--color-line-strong)]"
					}
					onClick={() => {
						if (enabled) return;
						setConnection(null);
						setCopyMessage("");
						setEnabled(true);
					}}
				>
					{compact ? (
						<>
							<PlugZap size={18} aria-hidden="true" />
							MCP
						</>
					) : (
						label
					)}
				</button>
			</Popover.Trigger>
			{panelOpen && connection && connection.status !== "disconnected" && (
				<Popover.Portal>
					<Popover.Content
						asChild
						role="region"
						side="bottom"
						align="start"
						sideOffset={8}
						collisionPadding={12}
					>
						<section
							id={`${fieldId}-panel`}
							aria-label="MCP connection"
							className="ui-popover z-30 grid max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-1.5rem))] w-[min(360px,calc(100vw-1.5rem))] max-w-[var(--radix-popover-content-available-width)] gap-3 overflow-auto p-3 text-xs"
						>
							<header className="flex items-center justify-between gap-3">
								<h2 className="m-0 text-sm font-semibold">MCP connection</h2>
								{enabled && (
									<button
										type="button"
										className="ui-button"
										data-variant="danger"
										onClick={() => {
											activeConnection.current?.disconnect();
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
							{connection.status === "connecting" && (
								<output className="text-fg-muted">
									Connecting to this drawing...
								</output>
							)}
							{connection.status === "error" && (
								<p role="alert" className="m-0 text-danger">
									{connection.message}
								</p>
							)}
							{connection.status === "connected" && (
								<>
									<output className="flex items-center gap-2 font-medium text-success">
										<span
											aria-hidden="true"
											className="size-1.5 rounded-full bg-success"
										/>
										Connected to this drawing
									</output>
									<p className="m-0 text-fg-muted">
										MCP tools can read and edit this drawing. Keep this tab
										open. Disable MCP to disconnect.
									</p>
									<div className="grid gap-1.5">
										<label htmlFor={`${fieldId}-url`} className={fieldLabel}>
											MCP URL
										</label>
										<input
											id={`${fieldId}-url`}
											className={fieldClassName}
											readOnly
											value={connection.url}
										/>
									</div>
									<div className="grid gap-1.5">
										<label htmlFor={`${fieldId}-token`} className={fieldLabel}>
											MCP bearer token
										</label>
										<input
											id={`${fieldId}-token`}
											className={fieldClassName}
											readOnly
											type="password"
											value={connection.token}
										/>
									</div>
									<div className="grid gap-1.5">
										<label
											htmlFor={`${fieldId}-configuration`}
											className={fieldLabel}
										>
											MCP configuration
										</label>
										<textarea
											id={`${fieldId}-configuration`}
											className={fieldClassName}
											readOnly
											rows={9}
											value={configuration}
										/>
									</div>
									<button
										type="button"
										className="ui-button"
										data-variant="primary"
										data-size="md"
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(configuration);
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
									{copyMessage && (
										<output className="text-fg-muted">{copyMessage}</output>
									)}
								</>
							)}
						</section>
					</Popover.Content>
				</Popover.Portal>
			)}
		</Popover.Root>
	);
}
