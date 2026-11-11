# DynamicDesktop

DynamicDesktop is an adaptive live wallpaper for Windows. It uses the positions of desktop icons to shape coastlines, clouds, forest clearings and other scenery as icons move. Rendering and settings stay on the device. Search for a city or Dutch postcode in Settings to follow daylight at a location.

![Meadow](docs/images/meadow.webp)

![Beach](docs/images/beach.webp)

## Features

- Beach and Meadow have day, night and automatic lighting. Choose a location using the online search or enter coordinates and a time zone manually. The search uses the first four digits of Dutch postcodes to find the corresponding place. Scene shadows and local desktop icon shadows can be controlled separately.
- All 22 themes are available. The eleven formerly locked scenes have original implementations.
- Each monitor shows the active theme with its own icon layout. Fullscreen and maximized apps can pause the wallpaper on the affected monitor. Preview and sharing use the primary monitor.
- Settings supports English and Dutch, with a still preview by default and a live preview switch.
- The tray menu offers pause, restart, startup on sign-in, mouse passthrough and exit.
- Image and animation exports substitute sample icons and label blocks. They omit real icon imagery, click locations and filenames.

## Requirements

Use 64-bit Windows 10 or 11 with Microsoft Edge WebView2 Runtime. Building the host requires PowerShell and the .NET Framework C# compiler included with Windows. Use the local WebView2 SDK in `host/lib/` or pass a local SDK package with `-WebView2Package`. Node.js is optional.

## Build and run

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File host\build.ps1
host\bin\DynamicDesktop.exe
```

Keep `host/` and `prototype/` together. Build output is written to `host/bin/`. Run the app again or double-click its tray icon to open Settings. Use the tray menu or run `host\bin\DynamicDesktop.exe --exit` to stop it.

Normal settings and logs are stored in `%LOCALAPPDATA%\DynamicDesktop`.

## Browser preview

```powershell
powershell -ExecutionPolicy Bypass -File prototype\serve.ps1
```

You can also run `node prototype\serve.mjs`. Open [Settings](http://localhost:5178/settings.html). The browser uses sample icons. Windows desktop integration requires the host.

## Installer, portable build and source archive

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-installer.ps1
powershell -ExecutionPolicy Bypass -File tools\build-installer.ps1 -PortableOnly
powershell -ExecutionPolicy Bypass -File tools\build-installer.ps1 -SourceOnly
```

Artifacts are written to `dist/`. The installer uses a local NSIS compiler, installs for the current Windows user and preserves settings on uninstall. Pass `-NsisCompiler` if the compiler is outside the build cache. Install the WebView2 Runtime separately if Windows does not already provide it. The portable ZIP contains separate portable and test launchers. Portable mode stores settings beside the executable and test mode uses a temporary profile. Both modes disable startup on sign-in. Close an existing DynamicDesktop wallpaper instance before trying another mode on the same desktop.

The installer produced by the build is unsigned.

## Project layout

| Path | Contents |
| --- | --- |
| `host/` | Windows wallpaper host, build script and manifest |
| `prototype/themes.json` | Theme catalog and parameters |
| `prototype/settings.html` | Settings and browser preview |
| `prototype/flat.html` and `prototype/meadow.html` | Beach and Meadow renderers |
| `prototype/share.js` | Image and animation sharing |
| `tools/` | Installer and archive build tooling |

Windows Spotlight and wallpaper slideshows can cause a short flash when Windows changes the background. The app targets 30 fps on integrated graphics during normal playback.

## License

Project source and included theme assets are licensed under [GPL-3.0](LICENSE). See [NOTICE](NOTICE) for community contributions, [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependencies and [TRADEMARKS.md](TRADEMARKS.md) for the name and icon policy.
