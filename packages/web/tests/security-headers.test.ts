import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	DOCUMENT_CSP,
	SECURITY_HEADERS,
	WORKER_CSP,
} from "#/security-headers.ts";

const config = readFileSync(
	new URL("../../../deploy/nginx/ecad.conf", import.meta.url),
	"utf8",
)
	.split("\n")
	.map((line) => line.replace(/^\s*#.*$/, ""))
	.join("\n");

type Block = { header: string; body: string };

/** Top-level `header { body }` blocks of `source`, with nested blocks kept in the body. */
function blocks(source: string): Block[] {
	const found: Block[] = [];
	let depth = 0;
	let start = 0;
	let headerStart = 0;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		if (char === '"') {
			index = source.indexOf('"', index + 1);
			continue;
		}
		if (char === "{") {
			if (depth === 0) start = index;
			depth++;
		} else if (char === "}") {
			depth--;
			if (depth === 0) {
				const header = source.slice(headerStart, start).trim();
				found.push({
					header: header.slice(header.lastIndexOf(";") + 1).trim(),
					body: source.slice(start + 1, index),
				});
				headerStart = index + 1;
			}
		} else if (char === ";" && depth === 0) headerStart = index + 1;
	}
	return found;
}

/** Directives that sit directly in `body`, outside nested blocks. */
function directives(body: string) {
	const found: string[] = [];
	let depth = 0;
	let current = "";
	for (let index = 0; index < body.length; index++) {
		const char = body[index];
		if (char === '"') {
			const end = body.indexOf('"', index + 1);
			if (depth === 0) current += body.slice(index, end + 1);
			index = end;
		} else if (char === "{") {
			// The text before a nested block is its header, not a directive.
			if (depth === 0) current = "";
			depth++;
		} else if (char === "}") depth--;
		else if (depth === 0 && char === ";") {
			found.push(current.trim().replace(/\s+/g, " "));
			current = "";
		} else if (depth === 0) current += char;
	}
	return found.filter(Boolean);
}

const unquote = (value: string) => value.replace(/^"(.*)"$/, "$1");

function mapEntries(name: string) {
	const map = blocks(config).find((block) =>
		new RegExp(`^map \\$uri \\$${name}$`).test(block.header),
	);
	assert.ok(map, `map for $${name}`);
	return new Map(
		directives(map.body).map((entry) => {
			const match = /^("[^"]*"|\S+)\s+("[^"]*"|\S+)$/.exec(entry);
			assert.ok(match, `map entry ${entry}`);
			return [unquote(match[1]), unquote(match[2])];
		}),
	);
}

const server = blocks(config).find((block) => block.header === "server");

test("nginx sends the shared security headers on every response", () => {
	assert.ok(server);
	const headers = directives(server.body).filter((directive) =>
		directive.startsWith("add_header "),
	);
	assert.ok(
		headers.includes(
			"add_header Content-Security-Policy $ecad_content_security_policy always",
		),
	);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (name === "Content-Security-Policy") continue;
		assert.ok(
			headers.includes(`add_header ${name} "${value}" always`),
			`server sets ${name}`,
		);
	}
});

test("no nginx location drops the server-level headers", () => {
	assert.ok(server);
	const locations = blocks(server.body);
	assert.ok(locations.length > 0);
	for (const location of locations) {
		assert.match(location.header, /^location /);
		assert.ok(
			!/(^|;)\s*add_header\s/.test(location.body),
			`${location.header} must not declare add_header`,
		);
	}
});

test("nginx CSP values match the web app policies", () => {
	const policies = mapEntries("ecad_content_security_policy");
	assert.equal(policies.get("default"), DOCUMENT_CSP);
	const workerPatterns = [...policies.keys()].filter((key) =>
		key.startsWith("~"),
	);
	assert.equal(workerPatterns.length, 1);
	const [workerPattern] = workerPatterns;
	assert.equal(policies.get(workerPattern), WORKER_CSP);
	const worker = new RegExp(workerPattern.slice(1));
	assert.ok(worker.test("/assets/parse.worker-BBuwrgVF.js"));
	assert.ok(worker.test("/assets/archive.worker-CU95AozV.js"));
	assert.ok(!worker.test("/assets/index-DBO4lkXu.js"));
	assert.ok(!worker.test("/_shell.html"));
});

test("policies keep framing, plugins and eval locked down", () => {
	for (const policy of [DOCUMENT_CSP, WORKER_CSP]) {
		assert.match(policy, /(^|; )frame-ancestors 'none'(;|$)/);
		assert.match(policy, /(^|; )object-src 'none'(;|$)/);
		assert.match(policy, /(^|; )connect-src 'self'(;|$)/);
	}
	assert.doesNotMatch(DOCUMENT_CSP, /'unsafe-eval'/);
	assert.equal(SECURITY_HEADERS["Content-Security-Policy"], DOCUMENT_CSP);
});
