import { useSetting } from "../../hooks/useSetting";
import type {
  AnySetting,
  BooleanSetting,
  EnumSetting,
  NumberSetting,
  StringSetting,
} from "../../lib/settings/types";
import styles from "./SettingRow.module.css";

interface SettingRowProps {
  setting: AnySetting;
}

/**
 * Polymorphic row for the Settings surface. Switches on the setting's
 * `type` discriminator and renders the right control. Adding a new
 * setting type means a new branch here plus a new `defineX` builder.
 */
export function SettingRow({ setting }: SettingRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span className={styles.label}>{setting.label}</span>
        <p className={styles.description}>{setting.description}</p>
      </div>
      <div className={styles.control}>
        <SettingControl setting={setting} />
      </div>
    </div>
  );
}

function SettingControl({ setting }: SettingRowProps) {
  switch (setting.type) {
    case "boolean":
      return <BooleanControl setting={setting} />;
    case "enum":
      return <EnumControl setting={setting as EnumSetting<string>} />;
    case "string":
      return <StringControl setting={setting as StringSetting} />;
    case "number":
      return <NumberControl setting={setting as NumberSetting} />;
  }
}

function BooleanControl({ setting }: { setting: BooleanSetting }) {
  const [value, setValue] = useSetting(setting);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={setting.label}
      className={`${styles.toggle} ${value ? styles.toggleOn : ""}`}
      onClick={() => void setValue(!value)}
    >
      <span
        className={`${styles.toggleHandle} ${value ? styles.toggleOnHandle : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

function EnumControl<T extends string>({
  setting,
}: {
  setting: EnumSetting<T>;
}) {
  const [value, setValue] = useSetting(setting);
  return (
    <div className={styles.segmented} role="group" aria-label={setting.label}>
      {setting.options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            className={`${styles.segmentedButton} ${active ? styles.segmentedButtonActive : ""}`}
            onClick={() => void setValue(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function StringControl({ setting }: { setting: StringSetting }) {
  const [value, setValue] = useSetting(setting);
  return (
    <input
      type="text"
      className={styles.input}
      value={value}
      maxLength={setting.maxLength}
      aria-label={setting.label}
      onChange={(e) => void setValue(e.target.value)}
    />
  );
}

function NumberControl({ setting }: { setting: NumberSetting }) {
  const [value, setValue] = useSetting(setting);
  return (
    <input
      type="number"
      className={styles.input}
      value={value}
      min={setting.min}
      max={setting.max}
      aria-label={setting.label}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next)) void setValue(next);
      }}
    />
  );
}
