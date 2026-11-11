import { readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { viewerTheme } from "@ecad/core/drawing/schematic-theme.ts";
import type { ProjectSnapshot } from "@ecad/core/projects/format.ts";
import {
	app,
	BrowserWindow,
	dialog,
	type IpcMainInvokeEvent,
	ipcMain,
	net,
	protocol,
	screen,
} from "electron";
import {
	appChannels,
	displayChannels,
	type InvokeChannel,
	libraryChannels,
	projectChannels,
	projectEvents,
	settingsChannels,
} from "#/bridge.ts";
import { encodeIpcError } from "#/ipc-errors.ts";
import { readDisplayCalibration } from "#/main/display-calibration.ts";
import { type IpcArguments, parseIpcArguments } from "#/main/ipc.ts";
import {
	ExternalLibraryApprovals,
	type ExternalLibraryRequest,
} from "#/main/library-approvals.ts";
import { DesktopProjects } from "#/main/projects.ts";
import { DesktopSettings } from "#/main/settings.ts";
import { DesktopSymbolLibrary } from "#/main/symbol-library.ts";

protocol.registerSchemesAsPrivileged([
	{
		scheme: "ecad",
		privileges: { standard: true, secure: true, supportFetchAPI: true },
	},
]);

function developmentRendererUrl(): string | undefined {
	const value = process.env.ECAD_RENDERER_URL;
	if (!value || app.isPackaged) return;
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "localhost"].includes(url.hostname) ||
		url.username ||
		url.password
	) {
		throw new Error("The desktop development renderer must use localhost.");
	}
	return url.href;
}

const rendererUrl = developmentRendererUrl() ?? "ecad://app/index.html";
// `electron .` passes the app path before the arguments; a packaged app doesn't.
const directoryArgument = process.argv
	.slice(process.defaultApp ? 2 : 1)
	.find((argument) => !argument.startsWith("-"));
const library = new DesktopSymbolLibrary();
const settings = new DesktopSettings();
const approvals = new ExternalLibraryApprovals({
	chosen: (directory) => library.isChosenDirectory(directory),
	confirm: confirmExternalLibrary,
});
const projects = new DesktopProjects(
	directoryArgument &&
		resolve(process.env.INIT_CWD ?? process.cwd(), directoryArgument),
	{
		approveExternalLibrary: (request, options) =>
			approvals.approve(request, options),
		onExternalChange: (directory) => {
			if (window && !window.isDestroyed())
				window.webContents.send(projectEvents.changed, directory);
		},
	},
);
let window: BrowserWindow | null = null;

async function confirmExternalLibrary({
	project,
	directory,
}: ExternalLibraryRequest) {
	if (!window) return false;
	const saved = isAbsolute(project);
	const { response } = await dialog.showMessageBox(window, {
		type: "warning",
		buttons: ["Don't allow", "Allow"],
		defaultId: 0,
		cancelId: 0,
		message: "Allow this project to use a symbol library outside its folder?",
		detail: [
			`Library: ${directory}`,
			`Project: ${saved ? project : "Untitled project"}`,
			"",
			"ECAD will read symbol files in this directory and save symbol edits there. Allow it only if you trust this project.",
			saved
				? "ECAD remembers an approval in your own settings, not in the project."
				: "This approval lasts until ECAD closes.",
		].join("\n"),
	});
	return response === 1;
}

function assertSender(event: IpcMainInvokeEvent) {
	if (
		!window ||
		event.sender !== window.webContents ||
		event.senderFrame !== window.webContents.mainFrame ||
		event.senderFrame.url !== rendererUrl
	) {
		throw new Error("Filesystem access is limited to the desktop editor.");
	}
}

/** Every handler checks its sender, then validates the renderer's arguments. */
function handle<Channel extends InvokeChannel>(
	channel: Channel,
	run: (...args: IpcArguments<Channel>) => unknown,
) {
	ipcMain.handle(channel, async (event, ...args: unknown[]) => {
		try {
			assertSender(event);
			return await run(...parseIpcArguments(channel, args));
		} catch (cause) {
			throw encodeIpcError(cause);
		}
	});
}

function registerLibraryHandlers() {
	handle(libraryChannels.canWriteConfiguration, () =>
		library.canWriteConfiguration(),
	);
	handle(libraryChannels.inspectDirectorySymbol, (request) => {
		if (request.scope === "user")
			return library.inspectConfiguredSymbol(request.path, request.id);
		if (!request.projectDirectory)
			throw new Error(
				"Open a project before editing project directory symbols.",
			);
		return projects.inspectLibrarySymbol(
			request.projectDirectory,
			request.path,
			request.id,
		);
	});
	handle(libraryChannels.saveDirectorySymbol, (request, original, next) => {
		if (request.id !== original.id)
			throw new Error("The symbol ID does not match its source.");
		if (request.scope === "user")
			return library.saveConfiguredSymbol(request.path, original, next);
		if (!request.projectDirectory)
			throw new Error(
				"Open a project before editing project directory symbols.",
			);
		return projects.saveLibrarySymbol(
			request.projectDirectory,
			request.path,
			original,
			next,
		);
	});
	handle(libraryChannels.loadConfiguration, () => library.loadConfiguration());
	handle(libraryChannels.saveConfiguration, (config) =>
		library.saveConfiguration(config),
	);
	handle(libraryChannels.loadDirectory, (path, scope, projectDirectory) => {
		if (scope === "user") return library.loadConfiguredDirectory(path);
		if (!projectDirectory)
			throw new Error("Open a project before loading project directories.");
		return projects.readSymbolLibrary(projectDirectory, path);
	});
	handle(libraryChannels.openLibraryDirectory, async (name) => {
		if (!window) throw new Error("The desktop editor is closed.");
		const selected = await dialog.showOpenDialog(window, {
			title: "Add symbol library directory",
			properties: ["openDirectory"],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return library.openLibraryDirectory(selected.filePaths[0], name);
	});
	handle(libraryChannels.load, () => library.load());
	handle(libraryChannels.save, (symbols, additions) =>
		library.save(symbols, additions),
	);
	handle(libraryChannels.openDirectory, async () => {
		const owner = window;
		if (!owner) throw new Error("The desktop editor is closed.");
		const selected = await dialog.showOpenDialog(owner, {
			title: "Open symbol directory",
			properties: ["openDirectory"],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return library.openDirectory(selected.filePaths[0]);
	});
}

function registerProjectHandlers() {
	handle(projectChannels.canWriteFile, (directory, path) =>
		projects.canWriteFile(directory, path),
	);
	const selectionFile = join(app.getPath("userData"), "project-directory.json");
	async function remember(snapshot: ProjectSnapshot | null) {
		if (snapshot && !snapshot.inMemory)
			await writeFile(selectionFile, JSON.stringify(snapshot.directory));
		return snapshot;
	}
	handle(projectChannels.load, async () => {
		const current = await projects.load();
		if (current) return current;
		if (!directoryArgument) {
			try {
				const directory = JSON.parse(await readFile(selectionFile, "utf8"));
				if (typeof directory !== "string")
					throw new Error("The saved project directory is invalid.");
				return projects.openDirectory(directory);
			} catch (cause) {
				if (
					!(cause instanceof Error) ||
					!("code" in cause) ||
					cause.code !== "ENOENT"
				)
					throw cause;
			}
		}
		return projects.load();
	});
	handle(projectChannels.create, async (name) => {
		if (name === "Untitled") {
			const snapshot = await projects.createUntitled();
			await rm(selectionFile, { force: true });
			return snapshot;
		}
		if (!window) throw new Error("The desktop editor is closed.");
		const selected = await dialog.showOpenDialog(window, {
			title: "Choose parent directory for the project",
			properties: ["openDirectory", "createDirectory"],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return remember(await projects.create(name, selected.filePaths[0]));
	});
	handle(projectChannels.open, async () => {
		if (!window) throw new Error("The desktop editor is closed.");
		const selected = await dialog.showOpenDialog(window, {
			title: "Open ECAD project directory",
			properties: ["openDirectory"],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return remember(await projects.openDirectory(selected.filePaths[0]));
	});
	handle(projectChannels.saveProject, async (directory) => {
		if (!projects.isInMemory(directory)) return projects.load();
		if (!window) throw new Error("The desktop editor is closed.");
		const selected = await dialog.showOpenDialog(window, {
			title: "Choose parent folder for the project",
			properties: ["openDirectory", "createDirectory"],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return remember(
			await projects.saveToDirectory(directory, selected.filePaths[0]),
		);
	});
	handle(projectChannels.save, (directory, document) =>
		projects.save(directory, document),
	);
	handle(projectChannels.importAssets, (directory, assets) =>
		projects.importAssets(directory, assets),
	);
	handle(projectChannels.saveSettings, (directory, settings) =>
		projects.saveSettings(directory, settings),
	);
	handle(projectChannels.readAsset, (directory, path) =>
		projects.readAsset(directory, path),
	);
	handle(projectChannels.refresh, (directory) => projects.refresh(directory));
}

function registerSettingsHandlers() {
	handle(settingsChannels.load, () => settings.load());
	handle(settingsChannels.save, (next) => settings.save(next));
}

function registerDisplayHandlers() {
	let cached: {
		key: string;
		value: ReturnType<typeof readDisplayCalibration>;
	} | null = null;
	let notification: ReturnType<typeof setTimeout> | undefined;
	const notify = () => {
		clearTimeout(notification);
		notification = setTimeout(() => {
			if (window && !window.isDestroyed())
				window.webContents.send(displayChannels.changed);
		}, 100);
	};
	const invalidate = () => {
		cached = null;
		notify();
	};
	screen.on("display-added", invalidate);
	screen.on("display-removed", invalidate);
	screen.on("display-metrics-changed", invalidate);
	handle(displayChannels.getCalibration, () => {
		if (!window) return null;
		const display = screen.getDisplayMatching(window.getBounds());
		const displays = screen.getAllDisplays();
		const key = JSON.stringify([
			display.id,
			display.size,
			display.rotation,
			display.scaleFactor,
			displays.length,
		]);
		if (cached?.key !== key)
			cached = { key, value: readDisplayCalibration(display, displays.length) };
		return cached.value;
	});
	app.on("browser-window-created", (_event, owner) => {
		owner.on("move", notify);
		owner.on("resize", notify);
	});
	app.on("will-quit", () => clearTimeout(notification));
}

/** The removed View menu used to provide these. */
function isDevToolsShortcut(input: Electron.Input) {
	if (input.key === "F12") return !input.control && !input.alt && !input.meta;
	return (
		input.control &&
		input.shift &&
		!input.alt &&
		!input.meta &&
		input.key.toLowerCase() === "i"
	);
}

function createWindow() {
	window = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 720,
		minHeight: 480,
		title: "ECAD desktop",
		// The app background, so the window does not flash before the page paints.
		backgroundColor: viewerTheme.background,
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	// The sidebar holds the app's commands, so Linux and Windows drop the
	// default File/Edit/View menu bar. macOS keeps its app menu at the top of
	// the screen, which also provides the standard Cmd shortcuts.
	window.removeMenu();
	window.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown" || !isDevToolsShortcut(input)) return;
		event.preventDefault();
		window?.webContents.toggleDevTools();
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-prevent-unload", (event) => {
		if (!window) return;
		const choice = dialog.showMessageBoxSync(window, {
			type: "warning",
			buttons: ["Keep working", "Discard changes"],
			defaultId: 0,
			cancelId: 0,
			message: "This project has unsaved changes.",
			detail: "Choose Save project to keep your work before closing.",
		});
		if (choice === 1) event.preventDefault();
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url !== rendererUrl) event.preventDefault();
	});
	window.webContents.session.setPermissionRequestHandler(
		(_contents, _permission, reply) => reply(false),
	);
	// Watcher events can be missed, for example on network filesystems.
	window.on("focus", () => void projects.checkExternalChanges());
	window.on("closed", () => {
		window = null;
	});
	void window.loadURL(rendererUrl);
}

void app.whenReady().then(() => {
	const rendererDirectory = resolve(__dirname, "renderer");
	protocol.handle("ecad", async (request) => {
		const url = new URL(request.url);
		if (url.hostname !== "app") return new Response(null, { status: 404 });
		const requested = resolve(
			rendererDirectory,
			`.${decodeURIComponent(url.pathname)}`,
		);
		const suffix = relative(rendererDirectory, requested);
		if (suffix.startsWith("..") || isAbsolute(suffix)) {
			return new Response(null, { status: 403 });
		}
		const response = await net.fetch(pathToFileURL(requested).href);
		const headers = new Headers(response.headers);
		// OCCT's bundled WASM loader evaluates generated code inside its worker.
		const scriptPolicy = url.pathname.includes(".worker-")
			? "'self' 'unsafe-eval'"
			: "'self' 'wasm-unsafe-eval'";
		headers.set(
			"Content-Security-Policy",
			`default-src 'self'; script-src ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'`,
		);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	});
	registerLibraryHandlers();
	registerProjectHandlers();
	registerSettingsHandlers();
	registerDisplayHandlers();
	handle(appChannels.quit, () => app.quit());
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
	app.on("will-quit", () => projects.close());
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
});
