import { PlugZap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { createDrawingStore } from "#/commands/drawing-store.ts";
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
	const fieldClassName =
		"w-full rounded border border-[#414955] bg-[#111318] px-2 py-1.5 font-mono text-[11px] text-[#e8edf5]";
	const label = enabled
		? connection?.status === "connected"
			? "MCP connected"
			: "MCP connecting..."
		: "Enable MCP";
	return (
		<div className="contents">
			<button
				type="button"
				aria-label={label}
				title={label}
				aria-pressed={enabled}
				aria-expanded={panelOpen}
				aria-controls={`${fieldId}-panel`}
				className={
					compact
						? `${workspaceActionClassName} text-[#c3abd8] aria-pressed:bg-[#e8b77e1c] aria-pressed:text-[#e8b77e]`
						: "inline-flex cursor-pointer items-center rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] shadow-[0_4px_16px_#0003] hover:bg-[#303741] aria-pressed:border-[#b88f61] aria-pressed:text-[#e8b77e]"
				}
				onClick={() => {
					if (enabled) {
						setPanelOpen((value) => !value);
						return;
					}
					setConnection(null);
					setCopyMessage("");
					setPanelOpen(true);
					setEnabled(true);
				}}
			>
				{compact ? <PlugZap size={20} aria-hidden="true" /> : label}
			</button>
			{panelOpen && connection && connection.status !== "disconnected" && (
				<section
					id={`${fieldId}-panel`}
					aria-label="MCP connection"
					className={
						compact
							? "absolute top-28 right-3 left-3 z-30 grid max-h-[calc(100%-8rem)] gap-3 overflow-auto rounded-lg border border-[#414955] bg-[#191c22] p-3 text-[12px] text-[#e8edf5] shadow-xl"
							: "absolute top-full left-0 z-30 mt-2 grid max-h-[calc(100dvh-10rem)] w-[min(360px,calc(100vw-5rem))] gap-3 overflow-auto rounded-lg border border-[#414955] bg-[#191c22] p-3 text-[12px] text-[#e8edf5] shadow-xl"
					}
				>
					{enabled && (
						<button
							type="button"
							className="justify-self-end rounded border border-[#72543a] bg-[#392e25] px-3 py-1.5 text-[#edc49a] hover:bg-[#493a2b]"
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
					{connection.status === "connecting" && (
						<output>Connecting to this drawing...</output>
					)}
					{connection.status === "error" && (
						<p role="alert">{connection.message}</p>
					)}
					{connection.status === "connected" && (
						<>
							<output className="font-medium text-[#e8b77e]">
								Connected to this drawing
							</output>
							<p className="text-[#9ba7b8]">
								MCP tools can read and edit this drawing. Keep this tab open.
								Disable MCP to disconnect.
							</p>
							<div className="grid gap-1">
								<label htmlFor={`${fieldId}-url`}>MCP URL</label>
								<input
									id={`${fieldId}-url`}
									className={fieldClassName}
									readOnly
									value={connection.url}
								/>
							</div>
							<div className="grid gap-1">
								<label htmlFor={`${fieldId}-token`}>MCP bearer token</label>
								<input
									id={`${fieldId}-token`}
									className={fieldClassName}
									readOnly
									type="password"
									value={connection.token}
								/>
							</div>
							<div className="grid gap-1">
								<label htmlFor={`${fieldId}-configuration`}>
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
								className="rounded border border-[#72543a] bg-[#392e25] px-3 py-2 text-[#edc49a] hover:bg-[#493a2b]"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(configuration);
										setCopyMessage("Configuration copied.");
									} catch {
										setCopyMessage("Select and copy the configuration above.");
									}
								}}
							>
								Copy configuration
							</button>
							{copyMessage && <output>{copyMessage}</output>}
						</>
					)}
				</section>
			)}
		</div>
	);
}
