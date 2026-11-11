import { Dialog, DialogClose, type DialogProps } from './dialog';

// A positioned Dialog, as recommended by https://base-ui.com/react/components/dialog.
// No swipe-to-dismiss path: every close intent passes the Dialog guard.
export type SheetProps = Omit<DialogProps, 'placement'>;
export function Sheet(props: SheetProps) {
  return <Dialog closeLabel="关闭任务面板" {...props} placement="edge" />;
}
export const SheetClose = DialogClose;
