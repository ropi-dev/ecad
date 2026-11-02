import type { DisplayBridge } from "@ecad/core/components/viewer/displayScale.ts";
import type { ProjectStorage } from "@ecad/core/projects/storage.ts";
import { contextBridge, ipcRenderer } from "electron";
import {
	type DesktopSymbolLibraryBridge,
	displayChannels,
	libraryChannels,
	projectChannels,
} from "#/bridge.ts";

const bridge: DesktopSymbolLibraryBridge = {
	load: () => ipcRenderer.invoke(libraryChannels.load),
	save: (symbols, additions) =>
		ipcRenderer.invoke(libraryChannels.save, symbols, additions),
	openDirectory: () => ipcRenderer.invoke(libraryChannels.openDirectory),
	loadConfiguration: () =>
		ipcRenderer.invoke(libraryChannels.loadConfiguration),
	saveConfiguration: (config) =>
		ipcRenderer.invoke(libraryChannels.saveConfiguration, config),
	openLibraryDirectory: (name) =>
		ipcRenderer.invoke(libraryChannels.openLibraryDirectory, name),
	loadDirectory: (path, scope, directory) =>
		ipcRenderer.invoke(libraryChannels.loadDirectory, path, scope, directory),
	canWriteConfiguration: () =>
		ipcRenderer.invoke(libraryChannels.canWriteConfiguration),
	inspectDirectorySymbol: (request) =>
		ipcRenderer.invoke(libraryChannels.inspectDirectorySymbol, request),
	saveDirectorySymbol: (request, original, next) =>
		ipcRenderer.invoke(
			libraryChannels.saveDirectorySymbol,
			request,
			original,
			next,
		),
};

contextBridge.exposeInMainWorld("ecadSymbolLibrary", bridge);

const projects: ProjectStorage = {
	mode: "desktop",
	load: () => ipcRenderer.invoke(projectChannels.load),
	list: async () => [],
	create: (name) => ipcRenderer.invoke(projectChannels.create, name),
	open: () => ipcRenderer.invoke(projectChannels.open),
	save: (directory, document) =>
		ipcRenderer.invoke(projectChannels.save, directory, document),
	saveProject: (directory) =>
		ipcRenderer.invoke(projectChannels.saveProject, directory),
	importAssets: (directory, assets) =>
		ipcRenderer.invoke(projectChannels.importAssets, directory, assets),
	readAsset: (directory, path) =>
		ipcRenderer.invoke(projectChannels.readAsset, directory, path),
	canWriteFile: (directory, path) =>
		ipcRenderer.invoke(projectChannels.canWriteFile, directory, path),
};
contextBridge.exposeInMainWorld("ecadProjects", projects);

const display: DisplayBridge = {
	getCalibration: () => ipcRenderer.invoke(displayChannels.getCalibration),
	onChanged: (listener) => {
		const handle = () => listener();
		ipcRenderer.on(displayChannels.changed, handle);
		return () => {
			ipcRenderer.removeListener(displayChannels.changed, handle);
		};
	},
};
contextBridge.exposeInMainWorld("ecadDisplay", display);
