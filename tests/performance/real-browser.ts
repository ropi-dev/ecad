import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Drives the Firefox or Google Chrome installed on this machine, headless,
 * through a scripted zoom of the schematic editor.
 *
 * The other browser scenarios run Playwright's Chromium. This reaches the
 * engines people use, to catch per-frame script, style and layout work that
 * only one of them makes expensive. It speaks WebDriver BiDi to Firefox and
 * the DevTools protocol to Chrome over Node's WebSocket, so it needs no
 * browser download and no dependency.
 */
export type BrowserKind = "firefox" | "chrome";

export interface ZoomPhase {
	frames: number;
	/** Mean time between frames with the frame-rate limit lifted. */
	frameMs: number;
	/** Mean script time per frame: animation callbacks and their microtasks. */
	scriptMs: number;
}

export interface ZoomMeasurement {
	userAgent: string;
	/** The WebGL renderer, which tells a GPU from software rendering. */
	renderer: string;
	canvas: [width: number, height: number];
	zoom: ZoomPhase;
	/** The same zoom with Ctrl held, so the shortcut hints are shown. */
	zoomHeld: ZoomPhase;
	/** Shortcut hints on screen at the end of the held zoom. */
	hints: number;
	/** DOM attribute writes per zoom frame. */
	writes: number;
}

/** Why a browser was not measured on this machine. */
export interface Unavailable {
	unavailable: string;
}

const WIDTH = 1600;
const HEIGHT = 1000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Wraps animation callbacks to time them. Runs before the page's scripts. */
const preload = `() => {
	const state = (window.__zoomProbe = { on: false, frames: [], script: [] });
	const request = window.requestAnimationFrame.bind(window);
	let current = -1;
	window.requestAnimationFrame = (callback) =>
		request((time) => {
			if (!state.on) return callback(time);
			if (time !== current) {
				current = time;
				state.frames.push(time);
				state.script.push(0);
			}
			const index = state.script.length - 1;
			const started = performance.now();
			try {
				callback(time);
			} finally {
				// Queued after the callback's own microtasks, so synchronous
				// React work the callback schedules is included.
				queueMicrotask(() => {
					state.script[index] += performance.now() - started;
				});
			}
		});
}`;

const webglRenderer = `(() => {
	const gl = document.createElement("canvas").getContext("webgl2");
	if (!gl) return "";
	const info = gl.getExtension("WEBGL_debug_renderer_info");
	return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown");
})()`;

const editorReady = `(async () => {
	const deadline = performance.now() + 30000;
	const ready = () => {
		const fit = [...document.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "Fit drawing",
		);
		return document.querySelector("canvas") && fit && !fit.disabled &&
			document.querySelectorAll("[data-axis]").length > 1;
	};
	while (!ready()) {
		if (performance.now() > deadline) throw new Error("The editor did not become ready.");
		await new Promise((done) => setTimeout(done, 100));
	}
	await new Promise((done) => setTimeout(done, 1000));
	const canvas = document.querySelector("canvas");
	return JSON.stringify({ userAgent: navigator.userAgent, canvas: [canvas.width, canvas.height] });
})()`;

/**
 * Page-side gestures. A zoom dispatches one Ctrl + wheel event per frame, in
 * for 300 ms and out for 300 ms, at a speed that does not depend on the frame
 * rate.
 */
const gestures = `(() => {
	const state = window.__zoomProbe;
	const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
	const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
	const key = (type) =>
		document.body.dispatchEvent(
			new KeyboardEvent(type, { key: "Control", code: "ControlLeft", ctrlKey: type === "keydown", bubbles: true, cancelable: true }),
		);
	const zoom = (ms, held, each) =>
		new Promise((resolve) => {
			const canvas = document.querySelector("canvas");
			const rect = canvas.getBoundingClientRect();
			const started = performance.now();
			let last = started;
			const tick = () => {
				const now = performance.now();
				if (now - started >= ms) return resolve();
				const elapsed = Math.min(now - last, 50);
				last = now;
				each?.();
				// The controls multiply a Ctrl wheel by ten unless they saw the
				// Control key go down, as for a trackpad pinch.
				canvas.dispatchEvent(
					new WheelEvent("wheel", {
						deltaY: (Math.floor((now - started) / 300) % 2 === 0 ? -1 : 1) * Math.max(elapsed, 0.2) * (held ? 4.5 : 0.45),
						ctrlKey: true,
						clientX: rect.left + rect.width / 2,
						clientY: rect.top + rect.height / 2,
						bubbles: true,
						cancelable: true,
					}),
				);
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
	window.__zoomProbeRun = async (ms, held) => {
		if (held) {
			key("keydown");
			// Hints appear after the key has been held for a second.
			await sleep(1300);
		}
		state.frames = [];
		state.script = [];
		state.on = true;
		await zoom(ms, held);
		state.on = false;
		const hints = document.querySelectorAll('[data-slot="button-shortcut"]').length;
		if (held) key("keyup");
		const frames = state.frames;
		await sleep(300);
		return JSON.stringify({
			frames: frames.length,
			frameMs: frames.length > 1 ? (frames.at(-1) - frames[0]) / (frames.length - 1) : 0,
			scriptMs: mean(state.script),
			hints,
		});
	};
	// Counted apart from the timed zooms, since the observer adds work.
	window.__zoomProbeWrites = async (ms) => {
		let writes = 0;
		let frames = 0;
		const observer = new MutationObserver((records) => {
			writes += records.length;
		});
		observer.observe(document.documentElement, { subtree: true, attributes: true });
		await zoom(ms, false, () => frames++);
		await sleep(100);
		writes += observer.takeRecords().length;
		observer.disconnect();
		return String(writes / Math.max(frames, 1));
	};
	return "ready";
})()`;

/** A JSON-RPC connection over a WebSocket, as BiDi and the DevTools protocol use. */
async function connect(address: string) {
	const socket = new WebSocket(address);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener(
			"error",
			() => reject(new Error(`Cannot connect to ${address}.`)),
			{ once: true },
		);
	});
	let id = 0;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data));
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.type === "error" || message.error)
			waiter.reject(
				new Error(JSON.stringify(message.error ?? message).slice(0, 500)),
			);
		else waiter.resolve(message.result);
	});
	return {
		// biome-ignore lint/suspicious/noExplicitAny: protocol results are read by field
		send(method: string, params: object = {}, timeout = 45_000): Promise<any> {
			return new Promise((resolve, reject) => {
				const call = ++id;
				const timer = setTimeout(() => {
					pending.delete(call);
					reject(new Error(`${method} timed out.`));
				}, timeout);
				pending.set(call, {
					resolve: (value) => {
						clearTimeout(timer);
						resolve(value);
					},
					reject: (error) => {
						clearTimeout(timer);
						reject(error);
					},
				});
				socket.send(JSON.stringify({ id: call, method, params }));
			});
		},
		close: () => socket.close(),
	};
}

/** One page in a started browser. */
interface Session {
	/** Evaluates an expression, awaiting a promise, and returns its string value. */
	evaluate(expression: string): Promise<string>;
	/** Registers a function to run in every new document before its scripts. */
	preload(source: string): Promise<void>;
	navigate(url: string): Promise<void>;
	close(): Promise<void>;
}

/** A way to start an installed browser. */
interface Launcher {
	command: string;
	args: string[];
	/** A folder the browser can write a throwaway profile under. */
	profiles: string;
}

const onPath = (name: string) => {
	const found = spawnSync("sh", ["-c", `command -v ${name}`], {
		encoding: "utf8",
	});
	return found.status === 0 ? found.stdout.trim() : undefined;
};

/** Ways to start the browser, most preferred first. */
function launchers(kind: BrowserKind): Launcher[] {
	const override =
		process.env[kind === "firefox" ? "ECAD_PERF_FIREFOX" : "ECAD_PERF_CHROME"];
	const temporary = join(tmpdir(), "ecad-perf-browsers");
	if (override) return [{ command: override, args: [], profiles: temporary }];
	const found: Launcher[] = [];
	if (kind === "firefox") {
		// A snap cannot read /tmp, so its profile lives in the snap's own data.
		// Its launcher needs privileges some shells lack; the binary inside the
		// snap then still runs, with the host's libraries.
		const snapData = join(homedir(), "snap/firefox/common");
		for (const command of [
			"/snap/bin/firefox",
			"/snap/firefox/current/usr/lib/firefox/firefox",
		])
			if (existsSync(command))
				found.push({ command, args: [], profiles: snapData });
		for (const command of [
			"/usr/lib/firefox/firefox",
			"/usr/lib64/firefox/firefox",
			"/opt/firefox/firefox",
			onPath("firefox"),
		])
			if (
				command &&
				existsSync(command) &&
				!found.some((item) => item.command === command)
			)
				found.push({ command, args: [], profiles: temporary });
	} else {
		for (const command of [
			"/opt/google/chrome/chrome",
			onPath("google-chrome-stable"),
			onPath("google-chrome"),
		])
			if (
				command &&
				existsSync(command) &&
				!found.some((item) => item.command === command)
			)
				found.push({ command, args: [], profiles: temporary });
		if (
			onPath("flatpak") &&
			spawnSync("flatpak", ["info", "com.google.Chrome"]).status === 0
		)
			// A flatpak can only write inside its own data folder.
			found.push({
				command: "flatpak",
				args: ["run", "com.google.Chrome"],
				profiles: join(homedir(), ".var/app/com.google.Chrome"),
			});
	}
	return found;
}

function stop(child: ChildProcess | undefined) {
	if (!child?.pid || child.exitCode !== null) return;
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {}
}

/**
 * Waits for a file the browser writes once its debugging port is open.
 * Returns null when the browser exits or the time runs out first.
 */
async function portFile(path: string, child: ChildProcess, timeout = 40_000) {
	// A command that cannot be started reports an error instead of exiting.
	let failed = false;
	child.once("error", () => {
		failed = true;
	});
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			const content = readFileSync(path, "utf8");
			if (content.trim()) return content;
		}
		if (failed || child.exitCode !== null) return null;
		await sleep(100);
	}
	return null;
}

/**
 * Headless Firefox needs an X display to create a WebGL context. Without one,
 * this starts a private Xvfb when it is installed.
 */
async function display(): Promise<{ name?: string; stop: () => void }> {
	if (process.env.DISPLAY) return { name: process.env.DISPLAY, stop() {} };
	if (!onPath("Xvfb")) return { stop() {} };
	// Xvfb picks a free display and writes its number to the extra descriptor.
	const server = spawn(
		"Xvfb",
		["-displayfd", "3", "-screen", "0", "1920x1200x24", "-nolisten", "tcp"],
		{ stdio: ["ignore", "ignore", "ignore", "pipe"], detached: true },
	);
	const number = await new Promise<string>((resolve) => {
		let text = "";
		const timer = setTimeout(() => resolve(""), 10_000);
		server.stdio[3]?.on("data", (chunk: Buffer) => {
			text += chunk.toString();
			if (text.includes("\n")) {
				clearTimeout(timer);
				resolve(text.trim());
			}
		});
		server.once("exit", () => {
			clearTimeout(timer);
			resolve("");
		});
	});
	if (!number) {
		stop(server);
		return { stop() {} };
	}
	return { name: `:${number}`, stop: () => stop(server) };
}

async function startFirefox(launcher: Launcher): Promise<Session | null> {
	mkdirSync(launcher.profiles, { recursive: true });
	const profile = mkdtempSync(join(launcher.profiles, "ecad-perf-"));
	const screen = await display();
	const preferences: Record<string, string | number | boolean> = {
		"browser.shell.checkDefaultBrowser": false,
		"browser.startup.homepage_override.mstone": "ignore",
		"browser.aboutwelcome.enabled": false,
		"browser.startup.page": 0,
		"browser.sessionstore.resume_from_crash": false,
		"browser.tabs.warnOnClose": false,
		"browser.warnOnQuit": false,
		"datareporting.policy.dataSubmissionEnabled": false,
		"datareporting.healthreport.uploadEnabled": false,
		"toolkit.telemetry.reportingpolicy.firstRun": false,
		"app.update.auto": false,
		"extensions.update.enabled": false,
		"privacy.reduceTimerPrecision": false,
		"remote.active-protocols": 1,
		// Lift the frame-rate limit, so a frame takes as long as its work.
		"layout.frame_rate": 0,
		"layers.offmainthreadcomposition.frame-rate": 0,
	};
	writeFileSync(
		join(profile, "user.js"),
		Object.entries(preferences)
			.map(
				([name, value]) =>
					`user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`,
			)
			.join("\n"),
	);
	const child = spawn(
		launcher.command,
		[
			...launcher.args,
			"--profile",
			profile,
			"--no-remote",
			"--new-instance",
			"--headless",
			"--remote-debugging-port=0",
			"--width",
			String(WIDTH),
			"--height",
			String(HEIGHT),
			"about:blank",
		],
		{
			stdio: "ignore",
			detached: true,
			env: { ...process.env, ...(screen.name ? { DISPLAY: screen.name } : {}) },
		},
	);
	const cleanup = () => {
		stop(child);
		screen.stop();
		rmSync(profile, { recursive: true, force: true });
	};
	try {
		const port = await portFile(
			join(profile, "WebDriverBiDiServer.json"),
			child,
		);
		if (!port) {
			cleanup();
			return null;
		}
		const { ws_host: host, ws_port: wsPort } = JSON.parse(port);
		const socket = await connect(`ws://${host}:${wsPort}/session`);
		await socket.send("session.new", { capabilities: {} });
		// A fresh profile can open its own first-run tab, and a background tab
		// gets no animation frames.
		const { context } = await socket.send("browsingContext.create", {
			type: "tab",
		});
		await socket.send("browsingContext.activate", { context });
		return {
			async evaluate(expression) {
				const result = await socket.send(
					"script.evaluate",
					{
						expression,
						target: { context },
						awaitPromise: true,
						resultOwnership: "none",
					},
					90_000,
				);
				if (result.type !== "success")
					throw new Error(
						String(result.exceptionDetails?.text ?? JSON.stringify(result)),
					);
				return String(result.result.value);
			},
			async preload(source) {
				await socket.send("script.addPreloadScript", {
					functionDeclaration: source,
				});
			},
			async navigate(url) {
				await socket.send("browsingContext.navigate", {
					context,
					url,
					wait: "complete",
				});
			},
			async close() {
				await socket.send("browser.close", {}, 5_000).catch(() => {});
				socket.close();
				await sleep(500);
				cleanup();
			},
		};
	} catch (error) {
		cleanup();
		throw error;
	}
}

async function startChrome(
	launcher: Launcher,
	flags: string[],
): Promise<Session | null> {
	mkdirSync(launcher.profiles, { recursive: true });
	const profile = mkdtempSync(join(launcher.profiles, "ecad-perf-"));
	const child = spawn(
		launcher.command,
		[
			...launcher.args,
			"--remote-debugging-port=0",
			"--remote-allow-origins=*",
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-sync",
			"--password-store=basic",
			`--window-size=${WIDTH},${HEIGHT}`,
			"--headless=new",
			// Lift the frame-rate limit, so a frame takes as long as its work.
			"--disable-frame-rate-limit",
			"--disable-gpu-vsync",
			...flags,
			"about:blank",
		],
		{ stdio: "ignore", detached: true },
	);
	const cleanup = () => {
		stop(child);
		rmSync(profile, { recursive: true, force: true });
	};
	try {
		const port = await portFile(join(profile, "DevToolsActivePort"), child);
		if (!port) {
			cleanup();
			return null;
		}
		const origin = `http://127.0.0.1:${port.split("\n")[0].trim()}`;
		let target: { webSocketDebuggerUrl: string } | undefined;
		for (let attempt = 0; attempt < 100 && !target; attempt++) {
			const pages: { type: string; webSocketDebuggerUrl: string }[] =
				await fetch(`${origin}/json/list`).then(
					(response) => response.json(),
					() => [],
				);
			target = pages.find((page) => page.type === "page");
			if (!target) await sleep(100);
		}
		if (!target) {
			cleanup();
			return null;
		}
		const socket = await connect(target.webSocketDebuggerUrl);
		await socket.send("Page.enable");
		return {
			async evaluate(expression) {
				const result = await socket.send(
					"Runtime.evaluate",
					{ expression, awaitPromise: true, returnByValue: true },
					90_000,
				);
				if (result.exceptionDetails)
					throw new Error(
						String(
							result.exceptionDetails.exception?.description ??
								JSON.stringify(result.exceptionDetails),
						),
					);
				return String(result.result.value);
			},
			async preload(source) {
				await socket.send("Page.addScriptToEvaluateOnNewDocument", {
					source: `(${source})()`,
				});
			},
			async navigate(url) {
				await socket.send("Page.navigate", { url });
				await sleep(500);
			},
			async close() {
				await socket.send("Browser.close", {}, 5_000).catch(() => {});
				socket.close();
				await sleep(500);
				cleanup();
			},
		};
	} catch (error) {
		cleanup();
		throw error;
	}
}

/**
 * Starts the browser with a page that has WebGL, trying each way to launch
 * it. Chrome is tried on the GPU through Vulkan first, since headless Chrome
 * otherwise falls back to software rendering on some drivers.
 */
async function start(
	kind: BrowserKind,
): Promise<{ session: Session; renderer: string } | Unavailable> {
	const candidates = launchers(kind);
	if (!candidates.length)
		return {
			unavailable: `${kind === "firefox" ? "Firefox" : "Google Chrome"} is not installed.`,
		};
	let reason = "it did not start";
	for (const launcher of candidates)
		for (const flags of kind === "chrome"
			? [["--use-angle=vulkan"], []]
			: [[]]) {
			const session = await (kind === "firefox"
				? startFirefox(launcher)
				: startChrome(launcher, flags)
			).catch(() => null);
			if (!session) continue;
			const renderer = await session.evaluate(webglRenderer).catch(() => "");
			if (renderer) return { session, renderer };
			reason =
				kind === "firefox" && !process.env.DISPLAY && !onPath("Xvfb")
					? "it has no WebGL without an X display; install xvfb"
					: "it could not create a WebGL context";
			await session.close();
		}
	return {
		unavailable: `${kind === "firefox" ? "Firefox" : "Google Chrome"} cannot be measured here: ${reason}.`,
	};
}

/**
 * Measures a scripted zoom of the editor at `url` in an installed browser.
 * Returns why not when the browser is missing or cannot render WebGL here; a
 * failure after the editor has loaded throws.
 */
export async function measureZoom(
	kind: BrowserKind,
	url: string,
): Promise<ZoomMeasurement | Unavailable> {
	const started = await start(kind);
	if ("unavailable" in started) return started;
	const { session, renderer } = started;
	try {
		await session.preload(preload);
		await session.navigate(url);
		const page: { userAgent: string; canvas: [number, number] } = JSON.parse(
			await session.evaluate(editorReady),
		);
		await session.evaluate(gestures);
		const run = async (ms: number, held: boolean) =>
			JSON.parse(
				await session.evaluate(`window.__zoomProbeRun(${ms}, ${held})`),
			) as ZoomPhase & { hints: number };
		// One unmeasured zoom compiles shaders and warms the JIT.
		await run(600, false);
		const zoom = await run(2500, false);
		const zoomHeld = await run(2500, true);
		const writes = Number(
			await session.evaluate("window.__zoomProbeWrites(1500)"),
		);
		return {
			userAgent: page.userAgent,
			renderer,
			canvas: page.canvas,
			zoom: {
				frames: zoom.frames,
				frameMs: zoom.frameMs,
				scriptMs: zoom.scriptMs,
			},
			zoomHeld: {
				frames: zoomHeld.frames,
				frameMs: zoomHeld.frameMs,
				scriptMs: zoomHeld.scriptMs,
			},
			hints: zoomHeld.hints,
			writes,
		};
	} finally {
		await session.close();
	}
}
