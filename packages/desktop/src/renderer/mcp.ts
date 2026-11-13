import {
	type EditorMcpConnector,
	runDrawingRequest,
} from "@ecad/core/mcp/editor-connection.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { DesktopMcpBridge } from "#/bridge.ts";
import { decodeIpcError } from "#/ipc-errors.ts";

export function createDesktopMcpConnector(
	bridge: DesktopMcpBridge,
): EditorMcpConnector {
	return ({ getStore, onState }) => {
		let active = true;
		// Commands run one at a time, in the order the client sent them.
		let queue = Promise.resolve();
		const stopRequests = bridge.onRequest((request) => {
			queue = queue.then(async () => {
				if (!active) return;
				const reply = await runDrawingRequest(getStore(), request);
				await bridge.reply(request.requestId, reply).catch(() => {});
			});
		});
		onState({ status: "connecting" });
		bridge.enable().then(
			({ url, token }) => {
				if (active) onState({ status: "connected", url, token });
			},
			(cause) => {
				if (!active) return;
				active = false;
				stopRequests();
				onState({
					status: "error",
					message: errorMessage(
						decodeIpcError(cause),
						"Unable to start the MCP server.",
					),
				});
			},
		);
		return {
			disconnect() {
				if (!active) return;
				active = false;
				stopRequests();
				void bridge.disable().catch(() => {});
				onState({ status: "disconnected" });
			},
		};
	};
}
