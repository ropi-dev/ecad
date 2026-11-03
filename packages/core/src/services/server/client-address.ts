import { isIP } from "node:net";
import { unknownEditorClient } from "#/services/server/editor-sessions.ts";

/**
 * Reads `ECAD_TRUSTED_PROXY_HOPS` for each request: the number of reverse proxies in front
 * of the app that append the connecting address to `X-Forwarded-For`. Defaults to 0.
 */
export function trustedProxyHopsFromEnv() {
	const value = globalThis.process?.env?.ECAD_TRUSTED_PROXY_HOPS?.trim();
	if (!value || !/^\d{1,2}$/.test(value)) return 0;
	return Number(value);
}

/** The runtime's peer address: srvx and Nitro expose it as `request.ip`. */
export function requestPeerAddress(request: Request) {
	const ip = (request as { ip?: unknown }).ip;
	return typeof ip === "string" && ip ? ip : undefined;
}

/**
 * Picks the client address without trusting client-supplied forwarding headers.
 *
 * With no trusted proxies, only the peer address is used. Each trusted proxy appends the
 * address it received the request from, so the client is the entry `trustedProxyHops`
 * places from the right; entries further left were written by the client and are ignored.
 * Vercel overwrites `X-Forwarded-For` with the client address, and Nitro already exposes
 * it as the peer address there, so Vercel needs no trusted hops.
 */
export function editorClientAddress(
	request: Request,
	peerAddress: string | undefined,
	trustedProxyHops: number,
) {
	if (trustedProxyHops <= 0) return peerAddress;
	const forwarded = (request.headers.get("x-forwarded-for") ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const chain = [peerAddress, ...forwarded.reverse()];
	return chain[Math.min(trustedProxyHops, chain.length - 1)];
}

/** Expands a valid IPv6 address, including an embedded dotted IPv4 tail, into 8 groups. */
function ipv6Groups(address: string) {
	let text = address;
	const embedded = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
	if (embedded) {
		const [a, b, c, d] = embedded.slice(1).map(Number);
		text = `${text.slice(0, embedded.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const [head, tail] = text.split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups =
		tail === undefined
			? left
			: [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
	return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * Groups addresses into per-client keys: one IPv4 address, or one IPv6 /64 network,
 * since a single IPv6 host can usually choose any address in its /64. IPv4-mapped
 * IPv6 addresses (`::ffff:0:0/96`) count as their IPv4 address in any notation.
 */
export function editorClientKey(address: string | undefined) {
	let value = address?.trim() ?? "";
	if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
	const zone = value.indexOf("%");
	if (zone !== -1) value = value.slice(0, zone);
	switch (isIP(value)) {
		case 4:
			return value;
		case 6: {
			const groups = ipv6Groups(value);
			if (
				groups.slice(0, 5).every((group) => group === 0) &&
				groups[5] === 0xffff
			)
				return [
					groups[6] >> 8,
					groups[6] & 0xff,
					groups[7] >> 8,
					groups[7] & 0xff,
				].join(".");
			return `${groups
				.slice(0, 4)
				.map((group) => group.toString(16))
				.join(":")}::/64`;
		}
		default:
			return unknownEditorClient;
	}
}
