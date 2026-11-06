import { RadioGroup } from '../components/ui/radio-group';
import { cn } from '../components/utils';
import tokenSource from '../tokens/source.json';
import { type AppearancePreset, type UIMode } from '../theme/provider';
import './navigation.css';

export interface AppearancePickerProps {
  value: AppearancePreset;
  onValueChange: (value: AppearancePreset) => void;
  mode?: UIMode;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

// All names and palette IDs come from the central source; swatches use generated tokens.
export function AppearancePicker({
  value,
  onValueChange,
  mode,
  disabled,
  readOnly,
  className,
}: AppearancePickerProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        if (!disabled && !readOnly && next in tokenSource.presets && next !== value) {
          onValueChange(next as AppearancePreset);
        }
      }}
      label="界面配色"
      disabled={disabled}
      readOnly={readOnly}
      className={cn('vn-appearance-picker', className)}
      options={Object.entries(tokenSource.presets).map(([id, preset]) => ({
        value: id,
        label: (
          <span className="vn-appearance-picker__label">
            <span className="vn-appearance-picker__swatches" aria-hidden="true">
              <span
                className="vn-appearance-picker__swatch"
                data-acornary-preset={id}
                data-acornary-mode="daily"
              />
              <span
                className="vn-appearance-picker__swatch"
                data-acornary-preset={id}
                data-acornary-mode="management"
              />
            </span>
            <span>{preset.name}</span>
          </span>
        ),
      }))}
    />
  );
}
