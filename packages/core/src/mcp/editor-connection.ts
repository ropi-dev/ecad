import {
	type createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	type DrawingEnvelope,
	type DrawingReply,
	executeDrawingOperation,
} from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Effect } from "effect";

export type EditorMcpState =
	| { status: "connecting" }
	| { status: "connected"; url: string; token: string }
	| { status: "disconnected" }
	| { status: "error"; message: string };

type Store = ReturnType<typeof createDrawingStore>;

export interface EditorMcpConnection {
	disconnect(): void;
}

/** Desktop builds supply this; the web app has no MCP connector. */
export type EditorMcpConnector = (options: {
	getStore: () => Store;
	onState: (state: EditorMcpState) => void;
}) => EditorMcpConnection;

export function runDrawingRequest(
	store: Store,
	{ expiresAt, operation }: Omit<DrawingEnvelope, "requestId">,
	now = Date.now,
): Promise<DrawingReply> {
	if (expiresAt <= now())
		return Promise.resolve({
			ok: false,
			error: {
				code: "CommandExpired",
				message: "The drawing command expired before execution.",
			},
		});
	return Effect.runPromise(
		executeDrawingOperation(operation).pipe(
			Effect.provideService(DrawingStore, store),
		),
	);
}
