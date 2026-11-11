using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

// Read theme pages and compatibility mappings from the local catalog.
static class Themes
{
    static Dictionary<string, object> Read(string pageDir)
    {
        try { return Json.Parse(File.ReadAllText(Path.Combine(pageDir, "themes.json"), Encoding.UTF8)) as Dictionary<string, object>; }
        catch (Exception ex) { Log.Write("Could not read themes.json: " + ex.Message); return null; }
    }

    static Dictionary<string, object> Find(string pageDir, string id)
    {
        if (id == null) return null;
        var root = Read(pageDir);
        object themes;
        if (root == null || !root.TryGetValue("themes", out themes) || !(themes is object[])) return null;
        foreach (object o in (object[])themes)
        {
            var theme = o as Dictionary<string, object>;
            object themeId, status;
            if (theme != null && theme.TryGetValue("id", out themeId) && (themeId as string) == id &&
                theme.TryGetValue("status", out status) && (status as string) == "ready") return theme;
        }
        return null;
    }

    public static string PageFor(string pageDir, string id)
    {
        var theme = Find(pageDir, id);
        if (theme == null) return null;
        object pagesValue, variantValue;
        if (theme.TryGetValue("variantPages", out pagesValue) && pagesValue is object[])
        {
            var pages = (object[])pagesValue;
            int variant;
            Dictionary<string, object> values;
            if (Settings.Params.TryGetValue(id, out values) && values.TryGetValue("variant", out variantValue) &&
                Int32.TryParse(Convert.ToString(variantValue, System.Globalization.CultureInfo.InvariantCulture), out variant) &&
                variant >= 0 && variant < pages.Length && pages[variant] is string) return (string)pages[variant];
            if (pages.Length > 0 && pages[0] is string) return (string)pages[0];
        }
        return theme["page"] as string;
    }

    public static bool Migrate(string pageDir)
    {
        var root = Read(pageDir);
        object aliasesValue;
        if (root == null || !root.TryGetValue("aliases", out aliasesValue)) return false;
        var aliases = aliasesValue as Dictionary<string, object>;
        if (aliases == null) return false;
        string active = Settings.Theme;
        bool changed = false;
        // Merge the active alias last so its preferences take precedence.
        var ids = new List<string>(aliases.Keys);
        ids.Remove(active);
        if (aliases.ContainsKey(active)) ids.Add(active);
        foreach (string id in ids)
        {
            var alias = aliases[id] as Dictionary<string, object>;
            object targetValue;
            if (alias == null || !alias.TryGetValue("id", out targetValue) || !(targetValue is string)) continue;
            string target = (string)targetValue;
            Dictionary<string, object> old;
            bool isActive = id == active;
            if (Settings.Params.TryGetValue(id, out old))
            {
                var dest = Settings.For(target);
                object renameValue;
                var rename = alias.TryGetValue("rename", out renameValue) ? renameValue as Dictionary<string, object> : null;
                foreach (var item in old)
                {
                    object renamed;
                    string key = rename != null && rename.TryGetValue(item.Key, out renamed) && renamed is string ? (string)renamed : item.Key;
                    if (isActive || !dest.ContainsKey(key)) dest[key] = item.Value;
                }
                Settings.Params.Remove(id);
                changed = true;
            }
            if (isActive)
            {
                Settings.Theme = target;
                object forcedValue;
                var forced = alias.TryGetValue("params", out forcedValue) ? forcedValue as Dictionary<string, object> : null;
                if (forced != null) foreach (var item in forced) Settings.For(target)[item.Key] = item.Value;
                changed = true;
            }
        }
        return changed;
    }
}
