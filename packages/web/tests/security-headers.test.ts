import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DOCUMENT_CSP,
	SECURITY_HEADERS,
	WORKER_CSP,
} from "#/security-headers.ts";

test("policies keep framing, plugins and eval locked down", () => {
	for (const policy of [DOCUMENT_CSP, WORKER_CSP]) {
		assert.match(policy, /(^|; )frame-ancestors 'none'(;|$)/);
		assert.match(policy, /(^|; )object-src 'none'(;|$)/);
		assert.match(policy, /(^|; )connect-src 'self'(;|$)/);
	}
	assert.doesNotMatch(DOCUMENT_CSP, /'unsafe-eval'/);
	assert.equal(SECURITY_HEADERS["Content-Security-Policy"], DOCUMENT_CSP);
});
