using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

// Read the theme pages listed in the local catalog.
static class Themes
{
    static Dictionary<string, object> Find(string pageDir, string id)
    {
        if (id == null) return null;
        try
        {
            var root = Json.Parse(File.ReadAllText(Path.Combine(pageDir, "themes.json"), Encoding.UTF8)) as Dictionary<string, object>;
            if (root == null) return null;
            foreach (object o in (System.Collections.IEnumerable)root["themes"])
            {
                var theme = o as Dictionary<string, object>;
                if (theme != null && (theme["id"] as string) == id &&
                    theme.ContainsKey("status") && (theme["status"] as string) == "ready")
                    return theme;
            }
        }
        catch (Exception ex) { Log.Write("Could not read themes.json: " + ex.Message); }
        return null;
    }

    public static string PageFor(string pageDir, string id)
    {
        var theme = Find(pageDir, id);
        return theme == null ? null : theme["page"] as string;
    }
}
