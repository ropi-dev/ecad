import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Data, Effect } from "effect";
import type {
	DrawingEnvelope,
	DrawingOperation,
	DrawingReply,
} from "#/mcp/drawing-protocol.ts";

export class EditorSessionError extends Data.TaggedError("EditorSessionError")<{
	code: string;
	message: string;
	status: number;
}> {}

export interface EditorSessionCredentials {
	sessionId: string;
	mcpToken: string;
	editorToken: string;
}

interface Connection {
	send: (message: DrawingEnvelope) => void;
	close: () => void;
}

interface Session extends EditorSessionCredentials {
	createdAt: number;
	connection?: Connection;
	pending: Map<
		string,
		{
			expiresAt: number;
			complete: (reply: DrawingReply) => void;
			fail: (error: EditorSessionError) => void;
		}
	>;
}

const unavailable = () =>
	new EditorSessionError({
		code: "EditorDisconnected",
		message:
			"The editor is disconnected. Enable MCP in the drawing and use its current endpoint.",
		status: 404,
	});

function matchesToken(expected: string, actual: string | undefined) {
	if (!actual) return false;
	const expectedBytes = Buffer.from(expected);
	const actualBytes = Buffer.from(actual);
	return (
		expectedBytes.length === actualBytes.length &&
		timingSafeEqual(expectedBytes, actualBytes)
	);
}

/** Routes complete commands to one explicitly connected editor. It owns no drawing data. */
export function makeEditorSessionHub({
	timeoutMs = 15_000,
	unconnectedTtlMs = 60_000,
	maxSessions = 100,
	maxPending = 128,
	now = Date.now,
}: {
	timeoutMs?: number;
	unconnectedTtlMs?: number;
	maxSessions?: number;
	maxPending?: number;
	now?: () => number;
} = {}) {
	const sessions = new Map<string, Session>();
	const remove = (session: Session) => {
		if (!sessions.delete(session.sessionId)) return;
		const connection = session.connection;
		session.connection = undefined;
		for (const pending of session.pending.values()) pending.fail(unavailable());
		session.pending.clear();
		connection?.close();
	};
	const lookup = (sessionId: string) => {
		const session = sessions.get(sessionId);
		if (
			session &&
			!session.connection &&
			now() - session.createdAt >= unconnectedTtlMs
		) {
			remove(session);
			return undefined;
		}
		return session;
	};
	const authorize = (
		sessionId: string,
		token: string | undefined,
		role: "editor" | "mcp",
	) => {
		const session = lookup(sessionId);
		if (
			!session ||
			!matchesToken(
				role === "editor" ? session.editorToken : session.mcpToken,
				token,
			)
		) {
			throw new EditorSessionError({
				code: "Unauthorized",
				message: "A valid editor session token is required.",
				status: 401,
			});
		}
		return session;
	};
	return {
		create(): EditorSessionCredentials {
			for (const id of sessions.keys()) lookup(id);
			if (sessions.size >= maxSessions)
				throw new EditorSessionError({
					code: "SessionLimit",
					message:
						"Too many editor connections. Disconnect an editor and try again.",
					status: 503,
				});
			const credentials = {
				sessionId: randomUUID(),
				mcpToken: randomBytes(32).toString("base64url"),
				editorToken: randomBytes(32).toString("base64url"),
			};
			sessions.set(credentials.sessionId, {
				...credentials,
				createdAt: now(),
				pending: new Map(),
			});
			return credentials;
		},
		authorize(
			sessionId: string,
			token: string | undefined,
			role: "editor" | "mcp",
		) {
			authorize(sessionId, token, role);
		},
		connect(
			sessionId: string,
			token: string | undefined,
			connection: Connection,
		) {
			const session = authorize(sessionId, token, "editor");
			if (session.connection)
				throw new EditorSessionError({
					code: "AlreadyConnected",
					message: "This drawing already has an editor connection.",
					status: 409,
				});
			session.connection = connection;
			return () => remove(session);
		},
		disconnect(sessionId: string, token: string | undefined) {
			remove(authorize(sessionId, token, "editor"));
		},
		acknowledge(
			sessionId: string,
			token: string | undefined,
			requestId: string,
			reply: DrawingReply,
		) {
			const session = authorize(sessionId, token, "editor");
			const pending = session.pending.get(requestId);
			if (!pending || pending.expiresAt <= now())
				throw new EditorSessionError({
					code: "ExpiredRequest",
					message: "This command is no longer waiting for a response.",
					status: 409,
				});
			session.pending.delete(requestId);
			pending.complete(reply);
		},
		request(
			sessionId: string,
			operation: DrawingOperation,
		): Effect.Effect<DrawingReply, EditorSessionError> {
			return Effect.async<DrawingReply, EditorSessionError>((resume) => {
				const session = lookup(sessionId);
				if (!session?.connection) {
					resume(Effect.fail(unavailable()));
					return;
				}
				if (session.pending.size >= maxPending) {
					resume(
						Effect.fail(
							new EditorSessionError({
								code: "EditorBusy",
								message: "Too many commands are waiting for this editor.",
								status: 429,
							}),
						),
					);
					return;
				}
				const requestId = randomUUID();
				const expiresAt = now() + timeoutMs;
				session.pending.set(requestId, {
					expiresAt,
					complete: (reply) => resume(Effect.succeed(reply)),
					fail: (error) => resume(Effect.fail(error)),
				});
				try {
					session.connection.send({ requestId, expiresAt, operation });
				} catch {
					remove(session);
				}
				return Effect.sync(() => {
					session.pending.delete(requestId);
				});
			}).pipe(
				Effect.timeoutFail({
					duration: timeoutMs,
					onTimeout: () =>
						new EditorSessionError({
							code: "EditorTimeout",
							message:
								"The editor did not acknowledge the command. It may have completed; inspect the drawing before retrying.",
							status: 504,
						}),
				}),
			);
		},
		dispose() {
			for (const session of sessions.values()) remove(session);
		},
	};
}

export type EditorSessionHub = ReturnType<typeof makeEditorSessionHub>;
