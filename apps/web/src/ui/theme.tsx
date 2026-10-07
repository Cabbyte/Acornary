import { App, ConfigProvider, Form, theme, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useEffect, useState, type ReactNode } from 'react';
import './layout.css';

dayjs.locale('zh-cn');
export function useViewport() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return { mobile: width < 768, wide: width >= 1200 };
}
export const acornaryTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#AB5F40',
    colorLink: '#AB5F40',
    colorLinkHover: '#8F4C32',
    colorBgLayout: '#F4F1EE',
    colorBgContainer: '#FFFFFF',
    colorText: '#191A1B',
    colorTextSecondary: '#68615C',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontSize: 14,
    controlHeight: 36,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Layout: { headerBg: '#F4F1EE', siderBg: '#F4F1EE' },
    Menu: { itemBg: 'transparent' },
    Table: { cellPaddingBlock: 10 },
  },
};
export function AcornaryUIProvider({ children }: { children: ReactNode }) {
  const { mobile } = useViewport();
  return (
    <ConfigProvider
      locale={zhCN}
      virtual={false}
      button={{ autoInsertSpace: false }}
      theme={{
        ...acornaryTheme,
        token: { ...acornaryTheme.token, ...(mobile ? { controlHeight: 44, fontSize: 16 } : {}) },
      }}
      getPopupContainer={(node) => node?.ownerDocument.body ?? document.body}
    >
      <App>
        <Form component={false}>{children}</Form>
      </App>
    </ConfigProvider>
  );
}
