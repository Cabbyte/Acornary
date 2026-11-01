export interface WriteFieldsProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}
export interface LocationOption {
  id: string;
  pId: string | null;
  value: string;
  title: string;
  disabled?: boolean;
}
