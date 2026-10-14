import { App, ConfigProvider, Form, theme, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useEffect, useState, type ReactNode } from 'react';
import './layout.css';
import { trackVisualViewport } from './viewport';

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
    colorPrimaryHover: '#965136',
    colorPrimaryActive: '#7D422C',
    colorPrimaryText: '#87472F',
    colorPrimaryTextHover: '#723B29',
    colorLink: '#8F4C32',
    colorLinkHover: '#723B29',
    colorBgLayout: '#F6F0E6',
    colorBgContainer: '#FFFCF6',
    colorText: '#2B2420',
    colorTextSecondary: '#68615C',
    colorTextDescription: '#68615C',
    colorTextPlaceholder: '#756D66',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontSize: 14,
    controlHeight: 36,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Layout: { headerBg: '#F6F0E6', siderBg: '#F6F0E6' },
    Menu: { itemBg: 'transparent', activeBarBorderWidth: 0, itemSelectedColor: '#87472F' },
    Tree: { titleHeight: 36, nodeSelectedColor: '#87472F' },
    Descriptions: { labelColor: '#68615C' },
    Table: { cellPaddingBlock: 10 },
  },
};
export function AcornaryUIProvider({ children }: { children: ReactNode }) {
  useEffect(trackVisualViewport, []);
  const { mobile } = useViewport();
  return (
    <ConfigProvider
      locale={zhCN}
      virtual={false}
      button={{ autoInsertSpace: false }}
      theme={{
        ...acornaryTheme,
        token: { ...acornaryTheme.token, ...(mobile ? { controlHeight: 44, fontSize: 16 } : {}) },
        components: {
          ...acornaryTheme.components,
          Tree: { ...acornaryTheme.components?.Tree, titleHeight: mobile ? 44 : 36 },
        },
      }}
      getPopupContainer={(node) => node?.ownerDocument.body ?? document.body}
    >
      <App>
        <Form component={false}>{children}</Form>
      </App>
    </ConfigProvider>
  );
}
