# DynamicDesktop Windows host

The C#/.NET Framework host uses WebView2 to place wallpaper windows behind Windows desktop icons. It uses Progman child windows on Windows 11 24H2 and later and WorkerW on earlier systems.

## Build and run

```powershell
powershell -ExecutionPolicy Bypass -File host\build.ps1
host\bin\DynamicDesktop.exe
```

The build uses the Windows C# compiler and uses the local WebView2 SDK from `host/lib/` or from a package supplied with `-WebView2Package`. Local libraries are in `host/lib/`. Build output is in `host/bin/`.

| Argument | Action |
| --- | --- |
| No argument | Start the wallpaper and open Settings. If already running, open Settings. |
| `--autostart` | Start in the background. |
| `--settings` | Open Settings. |
| `--menu` | Open the tray menu. |
| `--exit` | Exit and restore the system wallpaper. |
| `--exit-installed` | Installer command. Exit only the instance using the same executable path. |
| `--portable` | Use the `data` directory beside the executable. |
| `--test` | Use `%TEMP%\DynamicDesktop-test` and skip the global hotkey. |

An absolute `DYNAMICDESKTOP_PROFILE_DIR` overrides the selected profile. Isolated profiles keep settings, the WebView2 cache and single-instance events separate from the default `%LOCALAPPDATA%\DynamicDesktop` profile. Startup registration is disabled in isolated profiles.

## Desktop behavior

- The host opens one wallpaper window per monitor. It sends the active theme to all monitors and maps Explorer icon rectangles into monitor-local coordinates. The primary monitor supplies Settings preview and exports.
- Explorer events trigger debounced icon updates, with periodic polling as a fallback. Local shell icon masks are resolved in the background for wallpapers with icon shadows enabled.
- Fullscreen or maximized windows pause playback on the monitor they cover. The tray can pause all monitors.
- The app reads the catalog from `prototype/themes.json` and opens the themes listed there.
- Theme source can be reloaded from the tray. Host changes require a rebuild and restart.

## Page messages

Settings sends theme selection, settings, location, language, startup and sharing requests. The host returns saved settings, primary-monitor icon rectangles and share results. A ready wallpaper receives settings, environment, icon rectangles and pause state. Icon masks and click coordinates are sent only to wallpaper views.
