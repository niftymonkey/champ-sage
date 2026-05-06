import type {
  BooleanSetting,
  EnumSetting,
  NumberSetting,
  StringSetting,
} from "./types";

/**
 * Each builder produces a fully-formed setting descriptor with a
 * matching `parse` function. Unknown raw values fall back to the
 * descriptor's default rather than throwing — bad on-disk data should
 * never break boot.
 */

export function defineBoolean(
  spec: Omit<BooleanSetting, "type" | "parse">
): BooleanSetting {
  return {
    ...spec,
    type: "boolean",
    parse(raw) {
      return typeof raw === "boolean" ? raw : spec.defaultValue;
    },
  };
}

export function defineString(
  spec: Omit<StringSetting, "type" | "parse">
): StringSetting {
  return {
    ...spec,
    type: "string",
    parse(raw) {
      if (typeof raw !== "string") return spec.defaultValue;
      if (spec.maxLength !== undefined && raw.length > spec.maxLength) {
        return spec.defaultValue;
      }
      return raw;
    },
  };
}

export function defineNumber(
  spec: Omit<NumberSetting, "type" | "parse">
): NumberSetting {
  return {
    ...spec,
    type: "number",
    parse(raw) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return spec.defaultValue;
      }
      if (spec.min !== undefined && raw < spec.min) return spec.defaultValue;
      if (spec.max !== undefined && raw > spec.max) return spec.defaultValue;
      return raw;
    },
  };
}

export function defineEnum<T extends string>(
  spec: Omit<EnumSetting<T>, "type" | "parse">
): EnumSetting<T> {
  const allowed = new Set<string>(spec.options.map((o) => o.value));
  return {
    ...spec,
    type: "enum",
    parse(raw) {
      return typeof raw === "string" && allowed.has(raw)
        ? (raw as T)
        : spec.defaultValue;
    },
  };
}
