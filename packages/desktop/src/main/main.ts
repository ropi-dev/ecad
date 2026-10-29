import { readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	SymbolFile,
	SymbolLibrary,
} from "@ecad/core/components/editor/symbolFormat.ts";
import type {
	AssetKind,
	ProjectDocument,
	ProjectSnapshot,
} from "@ecad/core/projects/format.ts";
import type {
	LibraryScope,
	SymbolLibraryConfig,
} from "@ecad/core/symbol-library/config.ts";
import type { DirectorySymbolRequest } from "@ecad/core/symbol-library/storage.tsx";
import {
	app,
	BrowserWindow,
	dialog,
	type IpcMainInvokeEvent,
	ipcMain,
	net,
	protocol,
} from "electron";
import { libraryChannels, projectChannels } from "#/bridge.ts";
import { DesktopProjects } from "#/main/projects.ts";
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
const directoryArgument = process.argv
	.slice(2)
	.find((argument) => !argument.startsWith("-"));
const library = new DesktopSymbolLibrary();
const projects = new DesktopProjects(
	directoryArgument &&
		resolve(process.env.INIT_CWD ?? process.cwd(), directoryArgument),
);
let window: BrowserWindow | null = null;

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

function registerLibraryHandlers() {
	ipcMain.handle(libraryChannels.canWriteConfiguration, (event) => {
		assertSender(event);
		return library.canWriteConfiguration();
	});
	ipcMain.handle(
		libraryChannels.inspectDirectorySymbol,
		(event, request: DirectorySymbolRequest) => {
			assertSender(event);
			if (request.scope === "user")
				return library.inspectConfiguredSymbol(request.path, request.id);
			if (request.scope !== "project" || !request.projectDirectory)
				throw new Error(
					"Open a project before editing project directory symbols.",
				);
			return projects.inspectLibrarySymbol(
				request.projectDirectory,
				request.path,
				request.id,
			);
		},
	);
	ipcMain.handle(
		libraryChannels.saveDirectorySymbol,
		(
			event,
			request: DirectorySymbolRequest,
			original: SymbolFile,
			next: SymbolFile,
		) => {
			assertSender(event);
			if (request.id !== original.id)
				throw new Error("The symbol ID does not match its source.");
			if (request.scope === "user")
				return library.saveConfiguredSymbol(request.path, original, next);
			if (request.scope !== "project" || !request.projectDirectory)
				throw new Error(
					"Open a project before editing project directory symbols.",
				);
			return projects.saveLibrarySymbol(
				request.projectDirectory,
				request.path,
				original,
				next,
			);
		},
	);
	ipcMain.handle(libraryChannels.loadConfiguration, (event) => {
		assertSender(event);
		return library.loadConfiguration();
	});
	ipcMain.handle(
		libraryChannels.saveConfiguration,
		(event, config: SymbolLibraryConfig) => {
			assertSender(event);
			return library.saveConfiguration(config);
		},
	);
	ipcMain.handle(
		libraryChannels.loadDirectory,
		(event, path: string, scope: LibraryScope, projectDirectory?: string) => {
			assertSender(event);
			if (scope === "user") return library.loadConfiguredDirectory(path);
			if (scope !== "project" || !projectDirectory)
				throw new Error("Open a project before loading project directories.");
			return projects.readSymbolLibrary(projectDirectory, path);
		},
	);
	ipcMain.handle(
		libraryChannels.openLibraryDirectory,
		async (event, name: string) => {
			assertSender(event);
			if (!window) throw new Error("The desktop editor is closed.");
			const selected = await dialog.showOpenDialog(window, {
				title: "Add symbol library directory",
				properties: ["openDirectory"],
			});
			if (selected.canceled || !selected.filePaths[0]) return null;
			return library.openLibraryDirectory(selected.filePaths[0], name);
		},
	);
	ipcMain.handle(libraryChannels.load, (event) => {
		assertSender(event);
		return library.load();
	});
	ipcMain.handle(
		libraryChannels.save,
		(event, symbols: SymbolLibrary, additions: SymbolLibrary) => {
			assertSender(event);
			return library.save(symbols, additions);
		},
	);
	ipcMain.handle(libraryChannels.openDirectory, async (event) => {
		assertSender(event);
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
	ipcMain.handle(
		projectChannels.canWriteFile,
		(event, directory: string, path: string) => {
			assertSender(event);
			return projects.canWriteFile(directory, path);
		},
	);
	const selectionFile = join(app.getPath("userData"), "project-directory.json");
	async function remember(snapshot: ProjectSnapshot | null) {
		if (snapshot && !snapshot.inMemory)
			await writeFile(selectionFile, JSON.stringify(snapshot.directory));
		return snapshot;
	}
	ipcMain.handle(projectChannels.load, async (event) => {
		assertSender(event);
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
	ipcMain.handle(projectChannels.create, async (event, name: string) => {
		assertSender(event);
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
	ipcMain.handle(projectChannels.open, async (event) => {
		assertSender(event);
		if (!window) throw new Error("The desktop editor is closed.");
		const selected = await dialog.showOpenDialog(window, {
			title: "Open ECAD project directory",
			properties: ["openDirectory"],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return remember(await projects.openDirectory(selected.filePaths[0]));
	});
	ipcMain.handle(
		projectChannels.saveProject,
		async (event, directory: string) => {
			assertSender(event);
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
		},
	);
	ipcMain.handle(
		projectChannels.save,
		(event, directory: string, document: ProjectDocument) => {
			assertSender(event);
			return projects.save(directory, document);
		},
	);
	ipcMain.handle(
		projectChannels.importAssets,
		(
			event,
			directory: string,
			assets: { name: string; kind: AssetKind; bytes: Uint8Array }[],
		) => {
			assertSender(event);
			return projects.importAssets(directory, assets);
		},
	);
	ipcMain.handle(
		projectChannels.readAsset,
		(event, directory: string, path: string) => {
			assertSender(event);
			return projects.readAsset(directory, path);
		},
	);
}

function createWindow() {
	window = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 720,
		minHeight: 480,
		title: "ECAD desktop",
		backgroundColor: "#111318",
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event, url) => {
		if (url !== rendererUrl) event.preventDefault();
	});
	window.webContents.session.setPermissionRequestHandler(
		(_contents, _permission, reply) => reply(false),
	);
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
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
});
