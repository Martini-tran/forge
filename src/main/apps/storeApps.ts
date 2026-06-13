import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import type { AppEntry } from "../../shared/AppEntry";

/**
 * Enumerate Microsoft Store / UWP apps (which the .lnk scanner can't see, since
 * they don't resolve to an .exe). `Get-StartApps` lists every Start-menu app
 * with its AppUserModelID; UWP ones have an AUMID containing `!`. We also do a
 * best-effort lookup of each package's small logo from its AppxManifest.
 *
 * Launched later via `explorer.exe shell:AppsFolder\<AUMID>` (see apps/index.ts).
 */

// One PowerShell pass: list UWP start apps + resolve a logo asset path per app.
const PS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$apps = Get-StartApps | Where-Object { $_.AppID -like '*!*' }
$pkgs = @{}
Get-AppxPackage | ForEach-Object {
  if ($_.PackageFamilyName -and -not $pkgs.ContainsKey($_.PackageFamilyName)) {
    $pkgs[$_.PackageFamilyName] = $_.InstallLocation
  }
}
$out = foreach ($a in $apps) {
  $loc = $pkgs[$a.AppID.Split('!')[0]]
  $logo = ''
  if ($loc) {
    try {
      [xml]$x = Get-Content -LiteralPath (Join-Path $loc 'AppxManifest.xml') -Raw
      $rel = $x.Package.Applications.Application.VisualElements.Square44x44Logo
      if (-not $rel) { $rel = $x.Package.Properties.Logo }
      if ($rel) {
        $base = Join-Path $loc $rel
        $bn = [IO.Path]::GetFileNameWithoutExtension($base)
        $ext = [IO.Path]::GetExtension($base)
        $cand = Get-ChildItem -LiteralPath (Split-Path $base) -Filter ($bn + '*' + $ext) -ErrorAction SilentlyContinue |
          Sort-Object Length -Descending | Select-Object -First 1
        if ($cand) { $logo = $cand.FullName }
      }
    } catch {}
  }
  [pscustomobject]@{ name = $a.Name; aumid = $a.AppID; logo = $logo }
}
@($out) | ConvertTo-Json -Compress -Depth 3
`;

function runPowerShell(): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        PS_SCRIPT,
      ],
      { timeout: 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? "" : stdout),
    );
  });
}

interface StoreRow {
  name: string;
  aumid: string;
  logo: string;
}

export async function scanStoreApps(): Promise<AppEntry[]> {
  if (process.platform !== "win32") return [];

  const stdout = (await runPowerShell()).trim();
  if (!stdout) return [];

  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rows = (Array.isArray(data) ? data : [data]) as StoreRow[];

  const out: AppEntry[] = [];
  for (const r of rows) {
    if (!r || !r.name || !r.aumid) continue;
    let icon = "";
    if (r.logo) {
      try {
        const buf = await fs.readFile(r.logo);
        icon = `data:image/png;base64,${buf.toString("base64")}`;
      } catch {
        // leave icon empty
      }
    }
    out.push({
      id: r.aumid,
      name: r.name,
      // The launch token; apps/index.ts opens it via explorer.
      path: `shell:AppsFolder\\${r.aumid}`,
      icon,
      source: "scanned",
    });
  }
  return out;
}
