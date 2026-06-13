import { Home, BookOpen, Mail, GitFork, GitBranch } from "lucide-react";
import type { ReactNode } from "react";

type Link = {
  label: string;
  value: string;
  href: string;
  icon: typeof Home;
};

const LINKS: Link[] = [
  { label: "主页", value: "orccode.com", href: "https://orccode.com", icon: Home },
  {
    label: "博客",
    value: "blog.orccode.com",
    href: "https://blog.orccode.com",
    icon: BookOpen,
  },
  {
    label: "邮箱",
    value: "fluxlu@163.com",
    href: "mailto:fluxlu@163.com",
    icon: Mail,
  },
  {
    label: "Gitee",
    value: "gitee.com/forwardable/forge",
    href: "https://gitee.com/forwardable/forge",
    icon: GitBranch,
  },
  {
    label: "GitHub",
    value: "github.com/Martini-tran/forge",
    href: "https://github.com/Martini-tran/forge",
    icon: GitFork,
  },
];

function Row({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  value: string;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-sm font-medium">{label}</span>
      <span className="truncate text-sm text-muted-foreground">{value}</span>
    </button>
  );
}

/** About-the-author page: external links to homepage, blog, email, repos. */
export function About(): JSX.Element {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold">作者信息</h2>
        <p className="text-xs text-muted-foreground">
          点击下方任意项,在默认浏览器或邮件客户端中打开。
        </p>
      </div>

      <div className="space-y-2">
        {LINKS.map((l) => (
          <Row
            key={l.href}
            icon={l.icon}
            label={l.label}
            value={l.value}
            onClick={() => window.launcher.openExternal(l.href)}
          />
        ))}
      </div>
    </div>
  );
}
