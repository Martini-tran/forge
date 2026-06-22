import {JSX, useState} from 'react';
import { Settings as SettingsIcon, Zap, Puzzle, Store, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { SystemSettings } from './settings/SystemSettings';
import { QuickOpen } from './settings/QuickOpen';
import { Plugins } from './settings/Plugins';
import { Market } from './settings/Market';
import { About } from './settings/About';

type Section = 'system' | 'quickopen' | 'plugins' | 'market' | 'about';

const NAV = [
  { id: 'system' as const, label: '系统设置', icon: SettingsIcon },
  { id: 'quickopen' as const, label: '快捷打开', icon: Zap },
  { id: 'plugins' as const, label: '插件管理', icon: Puzzle },
  { id: 'market' as const, label: '插件市场', icon: Store },
  { id: 'about' as const, label: '关于作者', icon: Info },
];

/** Settings window root: left nav + right content. */
export function Settings(): JSX.Element {
  const [section, setSection] = useState<Section>('system');

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-border p-3">
        <div className="px-2 pb-2 pt-1 text-sm font-semibold">设置</div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
              section === id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <main className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {section === 'system' && <SystemSettings />}
        {section === 'quickopen' && <QuickOpen />}
        {section === 'plugins' && <Plugins />}
        {section === 'market' && <Market />}
        {section === 'about' && <About />}
      </main>
    </div>
  );
}
