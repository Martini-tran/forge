/**
 * 访问令牌的最小存储，等价于 nebula 里的 useAccessStore。
 * forge 没有引入状态管理库，这里直接用 localStorage 持久化 token，
 * 并提供一个登录过期回调钩子，由上层（如设置页）按需注册。
 */

const TOKEN_KEY = 'forge.accessToken';

let onLoginExpired: (() => void) | null = null;

export function getAccessToken(): null | string {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // 隐私模式等场景下 localStorage 可能不可用
  }
}

export function setAccessToken(token: null | string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 忽略存储异常 */
  }
}

/** 注册“登录过期”回调（例如跳到登录页 / 弹窗）。返回取消注册函数。 */
export function setOnLoginExpired(cb: (() => void) | null): () => void {
  onLoginExpired = cb;
  return () => {
    if (onLoginExpired === cb) onLoginExpired = null;
  };
}

/** 触发登录过期处理：清空 token 并调用已注册的回调。 */
export function handleLoginExpired(): void {
  setAccessToken(null);
  onLoginExpired?.();
}
