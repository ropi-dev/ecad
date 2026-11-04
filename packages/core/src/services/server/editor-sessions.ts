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
	/**
	 * `isPending` reports whether the command still waits for its reply, so a
	 * queued command can be dropped once it times out or is cancelled. Throwing an
	 * `EditorSessionError` fails only this command; other errors disconnect.
	 */
	send: (message: DrawingEnvelope, isPending: () => boolean) => void;
	close: () => void;
}

interface Session extends EditorSessionCredentials {
	clientKey: string;
	createdAt: number;
	/** Last MCP use or editor connection; stream heartbeats do not count. */
	lastActiveAt: number;
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

/** Sessions created without a client key share one bucket of the per-client cap. */
export const unknownEditorClient = "unknown";

/** Routes complete commands to one explicitly connected editor. It owns no drawing data. */
export function makeEditorSessionHub({
	timeoutMs = 15_000,
	unconnectedTtlMs = 60_000,
	idleTimeoutMs = 30 * 60_000,
	maxLifetimeMs = 8 * 60 * 60_000,
	maxSessions = 100,
	maxSessionsPerClient = 4,
	maxPending = 128,
	sweepIntervalMs = 15_000,
	now = Date.now,
}: {
	timeoutMs?: number;
	/** A created session must open its editor stream within this time. */
	unconnectedTtlMs?: number;
	/** A connected session closes after this long without an MCP request. */
	idleTimeoutMs?: number;
	/** A session closes this long after creation, regardless of activity. */
	maxLifetimeMs?: number;
	maxSessions?: number;
	/** Concurrent sessions for one client key, so one client cannot hold the whole pool. */
	maxSessionsPerClient?: number;
	maxPending?: number;
	/** How often expired sessions are closed; 0 leaves expiry to lookups and `sweep`. */
	sweepIntervalMs?: number;
	now?: () => number;
} = {}) {
	const sessions = new Map<string, Session>();
	let sweeper: ReturnType<typeof setInterval> | undefined;
	const expired = (session: Session, time: number) =>
		session.connection
			? time - session.lastActiveAt >= idleTimeoutMs ||
				time - session.createdAt >= maxLifetimeMs
			: time - session.createdAt >= unconnectedTtlMs;
	const sweep = () => {
		const time = now();
		for (const session of sessions.values())
			if (expired(session, time)) remove(session);
	};
	// The timer only runs while sessions exist and never keeps the process alive.
	const scheduleSweep = () => {
		if (sessions.size === 0) {
			clearInterval(sweeper);
			sweeper = undefined;
		} else if (!sweeper && sweepIntervalMs > 0) {
			sweeper = setInterval(sweep, sweepIntervalMs);
			(sweeper as { unref?: () => void }).unref?.();
		}
	};
	const remove = (session: Session) => {
		if (!sessions.delete(session.sessionId)) return;
		scheduleSweep();
		const connection = session.connection;
		session.connection = undefined;
		for (const pending of session.pending.values()) pending.fail(unavailable());
		session.pending.clear();
		connection?.close();
	};
	const lookup = (sessionId: string) => {
		const session = sessions.get(sessionId);
		if (session && expired(session, now())) {
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
		if (role === "mcp") session.lastActiveAt = now();
		return session;
	};
	return {
		/** `clientKey` identifies the requesting client; see `editorClientKey`. */
		create(clientKey = unknownEditorClient): EditorSessionCredentials {
			sweep();
			let clientSessions = 0;
			for (const session of sessions.values())
				if (session.clientKey === clientKey) clientSessions++;
			if (clientSessions >= maxSessionsPerClient)
				throw new EditorSessionError({
					code: "ClientSessionLimit",
					message:
						"Too many editor connections from this network. Disable MCP in another drawing and try again.",
					status: 429,
				});
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
			const createdAt = now();
			sessions.set(credentials.sessionId, {
				...credentials,
				clientKey,
				createdAt,
				lastActiveAt: createdAt,
				pending: new Map(),
			});
			scheduleSweep();
			return credentials;
		},
		/** Close every expired session and its editor stream. */
		sweep,
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
			session.lastActiveAt = now();
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
				session.lastActiveAt = now();
				const requestId = randomUUID();
				const expiresAt = now() + timeoutMs;
				session.pending.set(requestId, {
					expiresAt,
					complete: (reply) => resume(Effect.succeed(reply)),
					fail: (error) => resume(Effect.fail(error)),
				});
				try {
					session.connection.send(
						{ requestId, expiresAt, operation },
						() => (session.pending.get(requestId)?.expiresAt ?? 0) > now(),
					);
				} catch (error) {
					if (!(error instanceof EditorSessionError)) remove(session);
					else if (session.pending.delete(requestId))
						resume(Effect.fail(error));
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
			clearInterval(sweeper);
			sweeper = undefined;
		},
	};
}

export type EditorSessionHub = ReturnType<typeof makeEditorSessionHub>;
