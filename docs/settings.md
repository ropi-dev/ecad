# Settings

Open **Settings** from the gear at the bottom of the project sidebar. **Project → Symbol libraries...** opens the same dialog on its libraries section.

Each setting is global, per project, or both:

| Setting | Global | Project |
| --- | --- | --- |
| Antialiasing (Automatic, On, Off) | yes | no |
| Electrical rule levels (Error, Warning, Off per rule) | yes | yes |
| Symbol libraries | user libraries | project libraries |

A project value wins over the global value. Rule levels merge rule by rule, so a project can turn off one rule and keep the global levels for the rest. In the dialog, **All projects** edits the global levels and **This project** edits the open project's.

## Where they are stored

Global settings live in one JSON file, `{"version": 1, ...}`, read by `appSettingsSchema` in `packages/core/src/settings/schema.ts`. A different build may have written the file, so reads are lenient: unknown keys pass through and are saved again, and an invalid value drops only its own field. Saves are strict about the fields this build knows, so a bad value is reported instead of dropped. Project settings follow the same rules. ERC levels are read rule by rule, so a level this build doesn't know drops only that rule's entry.

Add new settings as new optional fields and keep `version` at 1. A build fails to read a file with any other version, and the next change overwrites it, so bumping it would erase settings for anyone who runs an older build.

- Web: `localStorage` under `ecad.settings.v1`. Other tabs pick up changes through the `storage` event.
- Desktop: `settings.json` in the platform configuration directory, `$XDG_CONFIG_HOME/ecad` or `~/.config/ecad` on Linux, `~/Library/Application Support/ecad` on macOS and `%APPDATA%\ecad` on Windows. The main process writes it atomically with mode 0600. A damaged file loads as defaults, the dialog shows the error, and the next change replaces the file.

The desktop symbol library configuration (`symbol-libraries.json`) and approved outside library directories (`approved-libraries.json`) sit in the same directory. Files that older versions wrote to `~/.ecad` are still read until the new file exists.

Project settings live in the `[settings]` table of the project's `.ecadprj`:

```toml
[settings.ercSeverity]
unconnected-pin = "off"
similar-net-names = "error"
```

Builds from before the settings dialog reject an `.ecadprj` with a `[settings]` table, because the manifest schema was strict then. Later builds read unknown settings keys as described above.

Saving project settings rewrites only `.ecadprj`. It fails with a conflict when another program changed the project since it was opened, like any other project save.

The desktop renderer loads global settings before its first render, so viewers create their WebGL context with the saved antialiasing choice. The browser reads `localStorage` synchronously. Without `ecad.settings.v1`, the browser uses the old `ecad.antialias` key, and the next save removes it. The desktop app does not carry that key over; its antialiasing starts on Automatic.
