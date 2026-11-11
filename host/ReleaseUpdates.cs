using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal sealed class ReleaseUpdate
{
    public Version Version { get; internal set; }
    public string AssetName { get; internal set; }
    internal string AssetUrl;
    internal long AssetSize;
    internal string Digest;
    internal string ChecksumUrl;
    internal long ChecksumSize;
}

internal sealed class ReleaseFeedUnavailableException : InvalidOperationException
{
    public ReleaseFeedUnavailableException(string message, Exception inner) : base(message, inner) { }
}

internal static class ReleaseUpdates
{
    const string LatestUrl = "https://api.github.com/repos/Timminater/DynamicDesktop/releases/latest";
    const long MaxInstallerSize = 512L * 1024 * 1024;
    const int MaxMetadataSize = 2 * 1024 * 1024;
    const int MaxChecksumSize = 4096;
    const int MaxRedirects = 5;
    static readonly Regex TagPattern = new Regex(@"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$", RegexOptions.CultureInvariant);
    static readonly Regex HashPattern = new Regex(@"^[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant);

    public static ReleaseUpdate Check(Version installed)
    {
        if (installed == null) throw new ArgumentNullException("installed");
        byte[] data;
        try { data = ReadBounded(LatestUrl, MaxMetadataSize, true); }
        catch (WebException ex)
        {
            HttpWebResponse response = ex.Response as HttpWebResponse;
            if (response != null && response.StatusCode == HttpStatusCode.NotFound)
            {
                response.Dispose();
                throw new ReleaseFeedUnavailableException("No public published release was found. The repository may be private or have no release.", ex);
            }
            throw new InvalidOperationException("Could not check for updates. " + ex.Message, ex);
        }
        return SelectRelease(Encoding.UTF8.GetString(data), installed);
    }

    // Kept independent of networking so release metadata can be validated in isolation.
    internal static ReleaseUpdate SelectRelease(string json, Version installed)
    {
        if (installed == null) throw new ArgumentNullException("installed");
        Dictionary<string, object> release;
        try { release = new JavaScriptSerializer { MaxJsonLength = MaxMetadataSize }.DeserializeObject(json) as Dictionary<string, object>; }
        catch (Exception ex) { throw new InvalidOperationException("Invalid release metadata.", ex); }
        if (release == null || Bool(release, "draft") || Bool(release, "prerelease"))
            throw new InvalidOperationException("The latest release is not a published stable release.");
        string tag = StringValue(release, "tag_name");
        Match match = TagPattern.Match(tag ?? "");
        int major, minor, patch;
        if (!match.Success || !Int32.TryParse(match.Groups[1].Value, out major) || !Int32.TryParse(match.Groups[2].Value, out minor) || !Int32.TryParse(match.Groups[3].Value, out patch))
            throw new InvalidOperationException("The latest release has an invalid stable version tag.");
        Version version = new Version(major, minor, patch, 0);
        Version current = new Version(installed.Major, installed.Minor, Math.Max(installed.Build, 0), Math.Max(installed.Revision, 0));
        if (version <= current) return null;
        string name = "DynamicDesktop-" + major.ToString(CultureInfo.InvariantCulture) + "." + minor.ToString(CultureInfo.InvariantCulture) + "." + patch.ToString(CultureInfo.InvariantCulture) + "-win-x64-Setup.exe";
        object value;
        object[] assets = release.TryGetValue("assets", out value) ? value as object[] : null;
        if (assets == null) throw new InvalidOperationException("The release has no installer assets.");
        Dictionary<string, object> installer = FindAsset(assets, name);
        if (installer == null) throw new InvalidOperationException("The release does not contain the expected Windows installer.");
        ReleaseUpdate update = new ReleaseUpdate { Version = version, AssetName = name };
        update.AssetSize = AssetSize(installer, MaxInstallerSize);
        update.AssetUrl = AssetUrl(installer, tag, name);
        string digest = StringValue(installer, "digest");
        if (!String.IsNullOrEmpty(digest))
        {
            if (!digest.StartsWith("sha256:", StringComparison.Ordinal) || !HashPattern.IsMatch(digest.Substring(7)))
                throw new InvalidOperationException("The installer has an invalid SHA-256 digest.");
            update.Digest = digest.Substring(7);
        }
        else
        {
            string checksumName = name + ".sha256";
            Dictionary<string, object> checksum = FindAsset(assets, checksumName);
            if (checksum == null) throw new InvalidOperationException("The release has no SHA-256 checksum for the installer.");
            update.ChecksumSize = AssetSize(checksum, MaxChecksumSize);
            update.ChecksumUrl = AssetUrl(checksum, tag, checksumName);
        }
        return update;
    }

    public static string Download(ReleaseUpdate update, string updateDirectory)
    {
        if (update == null) throw new ArgumentNullException("update");
        if (String.IsNullOrEmpty(updateDirectory)) throw new ArgumentNullException("updateDirectory");
        string expected = update.Digest;
        if (expected == null)
        {
            byte[] checksum = ReadBounded(update.ChecksumUrl, MaxChecksumSize, false);
            if (checksum.LongLength != update.ChecksumSize) throw new InvalidOperationException("The checksum file size does not match the release metadata.");
            expected = ParseChecksum(Encoding.UTF8.GetString(checksum), update.AssetName);
            update.Digest = expected;
        }
        Directory.CreateDirectory(updateDirectory);
        string path = Path.Combine(updateDirectory, "DynamicDesktop-update-" + Guid.NewGuid().ToString("N") + ".exe");
        try
        {
            using (HttpWebResponse response = OpenResponse(update.AssetUrl, false))
            {
                if (response.ContentLength >= 0 && response.ContentLength != update.AssetSize)
                    throw new InvalidOperationException("The installer size does not match the release metadata.");
                using (Stream input = response.GetResponseStream())
                using (FileStream output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (SHA256 sha = SHA256.Create())
                {
                    byte[] buffer = new byte[65536];
                    long total = 0;
                    int count;
                    while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        total += count;
                        if (total > update.AssetSize || total > MaxInstallerSize) throw new InvalidOperationException("The installer exceeds its expected size.");
                        sha.TransformBlock(buffer, 0, count, buffer, 0);
                        output.Write(buffer, 0, count);
                    }
                    sha.TransformFinalBlock(new byte[0], 0, 0);
                    if (total != update.AssetSize) throw new InvalidOperationException("The installer download is incomplete.");
                    string actual = BitConverter.ToString(sha.Hash).Replace("-", "");
                    if (!String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The installer SHA-256 checksum does not match.");
                }
            }
            return path;
        }
        catch { try { if (File.Exists(path)) File.Delete(path); } catch { } throw; }
    }

    public static void VerifyInstaller(ReleaseUpdate update, string path)
    {
        if (update == null) throw new ArgumentNullException("update");
        if (String.IsNullOrEmpty(path)) throw new ArgumentNullException("path");
        if (String.IsNullOrEmpty(update.Digest) || !HashPattern.IsMatch(update.Digest))
            throw new InvalidOperationException("The installer checksum has not been resolved.");
        using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (SHA256 sha = SHA256.Create())
        {
            if (input.Length != update.AssetSize || input.Length <= 0 || input.Length > MaxInstallerSize)
                throw new InvalidOperationException("The installer size does not match the release metadata.");
            string actual = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "");
            if (!String.Equals(update.Digest, actual, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The installer SHA-256 checksum does not match.");
        }
    }
    internal static string ParseChecksum(string contents, string assetName)
    {
        string line = (contents ?? "").Trim();
        Match match = Regex.Match(line, @"\A([0-9a-fA-F]{64})(?:[ \t]+\*?([^\r\n]+))?\z", RegexOptions.CultureInvariant);
        if (!match.Success || (match.Groups[2].Success && !String.Equals(match.Groups[2].Value, assetName, StringComparison.Ordinal)))
            throw new InvalidOperationException("The installer checksum file is invalid.");
        return match.Groups[1].Value;
    }

    static Dictionary<string, object> FindAsset(object[] assets, string name)
    {
        Dictionary<string, object> found = null;
        foreach (object item in assets)
        {
            Dictionary<string, object> asset = item as Dictionary<string, object>;
            if (asset != null && String.Equals(StringValue(asset, "name"), name, StringComparison.Ordinal))
            {
                if (found != null) throw new InvalidOperationException("The release contains duplicate assets.");
                if (!String.Equals(StringValue(asset, "state"), "uploaded", StringComparison.Ordinal)) throw new InvalidOperationException("The release asset is not uploaded.");
                found = asset;
            }
        }
        return found;
    }
    static long AssetSize(Dictionary<string, object> asset, long maximum)
    {
        object value; long size;
        if (!asset.TryGetValue("size", out value) || !Int64.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.None, CultureInfo.InvariantCulture, out size) || size <= 0 || size > maximum)
            throw new InvalidOperationException("The release asset has an invalid size.");
        return size;
    }
    static string AssetUrl(Dictionary<string, object> asset, string tag, string name)
    {
        string url = StringValue(asset, "browser_download_url");
        Uri uri;
        string path = "/Timminater/DynamicDesktop/releases/download/" + Uri.EscapeDataString(tag) + "/" + Uri.EscapeDataString(name);
        if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps || !String.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) || !uri.IsDefaultPort || !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.Fragment) || !String.Equals(uri.AbsolutePath, path, StringComparison.Ordinal))
            throw new InvalidOperationException("The release asset URL is outside the expected repository.");
        return uri.AbsoluteUri;
    }
    static string StringValue(Dictionary<string, object> item, string key) { object value; return item.TryGetValue(key, out value) ? value as string : null; }
    static bool Bool(Dictionary<string, object> item, string key) { object value; return item.TryGetValue(key, out value) && value is bool && (bool)value; }

    static byte[] ReadBounded(string url, int limit, bool metadata)
    {
        using (HttpWebResponse response = OpenResponse(url, metadata))
        {
            if (response.ContentLength > limit) throw new InvalidOperationException("The update response is too large.");
            using (Stream input = response.GetResponseStream())
            using (MemoryStream output = new MemoryStream())
            {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    if (output.Length + count > limit) throw new InvalidOperationException("The update response is too large.");
                    output.Write(buffer, 0, count);
                }
                return output.ToArray();
            }
        }
    }
    static HttpWebResponse OpenResponse(string url, bool metadata)
    {
        if (ServicePointManager.SecurityProtocol != 0) ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Uri uri = new Uri(url);
        for (int redirects = 0; redirects <= MaxRedirects; redirects++)
        {
            if (uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort || !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Fragment)) throw new InvalidOperationException("Unsafe update URL.");
            string host = uri.Host.ToLowerInvariant();
            if (metadata ? host != "api.github.com" || uri.AbsoluteUri != LatestUrl : host != "github.com" && host != "release-assets.githubusercontent.com" && host != "objects.githubusercontent.com")
                throw new InvalidOperationException("Update redirect is outside trusted GitHub domains.");
            if (!metadata && host == "github.com" && !uri.AbsolutePath.StartsWith("/Timminater/DynamicDesktop/releases/download/", StringComparison.Ordinal))
                throw new InvalidOperationException("Update redirect is outside the expected repository.");
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(uri);
            request.AllowAutoRedirect = false;
            request.Timeout = 15000;
            request.ReadWriteTimeout = 30000;
            request.UserAgent = "DynamicDesktop-Updater";
            request.Accept = metadata ? "application/vnd.github+json" : "application/octet-stream";
            if (metadata) request.Headers["X-GitHub-Api-Version"] = "2026-03-10";
            HttpWebResponse response = (HttpWebResponse)request.GetResponse();
            int status = (int)response.StatusCode;
            if (status < 300 || status > 399) return response;
            string location = response.Headers[HttpResponseHeader.Location];
            response.Dispose();
            if (metadata || redirects == MaxRedirects || String.IsNullOrEmpty(location) || !Uri.TryCreate(uri, location, out uri))
                throw new InvalidOperationException("Invalid or excessive update redirects.");
        }
        throw new InvalidOperationException("Too many update redirects.");
    }
}
