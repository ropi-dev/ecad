// Response headers for the hosted web app. The Nitro route rules in
// vite.config.ts send them on Vercel.

const sharedDirectives = [
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' blob: data:",
	"worker-src 'self'",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
];

/**
 * Policy for documents. The prerendered TanStack Start shell carries inline
 * scroll-restoration and hydration scripts whose contents change with every
 * build (and, when server rendered, every request), so they cannot be hashed
 * into a fixed header value.
 */
export const DOCUMENT_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
	...sharedDirectives,
].join("; ");

/**
 * Policy for bundled worker scripts. OCCT's WASM loader evaluates generated
 * code inside the STEP worker, as in the desktop renderer policy.
 */
export const WORKER_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-eval'",
	...sharedDirectives,
].join("; ");

export const SECURITY_HEADERS = {
	"Content-Security-Policy": DOCUMENT_CSP,
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
} as const;
