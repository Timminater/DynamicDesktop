# DynamicDesktop development guide

- Use Dutch with the project owner. Write source comments and diagnostic text in English.
- DynamicDesktop includes the Windows host, shared framework and all scenes in `prototype/themes.json`. Every theme is available without payment.
- Interface languages are English and Dutch. Keep locale strings and theme defaults aligned with the registry.
- Use local build dependencies and avoid external links and repository references. The location search may contact Open-Meteo when the user submits a query.
- After changing a theme, check icon movement, preview, pause and sharing. Render canvases using physical pixels and fractional display dimensions.
- Target 30 fps on integrated graphics during normal playback. Cache static artwork and draw small moving objects in local layers.
- Existing files in `prototype/thumbs/` are manually designed. Preserve them unless a replacement is requested.
- Build the host with `powershell -ExecutionPolicy Bypass -File host\build.ps1`. The result is `host/bin/DynamicDesktop.exe`.
- Start browser preview with `node prototype\serve.mjs` or `powershell -ExecutionPolicy Bypass -File prototype\serve.ps1`. Open `http://localhost:5178/settings.html`.
- The Windows host is in `host/DesktopHost.cs`. Use Reload from the tray after changing theme HTML or JavaScript.
- Preserve the DynamicDesktop product identity, including `%LOCALAPPDATA%\DynamicDesktop`, the `Programs\DynamicDesktop` install location, startup entry and single-instance identity.
- Exclude `host/bin/`, `host/lib/`, personal data, credentials and machine-specific paths from commits.
- Obtain explicit direction from the project owner before publishing or changing trademarks. See `LICENSE` and `TRADEMARKS.md`.
