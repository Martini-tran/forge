import type { PluginConfigField } from "./PluginManifest";

/**
 * Plugin config values and resolution, shared between main and renderer.
 *
 * Stored values are a plain JSON object (in the settings KV under
 * `plugin:<id>:config`). `resolvePluginConfig` overlays the user's stored
 * values on the manifest's schema defaults and coerces each to its declared
 * type, so consumers always read a well-typed, schema-shaped object regardless
 * of what was persisted.
 */

export type PluginConfigValue = string | number | boolean;
export type PluginConfigValues = Record<string, PluginConfigValue>;

/** Coerce a raw stored value to the field's declared type (falling back to its default). */
function coerce(
  field: PluginConfigField,
  raw: unknown,
): PluginConfigValue | undefined {
  switch (field.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) {
        return typeof field.default === "number" ? field.default : undefined;
      }
      let v = n;
      if (typeof field.min === "number") v = Math.max(field.min, v);
      if (typeof field.max === "number") v = Math.min(field.max, v);
      return v;
    }
    case "boolean":
      if (typeof raw === "boolean") return raw;
      return raw === "true" || raw === 1 || raw === "1";
    case "select":
    case "string":
      return raw == null ? field.default : String(raw);
  }
}

/**
 * Effective config: schema defaults overlaid with the user's stored values,
 * coerced to each field's type. Only schema-declared keys are kept.
 */
export function resolvePluginConfig(
  schema: PluginConfigField[] | undefined,
  stored: PluginConfigValues,
): PluginConfigValues {
  const out: PluginConfigValues = {};
  for (const field of schema ?? []) {
    const has = Object.prototype.hasOwnProperty.call(stored, field.key);
    const value = has ? coerce(field, stored[field.key]) : field.default;
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}
