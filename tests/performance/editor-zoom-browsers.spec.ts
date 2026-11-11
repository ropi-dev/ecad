import { expect, test } from "@playwright/test";
import { budgets } from "./budgets.ts";
import { type BrowserKind, measureZoom } from "./real-browser.ts";

/**
 * A scripted zoom of the empty schematic editor in the Firefox and Google
 * Chrome installed on this machine. Playwright's own browser is not used, so
 * the scenario asks for no page and the harness's CPU throttle does not apply.
 */
for (const kind of ["firefox", "chrome"] satisfies BrowserKind[]) {
	const scenario = `editor-zoom-${kind}` as const;
	test(
		scenario,
		{ tag: ["@editor"] },
		async ({ browserName: _browserName, baseURL }, testInfo) => {
			// Two browser starts when Chrome has to fall back from the GPU.
			test.setTimeout(180_000);
			const result = await measureZoom(kind, `${baseURL}/editor`);
			test.skip(
				"unavailable" in result,
				"unavailable" in result ? result.unavailable : "",
			);
			if ("unavailable" in result) return;
			// The held zoom only measures the hints if they were on screen.
			expect(
				result.hints,
				"shortcut hints during the held zoom",
			).toBeGreaterThan(0);
			const metrics: Record<string, number> = {
				zoomFrameMs: result.zoom.frameMs,
				zoomScriptMs: result.zoom.scriptMs,
				zoomHeldFrameMs: result.zoomHeld.frameMs,
				zoomHeldScriptMs: result.zoomHeld.scriptMs,
				zoomWrites: result.writes,
			};
			for (const [name, value] of Object.entries(metrics)) {
				expect(Number.isFinite(value), `${scenario}.${name}`).toBe(true);
				expect(value, `${scenario}.${name}`).toBeGreaterThan(0);
			}
			await testInfo.attach("performance", {
				body: JSON.stringify({
					scenario,
					metrics,
					report: {
						mode: process.env.ECAD_PERF_MODE ?? "production",
						// Run from Node and never throttled, like the other Node
						// scenarios; the browser measured is named beside it.
						environment: {
							userAgent: `Node/${process.versions.node}`,
							browser: result.userAgent,
							renderer: result.renderer,
							platform: process.platform,
							arch: process.arch,
							cpuThrottle: 1,
						},
						workload: {
							canvas: result.canvas,
							zoomFrames: result.zoom.frames,
							zoomHeldFrames: result.zoomHeld.frames,
							hints: result.hints,
						},
					},
				}),
				contentType: "application/json",
			});
			// The reporter checks the budgets, so a build over a budget still
			// reports its measurements and an A/B run can compare it.
			for (const name of Object.keys(budgets[scenario]))
				expect(
					metrics[name],
					`${scenario}.${name} must be measured`,
				).toBeDefined();
		},
	);
}
