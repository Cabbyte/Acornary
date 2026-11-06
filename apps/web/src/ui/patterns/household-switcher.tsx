import { Select } from '../components/ui/select';
import { cn } from '../components/utils';
import './navigation.css';

export interface HouseholdOption {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}
export interface HouseholdSwitcherProps {
  value: string | null;
  options: readonly HouseholdOption[];
  onSwitchIntent: (householdId: string) => void;
  currentLabel?: string;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: string;
  blockedReason?: string;
  className?: string;
}

export function HouseholdSwitcher({
  value,
  options,
  onSwitchIntent,
  currentLabel,
  disabled,
  readOnly,
  loading,
  error,
  blockedReason,
  className,
}: HouseholdSwitcherProps) {
  const blocked = disabled || loading || Boolean(blockedReason) || Boolean(error);
  return (
    <Select
      value={value}
      options={options.map(({ id, name, description, disabled: optionDisabled }) => ({
        value: id,
        label: name,
        description,
        disabled: optionDisabled,
      }))}
      label="当前家庭"
      selectedLabel={currentLabel}
      placeholder={loading ? '正在读取家庭…' : '尚未选择家庭'}
      emptyMessage="暂无可切换的家庭"
      onValueChange={(next) => {
        if (
          !blocked &&
          !readOnly &&
          next !== null &&
          next !== value &&
          options.some((option) => option.id === next && !option.disabled)
        )
          onSwitchIntent(next);
      }}
      disabled={blocked || options.length === 0}
      readOnly={readOnly}
      loading={loading}
      error={error}
      hint={
        blockedReason ||
        (options.length === 0 && !loading
          ? '暂无可用家庭，当前范围尚未建立。'
          : '切换家庭会改变物品与任务的范围。')
      }
      className={cn('vn-household-switcher', className)}
    />
  );
}
