import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Theme } from "../../../shared/Settings";
import { Button, Switch } from "../../components/ui/controls";

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

function Field({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {children}
    </section>
  );
}

/** Build an Electron accelerator string from a keydown event, or null if the
 *  combo isn't yet complete (only modifiers, or no modifier). */
function toAccelerator(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  if (mods.length === 0) return null; // require at least one modifier

  let key: string;
  if (e.key === " ") key = "Space";
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else {
    const named: Record<string, string> = {
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Enter: "Return",
    };
    key = named[e.key] ?? e.key; // F1-F12, Tab, etc. pass through
  }
  return [...mods, key].join("+");
}

function HotkeyRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      const accel = toAccelerator(e);
      if (!accel) return; // wait for a full combo
      setRecording(false);
      const ok = await window.launcher.setHotkey(accel);
      if (ok) {
        onChange(accel);
        setError("");
      } else {
        setError(`无法绑定 ${accel}(可能已被占用或无效)`);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <kbd className="inline-flex min-w-24 justify-center rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium">
          {recording ? "按下组合键…" : value}
        </kbd>
        <Button
          variant="outline"
          onClick={() => {
            setError("");
            setRecording((r) => !r);
          }}
        >
          {recording ? "取消" : "录制"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function SystemSettings(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("system");
  const [hotkey, setHotkey] = useState("Alt+Space");
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [pinyinSearch, setPinyinSearch] = useState(false);

  useEffect(() => {
    window.launcher.getSettings().then((s) => {
      setTheme(s.theme);
      setHotkey(s.toggleHotkey);
      setOpenAtLogin(s.openAtLogin);
      setPinyinSearch(s.pinyinSearch);
    });
  }, []);

  const changeTheme = (t: Theme) => {
    setTheme(t);
    window.launcher.setSetting("theme", t); // broadcasts → live re-apply
  };

  const changeOpenAtLogin = (v: boolean) => {
    setOpenAtLogin(v);
    window.launcher.setOpenAtLogin(v);
  };

  const changePinyinSearch = (v: boolean) => {
    setPinyinSearch(v);
    window.launcher.setSetting("pinyinSearch", v ? "1" : "0"); // broadcasts
  };

  return (
    <div className="max-w-xl space-y-8">
      <Field title="主题" desc="选择浅色、深色,或跟随系统。">
        <div className="flex gap-2">
          {THEMES.map((t) => (
            <Button
              key={t.id}
              variant={theme === t.id ? "default" : "outline"}
              onClick={() => changeTheme(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </Field>

      <Field title="呼出 / 收起快捷键" desc="全局快捷键,用于显示或隐藏启动器。">
        <HotkeyRecorder value={hotkey} onChange={setHotkey} />
      </Field>

      <Field title="开机自启动" desc="登录系统后自动在后台启动启动器。">
        <Switch checked={openAtLogin} onCheckedChange={changeOpenAtLogin} />
      </Field>

      <Field
        title="拼音搜索"
        desc="支持用全拼或首字母搜索中文名称(如 weixin / wx → 微信)。"
      >
        <Switch checked={pinyinSearch} onCheckedChange={changePinyinSearch} />
      </Field>
    </div>
  );
}
