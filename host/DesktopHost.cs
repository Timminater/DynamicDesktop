// DynamicDesktop desktop host.
// Embed a borderless WebView2 wallpaper beneath the desktop icons and synchronize
// its settings with the settings window. Read icon positions through cross-process
// ListView messages, pause for maximized or fullscreen windows, and expose tray
// controls. Reattach if Explorer destroys the wallpaper layer. Sharing renders
// an anonymized image in the wallpaper page.
// Build with the Windows .NET Framework compiler (C# 5); see build.ps1.

using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

static class Program
{
    public static readonly string ExitEventName = "DynamicDesktopHost_Exit" + InstallProfile.Suffix;
    public static readonly string MenuEventName = "DynamicDesktopHost_Menu" + InstallProfile.Suffix;
    public static readonly string SettingsEventName = "DynamicDesktopHost_Settings" + InstallProfile.Suffix;

    // Signal the running instance to exit or open a menu.
    static void Signal(string name)
    {
        Native.AllowSetForegroundWindow(-1);            // Allow the running instance to activate its menu.
        EventWaitHandle ev;
        if (EventWaitHandle.TryOpenExisting(name, out ev)) ev.Set();
    }

    [STAThread]
    static void Main(string[] args)
    {
        // --exit closes the running instance; --menu opens its menu at the pointer;
        // --settings opens its settings window.
        if (Array.IndexOf(args, "--exit") >= 0) { Signal(ExitEventName); return; }
        if (Array.IndexOf(args, "--menu") >= 0) { Signal(MenuEventName); return; }
        if (Array.IndexOf(args, "--settings") >= 0) { Signal(SettingsEventName); return; }
        if (args.Length > 0 && args[0] == "--exit-installed") { Environment.ExitCode = InstallProfile.StopInstalled(); return; }
        // Preview never migrates or shares the development edition's settings.
        bool fromAutostart = Array.IndexOf(args, "--autostart") >= 0;
        if (fromAutostart) AutoStartCheck.MarkLaunched();  // Record the launch even if another instance already runs.
        bool created;
        var mutex = new Mutex(true, "DynamicDesktopHost_Singleton" + InstallProfile.Suffix, out created);
        if (!created)
        {
            if (!fromAutostart) Signal(SettingsEventName); // A manual second launch opens settings.
            return;
        }
        // Desktop icon coordinates and monitor bounds use physical pixels.
        if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        // Record unexpected exceptions instead of silently exiting.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e) { Log.Write("Unhandled exception: " + e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) { Log.Write("Fatal exception: " + e.ExceptionObject); };
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string pageDir = Path.GetFullPath(Path.Combine(exeDir, @"..\..\prototype"));
        // On Windows 11 24H2+, the default is a layered Progman child.
        // --defview uses the icon layer (experimental and observed not to draw);
        // --legacy uses WorkerW, which Explorer can destroy on wallpaper changes.
        string attach = "progman";
        bool autostart = false;                           // --autostart starts without opening settings.
        foreach (string a in args)
        {
            if (a == "--legacy") attach = "legacy";
            else if (a == "--defview") attach = "defview";
            else if (a == "--autostart") autostart = true;
            else if (!a.StartsWith("--")) pageDir = a;
        }
        WallpaperForm.AttachMode = attach;
        Application.Run(new HostContext(pageDir, !autostart));
        GC.KeepAlive(mutex);
    }
}

static class Log
{
    public static readonly string DataDir = InstallProfile.DataDir;
    public static readonly string FilePath = Path.Combine(DataDir, "host.log");

    public static void Write(string msg)
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + msg + "\r\n");
        }
        catch { }
    }
}

// Detect a blocked autostart: after three minutes from login, an enabled entry
// without a launch timestamp for this session may have been blocked.
static class AutoStartCheck
{
    static string LastPath { get { return Path.Combine(Log.DataDir, "autostart.last"); } }
    static string EnabledPath { get { return Path.Combine(Log.DataDir, "autostart.enabled"); } }

    static void Stamp(string path)
    {
        try { Directory.CreateDirectory(Log.DataDir); File.WriteAllText(path, DateTime.UtcNow.Ticks.ToString()); } catch { }
    }
    static DateTime ReadStamp(string path)
    {
        try { return new DateTime(long.Parse(File.ReadAllText(path).Trim()), DateTimeKind.Utc); } catch { return DateTime.MinValue; }
    }
    public static void MarkLaunched() { Stamp(LastPath); }
    public static void MarkEnabled() { Stamp(EnabledPath); }

    // Current login time in UTC from WTSQuerySessionInformation(WTSSessionInfo).
    public static DateTime LogonTimeUtc()
    {
        IntPtr buf; int bytes;
        if (!Native.WTSQuerySessionInformation(IntPtr.Zero, -1, 24, out buf, out bytes)) return DateTime.MinValue;
        try { return bytes >= 216 ? DateTime.FromFileTimeUtc(Marshal.ReadInt64(buf, 200)) : DateTime.MinValue; }
        catch { return DateTime.MinValue; }
        finally { Native.WTSFreeMemory(buf); }
    }

    // Identify running security software so the warning can name it.
    public static string SecuritySoftware()
    {
        string[,] known = { { "HipsTray", "Huorong" }, { "HipsDaemon", "Huorong" }, { "360Tray", "360 Total Security" }, { "360sd", "360 Antivirus" },
                            { "QQPCTray", "Tencent PC Manager" }, { "kxetray", "Kingsoft Antivirus" }, { "2345SafeTray", "2345 Security" } };
        for (int i = 0; i < known.GetLength(0); i++)
            if (Process.GetProcessesByName(known[i, 0]).Length > 0) return known[i, 1];
        return "";
    }

    // Return null when healthy, or the security product name (possibly empty)
    // when the launch appears blocked. The settings page localizes the warning.
    public static string Detect(bool autoStartOn)
    {
        if (!autoStartOn) return null;
        DateTime logon = LogonTimeUtc();
        if (logon == DateTime.MinValue || (DateTime.UtcNow - logon).TotalMinutes < 3) return null; // Startup may still be pending.
        if (ReadStamp(EnabledPath) > logon) return null; // Enabled after this login.
        if (ReadStamp(LastPath) > logon) return null;    // Launched during this session.
        string sw = SecuritySoftware();
        Log.Write("Autostart did not run after login at " + logon.ToLocalTime().ToString("yyyy-MM-dd HH:mm") + (sw != "" ? "; security software: " + sw : ""));
        return sw;
    }
}

static class Json
{
    static readonly JavaScriptSerializer S = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
    public static object Parse(string s) { return S.DeserializeObject(s); }
    public static string Stringify(object o) { return S.Serialize(o); }
    public static Dictionary<string, object> Obj(params object[] kv)
    {
        var d = new Dictionary<string, object>();
        for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
        return d;
    }
}

// Store the selected theme and only the parameters changed from their defaults.
// Preview uses its own profile directory.
static class Settings
{
    static readonly string FilePath = Path.Combine(Log.DataDir, "settings.json");
    public static string Theme = "beach";
    public static string Lang = "auto";                // System language or a supported language code.
    public static Dictionary<string, object> Environment = new Dictionary<string, object>();
    public static bool MousePassthrough = true;
    public static Dictionary<string, Dictionary<string, object>> Params = new Dictionary<string, Dictionary<string, object>>();

    public static void Load()
    {
        try
        {
            string source = FilePath;
            if (!File.Exists(source) && !InstallProfile.Isolated)
                source = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "DesklandPreview", "settings.json");
            if (!File.Exists(source)) return;
            var root = Json.Parse(File.ReadAllText(source, Encoding.UTF8)) as Dictionary<string, object>;
            if (root == null) return;
            object v;
            if (root.TryGetValue("theme", out v) && v is string) Theme = (string)v;
            if (root.TryGetValue("lang", out v) && v is string) Lang = I18n.Normalize((string)v);
            if (root.TryGetValue("environment", out v) && v is Dictionary<string, object>) Environment = (Dictionary<string, object>)v;
            if (root.TryGetValue("mousePassthrough", out v) && v is bool) MousePassthrough = (bool)v;
            if (root.TryGetValue("params", out v) && v is Dictionary<string, object>)
                foreach (var kv in (Dictionary<string, object>)v)
                {
                    var d = kv.Value as Dictionary<string, object>;
                    if (d != null) Params[kv.Key] = d;
                }
            Log.Write("Loaded settings for theme " + Theme);
            if (source != FilePath) Save();
        }
        catch (Exception ex) { Log.Write("Could not load settings; using defaults: " + ex.Message); }
    }

    public static void Save()
    {
        try
        {
            Directory.CreateDirectory(Log.DataDir);
            File.WriteAllText(FilePath, Json.Stringify(Json.Obj("version", 1, "theme", Theme, "lang", Lang, "params", Params, "environment", Environment, "mousePassthrough", MousePassthrough)), new UTF8Encoding(false));
        }
        catch (Exception ex) { Log.Write("Could not save settings: " + ex.Message); }
    }

    public static Dictionary<string, object> For(string theme)
    {
        Dictionary<string, object> d;
        if (!Params.TryGetValue(theme, out d)) Params[theme] = d = new Dictionary<string, object>();
        return d;
    }

    public static bool IconShadowsEnabled()
    {
        Dictionary<string, object> values;
        object value;
        return Params.TryGetValue(Theme, out values) && values.TryGetValue("iconShadows", out value) && Equals(value, 1);
    }
}

// Localized UI and host text lives in prototype/i18n. Unsupported system
// languages fall back to English.
static class I18n
{
    // Keep the settings page language list in sync with this list.
    public static readonly string[] Supported = { "en", "nl" };
    public static string Code = "en", Sys = "en";
    static Dictionary<string, object> cur, en;

    public static string FromCulture(System.Globalization.CultureInfo c)
    {
        string two = c.TwoLetterISOLanguageName;
        string want = two;
        if (Array.IndexOf(Supported, want) >= 0) return want;
        return "en";
    }

    public static string Normalize(string setting)
    {
        if (string.IsNullOrEmpty(setting) || setting == "auto") return "auto";
        return Array.IndexOf(Supported, setting) >= 0 ? setting : "en";
    }

    public static void Load(string pageDir, string setting)
    {
        Sys = FromCulture(System.Globalization.CultureInfo.CurrentUICulture);
        setting = Normalize(setting);
        Code = setting == "auto" ? Sys : setting;
        en = Read(pageDir, "en");
        cur = Code == "en" ? en : Read(pageDir, Code);
        Log.Write("UI language: " + Code + " (setting: " + setting + ", system: " + Sys + ")");
    }

    static Dictionary<string, object> Read(string pageDir, string code)
    {
        try
        {
            var root = Json.Parse(File.ReadAllText(Path.Combine(Path.Combine(pageDir, "i18n"), code + ".json"), Encoding.UTF8)) as Dictionary<string, object>;
            object h;
            return root != null && root.TryGetValue("host", out h) ? h as Dictionary<string, object> : null;
        }
        catch (Exception ex) { Log.Write("Could not load language " + code + ": " + ex.Message); return null; }
    }

    // Look up the current language, falling back to English; substitute named values.
    public static string T(string key, params string[] kv)
    {
        object v = null;
        bool found = (cur != null && cur.TryGetValue(key, out v)) || (en != null && en.TryGetValue(key, out v));
        string str = found ? (v as string ?? key) : key;
        for (int i = 0; i + 1 < kv.Length; i += 2) str = str.Replace("{" + kv[i] + "}", kv[i + 1]);
        return str;
    }
}

// Application lifetime: maintain the tray icon and recreate lost wallpapers.
// Open the menu via the tray, Ctrl+Alt+H, or --menu; open settings via a
// second launch, tray double-click, menu entry, or --settings.
class HostContext : ApplicationContext
{
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", RunName = "DynamicDesktop";
    static readonly MethodInfo ShowTrayMenu =
        typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic);

    readonly string pageDir;
    readonly NotifyIcon tray;
    readonly MenuItem pauseItem, autoStartItem, settingsItem, reloadItem, exitItem;
    readonly MenuItem passthroughItem;
    readonly System.Windows.Forms.Timer watch;
    readonly EventWaitHandle exitEvent, menuEvent, settingsEvent;
    readonly HotkeyWindow hotkey = new HotkeyWindow();
    readonly DesktopMouseHook mouseHook;
    readonly Queue<DateTime> restarts = new Queue<DateTime>();
    WallpaperForm form, dead;
    readonly List<WallpaperForm> forms = new List<WallpaperForm>();
    readonly List<WallpaperForm> deadForms = new List<WallpaperForm>();
    bool rebuilding;
    string displaySignature = "";
    SettingsForm settingsWin;
    DateTime nextStart = DateTime.MaxValue, saveDue = DateTime.MaxValue;
    bool manualPause, exiting;
    string autoStartSw;                                 // null: healthy; otherwise the suspected security product.

    public HostContext(string pageDir, bool showSettings)
    {
        this.pageDir = pageDir;
        Log.Write("Starting with page directory " + pageDir + (showSettings ? "" : " (autostart)"));
        if (showSettings && !InstallProfile.NoAutostart) autoStartSw = AutoStartCheck.Detect(IsAutoStart());
        Settings.Load();
        I18n.Load(pageDir, Settings.Lang);
        mouseHook = new DesktopMouseHook(delegate(int x, int y) {
            foreach (WallpaperForm f in forms.ToArray()) f.Ripple(x, y);
        });
        exitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ExitEventName);
        menuEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.MenuEventName);
        settingsEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.SettingsEventName);

        // Ctrl+Alt+H opens the menu at the pointer.
        bool hotkeyOk = !InstallProfile.Test && hotkey.Register(Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT, Keys.H);
        hotkey.Pressed += delegate { ShowMenu(); };
        if (!InstallProfile.Test) Log.Write(hotkeyOk ? "Registered Ctrl+Alt+H" : "Could not register Ctrl+Alt+H (possibly already in use)");

        pauseItem = new MenuItem(I18n.T("trayPause"), delegate
        {
            manualPause = !manualPause;
            pauseItem.Checked = manualPause;
            foreach (WallpaperForm f in forms) f.SetManualPause(manualPause);
        });
        autoStartItem = new MenuItem(I18n.T("trayAutostart"), delegate { SetAutoStart(!autoStartItem.Checked); });
        autoStartItem.Enabled = !InstallProfile.NoAutostart;
        autoStartItem.Checked = IsAutoStart();
        if (autoStartItem.Checked && AutoStartValue() != "")
        {
            try
            {
                if (CreateAutoStartShortcut())
                {
                    DeleteRunAutoStart();
                    Log.Write("Migrated autostart to the current user's Startup folder");
                }
                else if (AutoStartValue().IndexOf("--autostart") < 0)
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))   // Add missing arguments to the fallback entry.
                        k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --autostart");
            }
            catch (Exception ex) { Log.Write("Autostart migration failed; retaining existing entry: " + ex.Message); }
        }
        settingsItem = new MenuItem(I18n.T("traySettings"), delegate { OpenSettings(); });
        settingsItem.DefaultItem = true;                // Mark the primary entry in bold.
        passthroughItem = new MenuItem(I18n.T("trayMousePassthrough"), delegate {
            Settings.MousePassthrough = !Settings.MousePassthrough;
            passthroughItem.Checked = Settings.MousePassthrough;
            foreach (WallpaperForm f in forms) f.SetPassthrough(Settings.MousePassthrough);
            SaveSoon();
        });
        passthroughItem.Checked = Settings.MousePassthrough;

        tray = new NotifyIcon();
        tray.Icon = AppIcon.Create();
        tray.Text = "DynamicDesktop";
        tray.ContextMenu = new ContextMenu(new[] {
            settingsItem,
            pauseItem,
            passthroughItem,
            reloadItem = new MenuItem(I18n.T("trayReload"), delegate { foreach (WallpaperForm f in forms) f.Reload(); }),
            autoStartItem,
            new MenuItem("-"),
            exitItem = new MenuItem(I18n.T("trayExit"), delegate { Exit(); }),
        });
        tray.MouseUp += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ShowMenu(); };
        tray.DoubleClick += delegate { OpenSettings(); };
        tray.Visible = true;
        ShowWelcomeOnce(hotkeyOk);

        watch = new System.Windows.Forms.Timer();
        watch.Interval = 500;
        watch.Tick += delegate { Watch(); };
        watch.Start();
        StartForm();
        if (showSettings) OpenSettings();
    }

    // Refresh tray text after a language change.
    void ApplyTrayTexts()
    {
        settingsItem.Text = I18n.T("traySettings");
        pauseItem.Text = I18n.T("trayPause");
        passthroughItem.Text = I18n.T("trayMousePassthrough");
        reloadItem.Text = I18n.T("trayReload");
        autoStartItem.Text = I18n.T("trayAutostart");
        exitItem.Text = I18n.T("trayExit");
    }

    // Settings window
    public void OpenSettings()
    {
        if (exiting) return;
        if (settingsWin == null || settingsWin.IsDisposed)
        {
            settingsWin = new SettingsForm(pageDir, this);
            settingsWin.FormClosed += delegate { settingsWin = null; };
            Log.Write("Opening settings");
        }
        if (settingsWin.WindowState == FormWindowState.Minimized) settingsWin.WindowState = FormWindowState.Normal;
        settingsWin.Show();
        // When started externally with SW_HIDE, WinForms may report Visible even
        // though the native window is hidden. Activate/Show cannot fix that;
        // SW_RESTORE handles both hidden and minimized windows.
        Native.ShowWindow(settingsWin.Handle, Native.SW_RESTORE);
        settingsWin.Activate();
    }

    string SettingsMessage()
    {
        return Json.Stringify(Json.Obj("t", "settings", "v", Settings.For(Settings.Theme)));
    }
    string EnvironmentMessage() { return Json.Stringify(Json.Obj("t", "environment", "v", Settings.Environment)); }
    void Broadcast(string json) { foreach (WallpaperForm f in forms.ToArray()) f.Post(json); }
    public void SetSettingsDragging(bool dragging)
    {
        string message = "{\"t\":\"dragging\",\"v\":" + (dragging ? "true" : "false") + "}";
        Broadcast(message);
        if (settingsWin != null) settingsWin.Post(message);
    }

    void SaveSoon() { saveDue = DateTime.Now.AddMilliseconds(600); }

    // Messages from the settings page.
    public void OnSettingsMessage(string s)
    {
        var m = Json.Parse(s) as Dictionary<string, object>;
        if (m == null || settingsWin == null) return;
        object t;
        m.TryGetValue("t", out t);
        switch (t as string)
        {
            case "hello":
                Rectangle scr = Screen.PrimaryScreen.Bounds;
                settingsWin.Post(Json.Stringify(Json.Obj("t", "init", "theme", Settings.Theme, "params", Settings.Params,
                    "screen", Json.Obj("w", scr.Width, "h", scr.Height), "autostart", IsAutoStart(),
                    "autostartWarn", autoStartSw != null, "autostartSw", autoStartSw ?? "",
                    "lang", Settings.Lang, "langEff", I18n.Code, "langSys", I18n.Sys, "environment", Settings.Environment)));
                if (form != null && form.LastIcons != "") settingsWin.Post(form.LastIcons);
                break;
            case "set":
            {
                string theme = m["theme"] as string, key = m["key"] as string;
                if (theme == null || key == null) return;
                Settings.For(theme)[key] = m["value"];
                if (theme == Settings.Theme)
                {
                    Broadcast(Json.Stringify(Json.Obj("t", "settings", "v", Json.Obj(key, m["value"]))));
                    if (key == "iconShadows") foreach (WallpaperForm f in forms) f.RefreshIconMasks();
                }
                SaveSoon();
                break;
            }
            case "reset":
            {
                string theme = m["theme"] as string;
                if (theme == null) return;
                Settings.Params.Remove(theme);
                if (theme == Settings.Theme)
                {
                    Broadcast("{\"t\":\"reset\"}");
                    foreach (WallpaperForm f in forms) f.RefreshIconMasks();
                }
                SaveSoon();
                Log.Write("Restored default settings: " + theme);
                break;
            }
            case "theme":
            {
                string id = m["id"] as string;
                if (Themes.PageFor(pageDir, id) == null)
                {
                    settingsWin.Post(Json.Stringify(Json.Obj("t", "themeChanged", "id", Settings.Theme)));
                    Log.Write("Unknown theme: " + (id ?? "null"));
                    return;
                }
                string page = Themes.PageFor(pageDir, id);
                if (page == null || id == Settings.Theme) return;
                Settings.Theme = id;
                SaveSoon();
                foreach (WallpaperForm f in forms.ToArray()) f.LoadPage(page);
                Log.Write("Switched theme: " + id);
                break;
            }
            case "autostartWarnSeen":
                autoStartSw = null;
                break;
            case "environment":
            {
                object value;
                if (!m.TryGetValue("v", out value) || !(value is Dictionary<string, object>)) break;
                var input = (Dictionary<string, object>)value;
                object latitude, longitude, zone, label;
                input.TryGetValue("latitude", out latitude); input.TryGetValue("longitude", out longitude); input.TryGetValue("timeZone", out zone);
                input.TryGetValue("label", out label);
                double lat, lon;
                bool hasCoordinates = latitude != null && longitude != null && double.TryParse(Convert.ToString(latitude, System.Globalization.CultureInfo.InvariantCulture), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out lat) && double.TryParse(Convert.ToString(longitude, System.Globalization.CultureInfo.InvariantCulture), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
                string name = hasCoordinates ? label as string : null;
                if (name != null && name.Length > 200) name = name.Substring(0, 200);
                Settings.Environment = Json.Obj("latitude", hasCoordinates ? latitude : null, "longitude", hasCoordinates ? longitude : null,
                    "timeZone", zone is string ? zone : "", "label", name);
                SaveSoon(); Broadcast(EnvironmentMessage());
                break;
            }
            case "lang":                                    // Persist and report the effective language.
            {
                object v;
                if (!m.TryGetValue("v", out v) || !(v is string)) return;
                Settings.Lang = I18n.Normalize((string)v);
                SaveSoon();
                I18n.Load(pageDir, Settings.Lang);
                ApplyTrayTexts();
                settingsWin.Post(Json.Stringify(Json.Obj("t", "lang", "v", Settings.Lang, "eff", I18n.Code, "sys", I18n.Sys)));
                break;
            }
            case "share":
                if (form == null) { PostShareResult(false, null, I18n.T("errNotReady")); break; }
                form.RequestSnapshot(OnShareImage);
                break;
            case "shareVideo":
                if (form == null) { PostShareResult(false, null, I18n.T("errNotReady")); break; }
                form.RequestRecording(OnShareVideo);
                break;
            case "openShare":
                if (lastShare != null && File.Exists(lastShare)) Process.Start(lastShare);
                break;
            case "revealShare":
                if (lastShare != null && File.Exists(lastShare)) Process.Start("explorer.exe", "/select,\"" + lastShare + "\"");
                break;
            case "autostart":
                SetAutoStart(m["v"] is bool && (bool)m["v"]);
                settingsWin.Post(Json.Stringify(Json.Obj("t", "autostart", "v", IsAutoStart())));
                break;
        }
    }

    // Save the wallpaper-rendered share image, copy it, and return its thumbnail.
    string lastShare;                                   // Only the most recent share may be opened from settings.
    void OnShareImage(string thumb, string png, string err)
    {
        if (err != null || png == null) { PostShareResult(false, null, err ?? I18n.T("errNoImage")); Log.Write("Share image generation failed: " + err); return; }
        try
        {
            int comma = png.IndexOf(',');
            byte[] bytes = Convert.FromBase64String(comma >= 0 ? png.Substring(comma + 1) : png);
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "DynamicDesktop");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "DynamicDesktop " + DateTime.Now.ToString("yyyy-MM-dd HHmmss") + ".png");
            File.WriteAllBytes(path, bytes);
            lastShare = path;
            try
            {
                using (var ms = new MemoryStream(bytes))
                using (var img = Image.FromStream(ms))
                {
                    var data = new DataObject();
                    data.SetImage(new Bitmap(img));                       // Compatible with ordinary chat applications.
                    data.SetData("PNG", false, new MemoryStream(bytes));  // Full-quality PNG for browsers and Office.
                    Clipboard.SetDataObject(data, true);
                }
            }
            catch (Exception ex) { Log.Write("Could not copy share image: " + ex.Message); }
            Log.Write("Generated share image: " + path);
            if (settingsWin != null)
                settingsWin.Post(Json.Stringify(Json.Obj("t", "shareResult", "ok", true, "thumb", thumb, "path", path)));
        }
        catch (Exception ex)
        {
            Log.Write("Could not save share image: " + ex);
            PostShareResult(false, null, ex.Message);
        }
    }
    void PostShareResult(bool ok, string path, string msg)
    {
        if (settingsWin != null) settingsWin.Post(Json.Stringify(Json.Obj("t", "shareResult", "ok", ok, "path", path, "msg", msg)));
    }
    // Save a share animation as MP4 or WebM, copy the file to the clipboard,
    // and let settings play it via the share.local virtual host.
    void OnShareVideo(string mime, string poster, string video, string err)
    {
        if (err != null || video == null) { PostShareResult(false, null, err ?? I18n.T("errNoVideo")); Log.Write("Share recording failed: " + err); return; }
        try
        {
            int comma = video.IndexOf(',');
            byte[] bytes = Convert.FromBase64String(comma >= 0 ? video.Substring(comma + 1) : video);
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "DynamicDesktop");
            Directory.CreateDirectory(dir);
            string name = "DynamicDesktop " + DateTime.Now.ToString("yyyy-MM-dd HHmmss") + (mime == "video/webm" ? ".webm" : ".mp4");
            string path = Path.Combine(dir, name);
            File.WriteAllBytes(path, bytes);
            lastShare = path;
            try
            {
                var files = new System.Collections.Specialized.StringCollection();
                files.Add(path);
                Clipboard.SetFileDropList(files);
            }
            catch (Exception ex) { Log.Write("Could not copy share recording: " + ex.Message); }
            Log.Write("Recorded share animation: " + path + " (" + (bytes.Length / 1024) + " KB)");
            if (settingsWin != null)
            {
                settingsWin.MapShareFolder(dir);
                settingsWin.Post(Json.Stringify(Json.Obj("t", "shareResult", "ok", true, "kind", "video", "thumb", poster, "path", path,
                    "url", "https://share.local/" + Uri.EscapeDataString(name))));
            }
        }
        catch (Exception ex)
        {
            Log.Write("Could not save share recording: " + ex);
            PostShareResult(false, null, ex.Message);
        }
    }

    // NotifyIcon handles foreground activation and dismisses the menu on outside clicks.
    void ShowMenu()
    {
        if (exiting) return;
        autoStartItem.Checked = IsAutoStart();
        if (ShowTrayMenu != null) ShowTrayMenu.Invoke(tray, null);
    }

    // Show a one-time notification explaining where to find the menu.
    void ShowWelcomeOnce(bool hotkeyOk)
    {
        try
        {
            string flag = Path.Combine(Log.DataDir, "welcome.shown");
            if (File.Exists(flag)) return;
            Directory.CreateDirectory(Log.DataDir);
            tray.ShowBalloonTip(10000, I18n.T("welcomeTitle"),
                I18n.T("welcomeBody", "hotkey", hotkeyOk ? I18n.T("welcomeHotkey") : ""), ToolTipIcon.Info);
            File.WriteAllText(flag, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        }
        catch (Exception ex) { Log.Write("Could not show first-run notification: " + ex.Message); }
    }

    // Prefer a shortcut in the current user's Startup folder and migrate the old
    // Run entry. Avoid elevated scheduled tasks; retain Run as a fallback.
    static string AutoStartShortcutPath
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "DynamicDesktop.lnk"); }
    }

    static object OpenAutoStartShortcut()
    {
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        try
        {
            return shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                null, shell, new object[] { AutoStartShortcutPath });
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    static bool AutoStartShortcutEnabled()
    {
        if (!File.Exists(AutoStartShortcutPath)) return false;
        object link = null;
        try
        {
            link = OpenAutoStartShortcut();
            string target = link.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty,
                null, link, null) as string;
            string arguments = link.GetType().InvokeMember("Arguments", BindingFlags.GetProperty,
                null, link, null) as string;
            return string.Equals(target, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)
                && arguments != null && arguments.IndexOf("--autostart", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch { return false; }
        finally { if (link != null) Marshal.FinalReleaseComObject(link); }
    }

    static bool CreateAutoStartShortcut()
    {
        object link = null;
        try
        {
            link = OpenAutoStartShortcut();
            link.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty,
                null, link, new object[] { Application.ExecutablePath });
            link.GetType().InvokeMember("Arguments", BindingFlags.SetProperty,
                null, link, new object[] { "--autostart" });
            link.GetType().InvokeMember("WorkingDirectory", BindingFlags.SetProperty,
                null, link, new object[] { Path.GetDirectoryName(Application.ExecutablePath) });
            link.GetType().InvokeMember("IconLocation", BindingFlags.SetProperty,
                null, link, new object[] { Application.ExecutablePath + ",0" });
            link.GetType().InvokeMember("Description", BindingFlags.SetProperty,
                null, link, new object[] { "DynamicDesktop" });
            link.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            return File.Exists(AutoStartShortcutPath);
        }
        catch (Exception ex) { Log.Write("Could not create Startup shortcut: " + ex.Message); return false; }
        finally { if (link != null) Marshal.FinalReleaseComObject(link); }
    }

    static string AutoStartValue()
    {
        if (InstallProfile.Isolated) return "";
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey))
        {
            string v = k == null ? null : k.GetValue(RunName) as string;
            return v ?? "";
        }
    }

    static void DeleteRunAutoStart()
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            if (k != null) k.DeleteValue(RunName, false);
    }

    static bool IsAutoStart()
    {
        if (InstallProfile.NoAutostart) return false;
        return AutoStartShortcutEnabled()
            || AutoStartValue().IndexOf(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    void SetAutoStart(bool on)
    {
        if (InstallProfile.NoAutostart) return;
        if (InstallProfile.Isolated) return;
        try
        {
            if (on)
            {
                bool shortcut = CreateAutoStartShortcut();
                if (shortcut) DeleteRunAutoStart();
                else
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
                        k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --autostart");
                AutoStartCheck.MarkEnabled();
                Log.Write(shortcut ? "Enabled autostart using Startup folder" : "Enabled autostart using the Run fallback");
            }
            else
            {
                DeleteRunAutoStart();
                if (File.Exists(AutoStartShortcutPath)) File.Delete(AutoStartShortcutPath);
                Log.Write(IsAutoStart() ? "Autostart entry still exists after disabling" : "Disabled autostart");
            }
        }
        catch (Exception ex) { Log.Write("Could not change autostart: " + ex.Message); }
        autoStartItem.Checked = IsAutoStart();
    }

    void StartForm()
    {
        nextStart = DateTime.MaxValue;
        string page = Themes.PageFor(pageDir, Settings.Theme);
        if (page == null)
        {
            Settings.Theme = "beach";
            page = Themes.PageFor(pageDir, Settings.Theme);
        }
        if (page == null)
        {
            Log.Write("No authorized theme is available; retrying in five seconds");
            nextStart = DateTime.Now.AddSeconds(5);
            return;
        }
        displaySignature = DisplaySignature();
        foreach (Screen monitor in Screen.AllScreens)
        {
            var f = new WallpaperForm(pageDir, page, manualPause, monitor.Bounds);
            forms.Add(f);
            if (monitor.Primary || form == null) form = f;
            f.SettingsJson = SettingsMessage;
            f.EnvironmentJson = EnvironmentMessage;
            f.IconsChanged += delegate(string json) { if (f == form && settingsWin != null) settingsWin.Post(json); };
            f.RecordProgress += delegate(string p) { if (f == form && settingsWin != null) settingsWin.Post("{\"t\":\"recProgress\",\"p\":" + p + "}"); };
            f.HandleDestroyed += OnFormGone;
            f.Show();
        }
    }

    static string DisplaySignature()
    {
        var parts = new List<string>();
        foreach (Screen s in Screen.AllScreens) parts.Add(s.DeviceName + ":" + s.Bounds.ToString() + ":" + s.Primary);
        parts.Sort(StringComparer.Ordinal);
        return string.Join("|", parts.ToArray());
    }

    void RebuildForms()
    {
        rebuilding = true;
        foreach (WallpaperForm f in forms.ToArray()) f.Shutdown();
        forms.Clear(); form = null;
        rebuilding = false;
        nextStart = DateTime.Now.AddMilliseconds(500);
    }

    void OnFormGone(object sender, EventArgs e)
    {
        var f = (WallpaperForm)sender;
        if (!forms.Remove(f)) return;
        deadForms.Add(f);
        if (f == form) form = forms.Count > 0 ? forms[0] : null;
        if (rebuilding) return;
        if (exiting) return;
        if (f.Fatal) { Exit(); return; }

        // Stop retrying after repeated destruction to avoid fighting Explorer.
        restarts.Enqueue(DateTime.Now);
        while (restarts.Count > 0 && (DateTime.Now - restarts.Peek()).TotalSeconds > 60) restarts.Dequeue();
        if (restarts.Count > 5)
        {
            Log.Write("Wallpaper window was destroyed over five times in one minute; stopping retries");
            MessageBox.Show(I18n.T("errRebuilt") + "\n\n" + I18n.T("errSeeLog", "path", Log.FilePath), "DynamicDesktop");
            Exit();
            return;
        }
        Log.Write("Explorer destroyed the wallpaper window; reattaching in one second");
        RebuildForms();
        nextStart = DateTime.Now.AddSeconds(1);
    }

    void Watch()
    {
        if (dead != null) { try { dead.Dispose(); } catch { } dead = null; }
        foreach (WallpaperForm f in deadForms.ToArray()) { try { f.Dispose(); } catch { } }
        deadForms.Clear();
        if (exitEvent.WaitOne(0)) { Exit(); return; }
        if (menuEvent.WaitOne(0)) ShowMenu();
        if (settingsEvent.WaitOne(0)) OpenSettings();
        if (DateTime.Now >= saveDue) { saveDue = DateTime.MaxValue; Settings.Save(); }
        if (forms.Count > 0 && DisplaySignature() != displaySignature) RebuildForms();
        if (form == null && !exiting && DateTime.Now >= nextStart) StartForm();
    }

    void Exit()
    {
        if (exiting) return;
        exiting = true;
        watch.Stop();
        if (saveDue != DateTime.MaxValue) Settings.Save();
        if (settingsWin != null) { try { settingsWin.Close(); } catch { } }
        hotkey.Dispose();
        mouseHook.Dispose();
        tray.Visible = false;
        foreach (WallpaperForm f in forms.ToArray()) f.Shutdown();
        Log.Write("Exiting");
        ExitThread();
    }
}

// Hidden message-only window receiving the global hotkey.
class HotkeyWindow : NativeWindow, IDisposable
{
    public event EventHandler Pressed;
    bool registered;

    public HotkeyWindow()
    {
        var cp = new CreateParams();
        cp.Parent = new IntPtr(-3);                     // HWND_MESSAGE
        CreateHandle(cp);
    }

    public bool Register(uint modifiers, Keys key)
    {
        registered = Native.RegisterHotKey(Handle, 1, modifiers, (uint)key);
        return registered;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0312 /* WM_HOTKEY */ && Pressed != null) Pressed(this, EventArgs.Empty);
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (registered) Native.UnregisterHotKey(Handle, 1);
        registered = false;
        if (Handle != IntPtr.Zero) DestroyHandle();
    }
}

// Observe clicks without consuming them, so Explorer and other applications keep their normal input.
class DesktopMouseHook : IDisposable
{
    readonly Native.MouseHookProc callback;
    readonly Action<int, int> clicked;
    IntPtr hook;
    public DesktopMouseHook(Action<int, int> clicked)
    {
        this.clicked = clicked;
        callback = OnMouse;
        hook = Native.SetWindowsHookEx(14, callback, Native.GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) Log.Write("Could not install desktop click observer.");
    }
    IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && message.ToInt32() == 0x0201)
        {
            Native.POINT point = (Native.POINT)Marshal.PtrToStructure(data, typeof(Native.POINT));
            IntPtr target = Native.WindowFromPoint(point);
            while (target != IntPtr.Zero)
            {
                var name = new StringBuilder(128);
                Native.GetClassName(target, name, name.Capacity);
                string c = name.ToString();
                if (c == "SHELLDLL_DefView" || c == "Progman" || c == "WorkerW") { clicked(point.X, point.Y); break; }
                target = Native.GetParent(target);
            }
        }
        return Native.CallNextHookEx(hook, code, message, data);
    }
    public void Dispose() { if (hook != IntPtr.Zero) { Native.UnhookWindowsHookEx(hook); hook = IntPtr.Zero; } }
}

// The tray and settings window share the icon copied by the build script.
static class AppIcon
{
    public static Icon Create()
    {
        return new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "DynamicDesktop.ico"));
    }

    static GraphicsPath RoundRect(Rectangle r, int radius)
    {
        int d = radius * 2;
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

// Normal desktop settings window hosting prototype/settings.html in WebView2.
class SettingsForm : Form
{
    readonly WebView2 web;
    readonly HostContext host;
    readonly string pageDir;

    public SettingsForm(string pageDir, HostContext host)
    {
        this.pageDir = pageDir;
        this.host = host;
        Text = "DynamicDesktop";
        AccessibleName = "DynamicDesktop";
        ShowIcon = true;
        Icon = AppIcon.Create();
        StartPosition = FormStartPosition.CenterScreen;
        float s = Native.GetDpiForSystem() / 96f;       // The process uses physical pixels; scale the window dimensions explicitly.
        ClientSize = new Size((int)(1120 * s), (int)(800 * s));     // Three theme columns on the left; preview above controls on the right.
        MinimumSize = new Size((int)(940 * s), (int)(680 * s));
        BackColor = SystemAppsLight() ? Color.White : Color.FromArgb(23, 23, 23);

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        web.CreationProperties = new CoreWebView2CreationProperties();
        web.CreationProperties.UserDataFolder = Path.Combine(Log.DataDir, "WebView2");
        Controls.Add(web);
    }

    // Match the native title bar to the settings.html background (light #ffffff / dark #171717).
    // Use the system theme for both. Caption color and dark mode require Windows 11; older systems retain their defaults if the calls fail.
    static bool SystemAppsLight()
    {
        try { return Convert.ToInt32(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1)) != 0; }
        catch { return true; }
    }
    void ThemeTitleBar()
    {
        bool light = true;
        try
        {
            object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
            light = v == null || Convert.ToInt32(v) != 0;
        }
        catch { }
        int dark = light ? 0 : 1;
        int color = light ? 0x00FFFFFF : 0x00171717;      // COLORREF uses 0x00BBGGRR.
        Native.DwmSetWindowAttribute(Handle, 20, ref dark, 4);    // DWMWA_USE_IMMERSIVE_DARK_MODE: match title text and buttons to the system theme.
        Native.DwmSetWindowAttribute(Handle, 35, ref color, 4);   // DWMWA_CAPTION_COLOR
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); ThemeTitleBar(); }
    protected override void OnFormClosed(FormClosedEventArgs e) { host.SetSettingsDragging(false); base.OnFormClosed(e); }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0231) host.SetSettingsDragging(true);
        if (m.Msg == 0x0232) host.SetSettingsDragging(false);
        if (m.Msg == 0x001A /* WM_SETTINGCHANGE */) ThemeTitleBar();   // Update the title bar when the system theme changes.
        base.WndProc(ref m);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            await web.EnsureCoreWebView2Async(null);
            if (IsDisposed) return;
            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("app.local", pageDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                try { host.OnSettingsMessage(a.TryGetWebMessageAsString()); }
                catch (Exception ex) { Log.Write("Failed to process settings message: " + ex.Message); }
            };
            string settingsUrl = "https://app.local/settings.html?v=" + Uri.EscapeDataString(Application.ProductVersion);
            Log.Write("Settings page: " + settingsUrl);
            core.Navigate(settingsUrl);
        }
        catch (Exception ex)
        {
            Log.Write("Failed to open the settings window: " + ex);
            MessageBox.Show(I18n.T("errSettings", "msg", ex.Message), "DynamicDesktop");
            Close();
        }
    }

    public void Post(string json)
    {
        // The settings window is temporary. If its WebView2 is invalid, skip the message; reopening it restores the view. Do not propagate the exception to wallpaper polling.
        try { if (!IsDisposed && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(json); }
        catch { }
    }

    // Map the shared image/video folder to https://share.local/ so the settings page can display or play it.
    bool shareMapped;
    public void MapShareFolder(string dir)
    {
        if (shareMapped || IsDisposed || web.CoreWebView2 == null) return;
        web.CoreWebView2.SetVirtualHostNameToFolderMapping("share.local", dir, CoreWebView2HostResourceAccessKind.Allow);
        shareMapped = true;
    }
}

class WallpaperForm : Form
{
    static readonly HashSet<IntPtr> WallpaperWindows = new HashSet<IntPtr>();
    readonly WebView2 web;
    readonly System.Windows.Forms.Timer iconTimer, fgTimer;
    readonly string pageDir;
    readonly IconReader reader = new IconReader();
    Rectangle screen;
    IntPtr parentHwnd, insertAfter;
    string lastIcons = "";
    string lastMasks = "";
    DateTime lastMaskPoll = DateTime.MinValue;
    bool maskInFlight;
    int lastPause = -1;
    bool manualPause, shuttingDown;
    bool iconsDirty = true;
    DateTime lastIconPoll = DateTime.MinValue;

    public bool Fatal { get; private set; }

    string page;                                        // Current theme page (the page field in themes.json).
    public Func<string> SettingsJson;                   // Settings message sent when the page is ready.
    public Func<string> EnvironmentJson;
    public event Action<string> IconsChanged;           // Forward icon changes to the settings preview.
    public string LastIcons { get { return lastIcons; } }
    protected override bool ShowWithoutActivation { get { return true; } }

    public WallpaperForm(string pageDir, string page, bool manualPause, Rectangle bounds)
    {
        this.pageDir = pageDir;
        this.page = page;
        this.manualPause = manualPause;
        this.screen = bounds;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(26, 163, 196);
        Text = "DynamicDesktopWindow";

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        web.CreationProperties = new CoreWebView2CreationProperties();
        web.CreationProperties.UserDataFolder = Path.Combine(Log.DataDir, "WebView2");
        Controls.Add(web);

        iconTimer = new System.Windows.Forms.Timer();
        iconTimer.Interval = 150;
        iconTimer.Tick += delegate { if (iconsDirty || (DateTime.UtcNow - lastIconPoll).TotalSeconds >= 5) PollIcons(); };
        fgTimer = new System.Windows.Forms.Timer();
        fgTimer.Interval = 500;
        fgTimer.Tick += delegate { PollForeground(); };
    }

    public void SetManualPause(bool v) { manualPause = v; PollForeground(); }
    public void RefreshIconMasks() { iconsDirty = true; lastMaskPoll = DateTime.MinValue; }
    public void Ripple(int x, int y)
    {
        if (screen.Contains(x, y)) Post("{\"t\":\"ripple\",\"x\":" + (x - screen.X) + ",\"y\":" + (y - screen.Y) + "}");
    }
    public void SetPassthrough(bool v)
    {
        if (!IsHandleCreated) return;
        int style = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
        Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, v ? style | 0x20 : style & ~0x20);
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x0084 /* WM_NCHITTEST */ && Settings.MousePassthrough)
        {
            message.Result = new IntPtr(-1 /* HTTRANSPARENT */);
            return;
        }
        base.WndProc(ref message);
    }

    // ---- One-click sharing: ask the page to draw a privacy-masked desktop image using icon positions, without taking a screenshot. ----
    Action<string, string, string> snapshotDone;           // (thumbnail, full PNG, error message)
    System.Windows.Forms.Timer snapshotTimeout;
    public void RequestSnapshot(Action<string, string, string> done)
    {
        if (web.CoreWebView2 == null) { done(null, null, I18n.T("errNotReady")); return; }
        if (snapshotDone != null) { done(null, null, I18n.T("errBusyImage")); return; }
        snapshotDone = done;
        snapshotTimeout = new System.Windows.Forms.Timer();
        snapshotTimeout.Interval = 20000;
        snapshotTimeout.Tick += delegate { FinishSnapshot(null, null, I18n.T("errImageTimeout")); };
        snapshotTimeout.Start();
        try { web.CoreWebView2.PostWebMessageAsString("{\"t\":\"snapshot\"}"); }
        catch (InvalidOperationException ex) { FinishSnapshot(null, null, I18n.T("errNotReady")); WebDead(ex); }
        catch (COMException ex) { FinishSnapshot(null, null, I18n.T("errNotReady")); WebDead(ex); }
    }
    void OnSnapshot(string msg)
    {
        string[] p = msg.Split(new[] { '|' }, 3);
        if (p.Length < 3) FinishSnapshot(null, null, I18n.T("errBadData"));
        else if (p[1] == "error") FinishSnapshot(null, null, p[2]);
        else FinishSnapshot(p[1], p[2], null);
    }
    void FinishSnapshot(string thumb, string png, string err)
    {
        if (snapshotTimeout != null) { snapshotTimeout.Stop(); snapshotTimeout.Dispose(); snapshotTimeout = null; }
        var done = snapshotDone;
        snapshotDone = null;
        if (done != null) done(thumb, png, err);
    }

    // ---- Share video: record the theme using the current icon layout, report progress, then send "record|format|poster|full video". ----
    Action<string, string, string, string> recordDone;    // (format, poster, full video, error message)
    System.Windows.Forms.Timer recordTimeout;
    public event Action<string> RecordProgress;            // 0..1 (string)
    public void RequestRecording(Action<string, string, string, string> done)
    {
        if (web.CoreWebView2 == null) { done(null, null, null, I18n.T("errNotReady")); return; }
        if (recordDone != null) { done(null, null, null, I18n.T("errBusyVideo")); return; }
        recordDone = done;
        recordTimeout = new System.Windows.Forms.Timer();
        recordTimeout.Interval = 45000;
        recordTimeout.Tick += delegate { FinishRecord(null, null, null, I18n.T("errVideoTimeout")); };
        recordTimeout.Start();
        try { web.CoreWebView2.PostWebMessageAsString("{\"t\":\"record\"}"); }
        catch (InvalidOperationException ex) { FinishRecord(null, null, null, I18n.T("errNotReady")); WebDead(ex); }
        catch (COMException ex) { FinishRecord(null, null, null, I18n.T("errNotReady")); WebDead(ex); }
    }
    void OnRecord(string msg)
    {
        string[] p = msg.Split(new[] { '|' }, 4);
        if (p.Length >= 3 && p[1] == "error") FinishRecord(null, null, null, msg.Substring(13));
        else if (p.Length < 4) FinishRecord(null, null, null, I18n.T("errBadData"));
        else FinishRecord(p[1], p[2], p[3], null);
    }
    void FinishRecord(string mime, string poster, string video, string err)
    {
        if (recordTimeout != null) { recordTimeout.Stop(); recordTimeout.Dispose(); recordTimeout = null; }
        var done = recordDone;
        recordDone = null;
        if (done != null) done(mime, poster, video, err);
    }
    public void Reload()
    {
        if (web.CoreWebView2 == null) return;
        try { web.CoreWebView2.Reload(); }
        catch (InvalidOperationException ex) { WebDead(ex); }
        catch (COMException ex) { WebDead(ex); }
    }
    public void Post(string json)
    {
        if (web.CoreWebView2 == null) return;
        try { web.CoreWebView2.PostWebMessageAsString(json); }
        catch (InvalidOperationException ex) { WebDead(ex); }
        catch (COMException ex) { WebDead(ex); }
    }

    // After a background WebView2 runtime update or browser process termination, CoreWebView2 may be non-null but disposed; every call throws.
    // A null check cannot detect this. Use the existing destroyed-wallpaper-window recovery path: tear down this window and let HostContext rebuild it after one second.
    void WebDead(Exception ex)
    {
        if (shuttingDown) return;
        Log.Write("WebView2 became unavailable (runtime update or process exit); remounting the wallpaper window: " + ex.Message);
        Shutdown();
    }
    string PageUrl { get { return "https://app.local/" + page + (page.Contains("?") ? "&" : "?") + "wallpaper=1"; } }

    // Switch themes by navigating to the new page; resend settings and icons when it is ready.
    public void LoadPage(string newPage)
    {
        page = newPage;
        if (web.CoreWebView2 == null) return;
        try { web.CoreWebView2.Navigate(PageUrl); }
        catch (InvalidOperationException ex) { WebDead(ex); }
        catch (COMException ex) { WebDead(ex); }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            string pageFile = Path.Combine(pageDir, page.Split('?')[0]);
            if (!File.Exists(pageFile))
            {
                Fail(I18n.T("errNoPage", "path", pageFile));
                return;
            }
            if (!AttachToDesktop())
            {
                Fail(I18n.T("errNoDesktop"));
                return;
            }
            await web.EnsureCoreWebView2Async(null);
            if (shuttingDown || IsDisposed) return;
            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("app.local", pageDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            // When the page sends "ready", send settings first, then icons and pause state; shoreline calculations need the configured offshore distance.
            // For one-click sharing, the page sends "snapshot|thumbnail|full PNG" as data URLs; the full image is too large to send as JSON.
            core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = null;
                try { msg = a.TryGetWebMessageAsString(); } catch { }
                if (msg != null && msg.StartsWith("snapshot|")) { OnSnapshot(msg); return; }
                if (msg != null && msg.StartsWith("recprogress|")) { if (RecordProgress != null) RecordProgress(msg.Substring(12)); return; }
                if (msg != null && msg.StartsWith("record|")) { OnRecord(msg); return; }
                if (SettingsJson != null) core.PostWebMessageAsString(SettingsJson());
                if (EnvironmentJson != null) core.PostWebMessageAsString(EnvironmentJson());
                lastIcons = ""; lastMasks = ""; lastMaskPoll = DateTime.MinValue; lastPause = -1; PollIcons(); PollForeground();
            };
            core.Navigate(PageUrl);
            iconTimer.Start();
            fgTimer.Start();
            Log.Write("WebView2 ready: " + core.Environment.BrowserVersionString);
        }
        catch (Exception ex)
        {
            if (shuttingDown || IsDisposed) return;       // The system destroyed the window during startup; let HostContext retry.
            Log.Write("Startup failed: " + ex);
            Fail(I18n.T("errStart", "msg", ex.Message));
        }
    }

    void Fail(string msg)
    {
        Log.Write(msg);
        MessageBox.Show(msg + "\n\n" + I18n.T("errSeeLog", "path", Log.FilePath), "DynamicDesktop");
        Fatal = true;
        Shutdown();
    }

    // ---------------------------------------------------------------- Attach to the wallpaper layer
    // Two desktop layouts:
    //   - Windows 11 24H2 and later ("raised desktop"): Progman contains the icon layer (SHELLDLL_DefView), then the system wallpaper layer (WorkerW).
    //     The system wallpaper layer is destroyed and recreated when the wallpaper changes (slideshow / Spotlight), so do not attach inside it. Instead create a
    //     layered child of Progman (WS_EX_LAYERED, alpha 255), directly below the icon layer and above the system wallpaper layer, and maintain that order.
    //     Progman has no surface for an ordinary child window to draw on, so a layered window is required. Layered children require Windows 8+ support in app.manifest.
    //   - Older versions: the icon layer is inside a top-level WorkerW, immediately followed by the top-level WorkerW that draws the wallpaper; attach to that WorkerW.
    public static string AttachMode = "progman";
    bool raised;
    IntPtr zAnchor;                                     // Window immediately above ours (icon list / icon layer).
    IntPtr winEventHook;
    Native.WinEventDelegate winEventProc;               // Keep a reference to prevent garbage collection.

    static IntPtr FindClassicWorker()
    {
        IntPtr host = IntPtr.Zero;
        Native.EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            if (Native.FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { host = h; return false; }
            return true;
        }, IntPtr.Zero);
        return host != IntPtr.Zero ? Native.FindWindowEx(IntPtr.Zero, host, "WorkerW", null) : IntPtr.Zero;
    }

    // Ask Explorer to create the wallpaper layer and wait up to two seconds. Send 0xD,1 only once; sending 0xD,0 afterwards removes the newly created layer.
    static void RequestWorkerW(IntPtr progman, Func<bool> ready)
    {
        IntPtr res;
        Native.SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out res);
        for (int i = 0; i < 20 && !ready(); i++) Thread.Sleep(100);
    }

    bool AttachToDesktop()
    {
        // Screen bounds use physical pixels because the process is per-monitor DPI aware.
        IntPtr progman = Native.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) { Log.Write("Could not find Progman"); return false; }
        IntPtr defView = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        string mode;
        raised = defView != IntPtr.Zero;

        if (raised)
        {
            if (Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null) == IntPtr.Zero)
                RequestWorkerW(progman, delegate { return Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null) != IntPtr.Zero; });
            IntPtr listView = Native.FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
            if (AttachMode == "legacy")
            {
                parentHwnd = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
                if (parentHwnd == IntPtr.Zero) { Log.Write("Could not find WorkerW"); return false; }
                insertAfter = IntPtr.Zero; raised = false; mode = "24H2+ legacy: WorkerW child window";
            }
            else if (AttachMode == "defview" && listView != IntPtr.Zero)
            {
                // Experimental: attach inside the icon layer below the icon list. Wallpaper changes do not reorder it, but drawing did not work on 24H2 in testing.
                parentHwnd = defView; insertAfter = listView; zAnchor = listView;
                mode = "24H2+: layered child of the icon layer (DefView), below the icon list";
            }
            else
            {
                parentHwnd = progman; insertAfter = defView; zAnchor = defView;
                mode = "24H2+: layered child of Progman, below the icon layer";
            }
            if (raised)
            {
                int ex = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
                Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, ex | Native.WS_EX_LAYERED);
                Native.SetLayeredWindowAttributes(Handle, 0, 255, Native.LWA_ALPHA);
            }
        }
        else
        {
            IntPtr worker = FindClassicWorker();
            if (worker == IntPtr.Zero)
            {
                RequestWorkerW(progman, delegate { return FindClassicWorker() != IntPtr.Zero; });
                worker = FindClassicWorker();
            }
            if (worker == IntPtr.Zero) { Log.Write("Could not find WorkerW / SHELLDLL_DefView"); return false; }
            parentHwnd = worker; insertAfter = IntPtr.Zero; mode = "Classic: child of top-level WorkerW";
        }

        int style = Native.GetWindowLong(Handle, Native.GWL_STYLE);
        style = (style & ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME)) | Native.WS_CHILD | Native.WS_VISIBLE;
        Native.SetWindowLong(Handle, Native.GWL_STYLE, style);
        SetPassthrough(Settings.MousePassthrough);
        Native.SetParent(Handle, parentHwnd);

        var pt = new Native.POINT { X = screen.X, Y = screen.Y };
        Native.ScreenToClient(parentHwnd, ref pt);
        Native.SetWindowPos(Handle, insertAfter, pt.X, pt.Y, screen.Width, screen.Height,
            Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
        WallpaperWindows.Add(Handle);
        EnsureZOrder();

        // Explorer reports icon moves, visibility changes and rearrangements through WinEvents.
        // Polling remains as a fallback for shell implementations that omit an event.
        {
            // Correct the order immediately when Explorer creates or rearranges wallpaper layers; changing wallpaper inserts a new WorkerW above us.
            uint pid;
            Native.GetWindowThreadProcessId(progman, out pid);
            winEventProc = delegate(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
            {
                if (shuttingDown || !IsHandleCreated) return;
                if (idObject == 0 && ev <= 0x8004) EnsureZOrder();
                iconsDirty = true;
            };
            winEventHook = Native.SetWinEventHook(0x8000 /* OBJECT_CREATE */, 0x800B /* OBJECT_LOCATIONCHANGE */, IntPtr.Zero,
                winEventProc, pid, 0, 0 /* WINEVENT_OUTOFCONTEXT */);
        }
        Log.Write(string.Format("Attached ({0}), screen {1}", mode, screen));
        return true;
    }

    // Keep this window immediately below zAnchor (icon list / icon layer). For Progman, also move the system wallpaper layer to the bottom when the order changes.
    int zFixes;
    void EnsureZOrder()
    {
        if (!raised || zAnchor == IntPtr.Zero || !Native.IsWindow(zAnchor)) return;
        bool fixedAny = false;
        IntPtr next = Native.GetWindow(zAnchor, 2 /* GW_HWNDNEXT */);
        while (next != IntPtr.Zero && next != Handle && WallpaperWindows.Contains(next)) next = Native.GetWindow(next, 2);
        if (next != Handle)
        {
            Native.SetWindowPos(Handle, zAnchor, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            fixedAny = true;
        }
        if (AttachMode == "progman")
        {
            var workers = new List<IntPtr>();
            for (IntPtr w = Native.FindWindowEx(parentHwnd, IntPtr.Zero, "WorkerW", null); w != IntPtr.Zero;
                 w = Native.FindWindowEx(parentHwnd, w, "WorkerW", null)) workers.Add(w);
            foreach (IntPtr worker in workers)
            {
                IntPtr sibling = Native.GetWindow(worker, 2);
                while (sibling != IntPtr.Zero && workers.Contains(sibling)) sibling = Native.GetWindow(sibling, 2);
                if (sibling != IntPtr.Zero)
                {
                    Native.SetWindowPos(worker, new IntPtr(1) /* HWND_BOTTOM */, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                    fixedAny = true;
                }
            }
        }
        if (fixedAny && ++zFixes <= 20) Log.Write("Corrected desktop Z-order after Explorer rearranged windows");
    }

    // ---------------------------------------------------------------- Read desktop icons
    void PollIcons()
    {
        iconsDirty = false; lastIconPoll = DateTime.UtcNow;
        EnsureZOrder();
        if (web.CoreWebView2 == null) return;
        bool visible;
        List<Native.RECT> rects = reader.Read(out visible);
        if (rects == null) return;
        var sb = new StringBuilder();
        sb.Append("{\"t\":\"icons\",\"vis\":").Append(visible ? "true" : "false").Append(",\"r\":[");
        bool first = true;
        for (int i = 0; i < rects.Count; i++)
        {
            Native.RECT r = rects[i];
            if (r.Right <= screen.Left || r.Left >= screen.Right || r.Bottom <= screen.Top || r.Top >= screen.Bottom) continue;
            if (!first) sb.Append(',');
            first = false;
            sb.Append('[').Append(r.Left - screen.X).Append(',').Append(r.Top - screen.Y).Append(',')
              .Append(r.Right - screen.X).Append(',').Append(r.Bottom - screen.Y).Append(']');
        }
        sb.Append("]}");
        string json = sb.ToString();
        bool changed = json != lastIcons;
        if (changed)
        {
            lastIcons = json;
            if (IconsChanged != null) IconsChanged(json);
            Post(json);
            Log.Write(string.Format("Desktop icons changed: {0}, visible={1}", rects.Count, visible));
        }
        if (!Settings.IconShadowsEnabled())
        {
            if (lastMasks.Length != 0)
            {
                lastMasks = "";
                Post("{\"t\":\"iconMasks\",\"v\":[]}");
            }
        }
        else if (changed || (DateTime.UtcNow - lastMaskPoll).TotalSeconds >= 5)
        {
            lastMaskPoll = DateTime.UtcNow;
            QueueMasks(json, visible);
        }
    }

    // Shell icon extraction may involve slow files or network locations. Keep it
    // off the UI thread and use a separate remote buffer from the icon poller.
    void QueueMasks(string expectedIcons, bool visible)
    {
        if (!visible)
        {
            string empty = "{\"t\":\"iconMasks\",\"v\":[]}";
            if (empty != lastMasks) { lastMasks = empty; Post(empty); }
            return;
        }
        if (maskInFlight || shuttingDown) return;
        maskInFlight = true;
        Rectangle bounds = screen;
        var worker = new Thread(delegate()
        {
            string masks = null;
            try
            {
                using (var backgroundReader = new IconReader())
                {
                    bool currentVisible;
                    if (backgroundReader.Read(out currentVisible) != null)
                    {
                        var serializer = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
                        masks = serializer.Serialize(Json.Obj("t", "iconMasks", "v", backgroundReader.ReadMasks(bounds, currentVisible)));
                    }
                }
            }
            catch (Exception ex) { Log.Write("Could not extract desktop icon masks: " + ex.Message); }
            try
            {
                if (!IsDisposed && IsHandleCreated) BeginInvoke((MethodInvoker)delegate
                {
                    maskInFlight = false;
                    if (shuttingDown || !Settings.IconShadowsEnabled()) return;
                    if (lastIcons != expectedIcons) { iconsDirty = true; lastMaskPoll = DateTime.MinValue; return; }
                    if (masks != null && masks != lastMasks) { lastMasks = masks; Post(masks); }
                });
            }
            catch (InvalidOperationException) { }
        });
        worker.IsBackground = true;
        worker.SetApartmentState(ApartmentState.STA);
        worker.Start();
    }

    // ---------------------------------------------------------------- Pause for maximized / fullscreen windows
    void PollForeground()
    {
        if (web.CoreWebView2 == null) return;
        bool pause = manualPause || DesktopCoverage.Covers(screen);
        int p = pause ? 1 : 0;
        if (p == lastPause) return;
        lastPause = p;
        Post("{\"t\":\"pause\",\"v\":" + (pause ? "true" : "false") + "}");
        Log.Write(string.Format("{0} on {1}", pause ? "Paused" : "Resumed", screen));
    }

    // ---------------------------------------------------------------- Exit: remove the window and let Explorer redraw the original wallpaper
    public void Shutdown()
    {
        if (shuttingDown) return;
        shuttingDown = true;
        iconTimer.Stop(); fgTimer.Stop();
        reader.Dispose();
        IntPtr parent = parentHwnd;
        try { web.Dispose(); } catch { }
        if (IsHandleCreated) { Native.SetParent(Handle, IntPtr.Zero); Hide(); }
        // Do not change wallpaper settings, including slideshow / Spotlight; only ask Explorer to redraw.
        if (parent != IntPtr.Zero && Native.IsWindow(parent))
            Native.RedrawWindow(parent, IntPtr.Zero, IntPtr.Zero, 0x1 | 0x4 | 0x80 | 0x100);
        Close();
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        WallpaperWindows.Remove(Handle);
        if (winEventHook != IntPtr.Zero) { Native.UnhookWinEvent(winEventHook); winEventHook = IntPtr.Zero; }
        iconTimer.Stop(); fgTimer.Stop();
        reader.Dispose();
        base.OnHandleDestroyed(e);
    }
}

// Share one snapshot of top-level windows across the wallpaper timers.
static class DesktopCoverage
{
    static readonly uint OwnProcess = (uint)Process.GetCurrentProcess().Id;
    static readonly List<Rectangle> FullscreenCandidates = new List<Rectangle>();
    static readonly List<Point> MaximizedCenters = new List<Point>();
    static DateTime lastScan = DateTime.MinValue;

    public static bool Covers(Rectangle monitor)
    {
        DateTime now = DateTime.UtcNow;
        if ((now - lastScan).TotalMilliseconds >= 250)
        {
            lastScan = now;
            FullscreenCandidates.Clear();
            MaximizedCenters.Clear();
            var name = new StringBuilder(64);
            Native.EnumWindows(delegate(IntPtr window, IntPtr unused) {
                if (!Native.IsWindowVisible(window) || Native.IsIconic(window)) return true;
                uint process;
                Native.GetWindowThreadProcessId(window, out process);
                if (process == OwnProcess) return true;
                int cloaked;
                if (Native.DwmGetWindowAttribute(window, 14 /* DWMWA_CLOAKED */, out cloaked, 4) == 0 && cloaked != 0) return true;
                Native.GetClassName(window, name, name.Capacity);
                string className = name.ToString();
                if (className == "Progman" || className == "WorkerW" || className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd")
                    return true;
                Native.RECT rect;
                if (!Native.GetWindowRect(window, out rect) || rect.Right <= rect.Left || rect.Bottom <= rect.Top) return true;
                Rectangle bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
                FullscreenCandidates.Add(bounds);
                if (Native.IsZoomed(window)) MaximizedCenters.Add(new Point(bounds.Left + bounds.Width / 2, bounds.Top + bounds.Height / 2));
                return true;
            }, IntPtr.Zero);
        }
        foreach (Rectangle window in FullscreenCandidates) if (window.Contains(monitor)) return true;
        foreach (Point center in MaximizedCenters) if (monitor.Contains(center)) return true;
        return false;
    }
}

// Read icon rectangles (icon and text, physical pixels, screen coordinates) through cross-process desktop ListView messages.
class IconReader : IDisposable
{
    IntPtr listView, proc, mem;
    static readonly Dictionary<string, string> maskCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    static DateTime cacheExpiry = DateTime.MinValue;

    static IntPtr FindListView()
    {
        IntPtr defView = IntPtr.Zero;
        IntPtr progman = Native.FindWindow("Progman", null);
        if (progman != IntPtr.Zero) defView = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (defView == IntPtr.Zero)
        {
            Native.EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                IntPtr d = Native.FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (d != IntPtr.Zero) { defView = d; return false; }
                return true;
            }, IntPtr.Zero);
        }
        return defView == IntPtr.Zero ? IntPtr.Zero : Native.FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
    }

    bool Open()
    {
        Close();
        listView = FindListView();
        if (listView == IntPtr.Zero) return false;
        uint pid;
        Native.GetWindowThreadProcessId(listView, out pid);
        proc = Native.OpenProcess(0x0008 | 0x0010 | 0x0020, false, pid);   // VM_OPERATION | VM_READ | VM_WRITE
        if (proc == IntPtr.Zero) return false;
        mem = Native.VirtualAllocEx(proc, IntPtr.Zero, new IntPtr(2048), 0x1000 | 0x2000, 0x04);
        return mem != IntPtr.Zero;
    }

    public List<Native.RECT> Read(out bool visible)
    {
        visible = false;
        if (listView == IntPtr.Zero || mem == IntPtr.Zero || !Native.IsWindow(listView)) { if (!Open()) return null; }
        visible = Native.IsWindowVisible(listView);
        var result = new List<Native.RECT>();
        if (!visible) return result;                   // Desktop icons are hidden; the scene is all sea.
        int count = (int)Native.SendMessage(listView, 0x1004 /* LVM_GETITEMCOUNT */, IntPtr.Zero, IntPtr.Zero);
        var origin = new Native.POINT();
        Native.ClientToScreen(listView, ref origin);
        for (int i = 0; i < count; i++)
        {
            var r = new Native.RECT();                 // Left = LVIR_BOUNDS (0): bounds of the icon and text together.
            IntPtr n;
            if (!Native.WriteProcessMemory(proc, mem, ref r, 16, out n)) { Close(); return null; }
            Native.SendMessage(listView, 0x100E /* LVM_GETITEMRECT */, new IntPtr(i), mem);
            if (!Native.ReadProcessMemory(proc, mem, out r, 16, out n)) { Close(); return null; }
            r.Left += origin.X; r.Right += origin.X; r.Top += origin.Y; r.Bottom += origin.Y;
            result.Add(r);
        }
        return result;
    }

    // Explorer's item names and shell paths stay in this process; only icon pixels go to the wallpaper.
    public List<object> ReadMasks(Rectangle screen, bool visible)
    {
        var result = new List<object>();
        if (!visible || proc == IntPtr.Zero || mem == IntPtr.Zero) return result;
        lock (maskCache)
            if (DateTime.UtcNow >= cacheExpiry) { maskCache.Clear(); cacheExpiry = DateTime.UtcNow.AddSeconds(60); }
        var paths = DesktopPaths();
        int count = (int)Native.SendMessage(listView, 0x1004, IntPtr.Zero, IntPtr.Zero);
        var origin = new Native.POINT(); Native.ClientToScreen(listView, ref origin);
        for (int i = 0; i < count; i++)
        {
            var iconRect = new Native.RECT { Left = 1 }; IntPtr n;
            if (!Native.WriteProcessMemory(proc, mem, ref iconRect, 16, out n)) break;
            if (Native.SendMessage(listView, 0x100E, new IntPtr(i), mem) == IntPtr.Zero) continue;
            if (!Native.ReadProcessMemory(proc, mem, out iconRect, 16, out n)) break;
            iconRect.Left += origin.X; iconRect.Right += origin.X; iconRect.Top += origin.Y; iconRect.Bottom += origin.Y;
            int w = iconRect.Right - iconRect.Left, h = iconRect.Bottom - iconRect.Top;
            if (w <= 0 || h <= 0 || w > 512 || h > 512 || iconRect.Right <= screen.Left || iconRect.Left >= screen.Right || iconRect.Bottom <= screen.Top || iconRect.Top >= screen.Bottom) continue;
            byte[] item = new byte[88];
            byte[] pointer = BitConverter.GetBytes(mem.ToInt64() + 256);
            Array.Copy(pointer, 0, item, 24, 8);
            Array.Copy(BitConverter.GetBytes(512), 0, item, 32, 4);
            if (!Native.WriteProcessBytes(proc, mem, item, item.Length, out n)) break;
            Native.SendMessage(listView, 0x1073, new IntPtr(i), mem);
            byte[] text = new byte[1024];
            if (!Native.ReadProcessBytes(proc, new IntPtr(mem.ToInt64() + 256), text, text.Length, out n)) break;
            string name = Encoding.Unicode.GetString(text).TrimEnd('\0');
            int zero = name.IndexOf('\0'); if (zero >= 0) name = name.Substring(0, zero);
            string path, png;
            if (!paths.TryGetValue(name, out path)) continue;
            string key = path + "|" + w + "x" + h;
            lock (maskCache) maskCache.TryGetValue(key, out png);
            if (png == null)
            {
                png = ReadIconPng(path, w, h);
                if (png != null) lock (maskCache) maskCache[key] = png;
            }
            if (png != null) result.Add(Json.Obj("x", iconRect.Left - screen.X, "y", iconRect.Top - screen.Y, "w", w, "h", h, "src", png));
        }
        return result;
    }

    static Dictionary<string, string> DesktopPaths()
    {
        var paths = new Dictionary<string, string>(StringComparer.CurrentCultureIgnoreCase);
        try
        {
            Type type = Type.GetTypeFromProgID("Shell.Application");
            object shell = Activator.CreateInstance(type);
            object folder = type.InvokeMember("NameSpace", BindingFlags.InvokeMethod, null, shell, new object[] { 0 });
            object items = folder.GetType().InvokeMember("Items", BindingFlags.InvokeMethod, null, folder, null);
            foreach (object item in (System.Collections.IEnumerable)items)
            {
                string name = item.GetType().InvokeMember("Name", BindingFlags.GetProperty, null, item, null) as string;
                string path = item.GetType().InvokeMember("Path", BindingFlags.GetProperty, null, item, null) as string;
                if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(path) && !paths.ContainsKey(name)) paths.Add(name, path);
            }
        }
        catch (Exception ex) { Log.Write("Could not enumerate desktop icon sources: " + ex.Message); }
        return paths;
    }

    static string ReadIconPng(string path, int w, int h)
    {
        Native.SHFILEINFO info = new Native.SHFILEINFO();
        IntPtr pidl; uint attributes;
        if (Native.SHParseDisplayName(path, IntPtr.Zero, out pidl, 0, out attributes) != 0 || pidl == IntPtr.Zero) return null;
        try { Native.SHGetFileInfoPidl(pidl, 0, ref info, (uint)Marshal.SizeOf(info), 0x100 | 0x20 | 0x8); }
        finally { Marshal.FreeCoTaskMem(pidl); }
        if (info.hIcon == IntPtr.Zero) return null;
        try
        {
            using (Icon icon = Icon.FromHandle(info.hIcon))
            using (var bitmap = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
            using (Graphics g = Graphics.FromImage(bitmap))
            using (var stream = new MemoryStream())
            {
                g.Clear(Color.Transparent); g.DrawIcon(icon, new Rectangle(0, 0, w, h));
                bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
                return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
            }
        }
        catch { return null; }
        finally { Native.DestroyIcon(info.hIcon); }
    }

    void Close()
    {
        if (mem != IntPtr.Zero && proc != IntPtr.Zero) Native.VirtualFreeEx(proc, mem, IntPtr.Zero, 0x8000);
        if (proc != IntPtr.Zero) Native.CloseHandle(proc);
        mem = proc = IntPtr.Zero;
    }

    public void Dispose() { Close(); }
}

static class Native
{
    public const int GWL_STYLE = -16, GWL_EXSTYLE = -20, WS_EX_LAYERED = 0x00080000;
    public const uint LWA_ALPHA = 0x2, SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002;
    public const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_NOREPEAT = 0x4000;
    public const int SW_SHOW = 5, SW_RESTORE = 9;
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint vk);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)] public static extern bool WTSQuerySessionInformation(IntPtr server, int session, int infoClass, out IntPtr buffer, out int bytes);
    [DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr p);
    public delegate void WinEventDelegate(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    public delegate IntPtr MouseHookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int id, MouseHookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventDelegate proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
    public const int WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_POPUP = unchecked((int)0x80000000);
    public const int WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000;
    public const uint SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_FRAMECHANGED = 0x0020;

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SHFILEINFO
    {
        public IntPtr hIcon; public int iIcon; public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SHParseDisplayName(string name, IntPtr binding, out IntPtr pidl, uint attrsIn, out uint attrsOut);
    [DllImport("shell32.dll", EntryPoint = "SHGetFileInfoW")] public static extern IntPtr SHGetFileInfoPidl(IntPtr pidl, uint attrs, ref SHFILEINFO info, uint size, uint flags);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int index, int value);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr h, IntPtr rect, IntPtr rgn, uint flags);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr proc, IntPtr addr, IntPtr size, uint type, uint protect);
    [DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr proc, IntPtr addr, IntPtr size, uint type);
    [DllImport("kernel32.dll")] public static extern bool WriteProcessMemory(IntPtr proc, IntPtr addr, ref RECT buf, int size, out IntPtr written);
    [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr proc, IntPtr addr, out RECT buf, int size, out IntPtr read);
    [DllImport("kernel32.dll", EntryPoint = "WriteProcessMemory")] public static extern bool WriteProcessBytes(IntPtr proc, IntPtr addr, byte[] buf, int size, out IntPtr written);
    [DllImport("kernel32.dll", EntryPoint = "ReadProcessMemory")] public static extern bool ReadProcessBytes(IntPtr proc, IntPtr addr, byte[] buf, int size, out IntPtr read);
}

// DynamicDesktop has its own data and instance identity; isolated profiles support installation QA.
static class InstallProfile
{
    static readonly string[] Arguments = Environment.GetCommandLineArgs();
    public static readonly bool Portable = Array.IndexOf(Arguments, "--portable") >= 0;
    public static readonly bool Test = Array.IndexOf(Arguments, "--test") >= 0;
    public static bool NoAutostart { get { return Isolated; } }
    public static readonly string Override = SelectProfile();
    static string SelectProfile()
    {
        string explicitProfile = Environment.GetEnvironmentVariable("DYNAMICDESKTOP_PROFILE_DIR");
        if (!string.IsNullOrEmpty(explicitProfile)) return explicitProfile;
        if (Test) return Path.Combine(Path.GetTempPath(), "DynamicDesktop-test");
        if (Portable) return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
        return null;
    }
    public static readonly bool Isolated = !string.IsNullOrEmpty(Override);
    public static readonly string DataDir = Isolated ? Path.GetFullPath(Override) : Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DynamicDesktop");
    public static readonly string Suffix = MakeSuffix();
    static string MakeSuffix()
    {
        if (!Isolated) return "_Preview";
        using (var hash = System.Security.Cryptography.SHA256.Create())
            return "_Preview_" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(DataDir.ToUpperInvariant()))).Replace("-", "").Substring(0, 24);
    }

    // An installer may only close the instance using this exact executable path.
    public static int StopInstalled()
    {
        foreach (Process process in Process.GetProcessesByName("DynamicDesktop"))
        {
            using (process)
            {
                if (process.Id == Process.GetCurrentProcess().Id) continue;
                try
                {
                    if (!string.Equals(process.MainModule.FileName, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)) continue;
                    EventWaitHandle ev;
                    if (!EventWaitHandle.TryOpenExisting(Program.ExitEventName, out ev)) return 1;
                    using (ev) ev.Set();
                    if (!process.WaitForExit(10000)) return 1;
                }
                catch (InvalidOperationException) { }
                catch { return 1; }
            }
        }
        return 0;
    }
}
