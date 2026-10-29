package top.protium.acornary.aod;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;

/** Only two typed operations, accessible to the identically signed terminal. No shell API. */
public final class TerminalSettingsProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public Bundle call(String method, String arg, Bundle extras) {
        if (!method.equals("enable") && !method.equals("pause")) throw new IllegalArgumentException("Unsupported maintenance operation");
        Context context = getContext();
        context.enforceCallingOrSelfPermission("top.protium.acornary.permission.TERMINAL_SETTINGS", "Signature permission required");
        long identity = android.os.Binder.clearCallingIdentity();
        try {
        ContentResolver resolver = context.getContentResolver();
        SharedPreferences baseline = context.createDeviceProtectedStorageContext().getSharedPreferences("terminal-baseline", Context.MODE_PRIVATE);
        boolean enable = method.equals("enable");
        Bundle result = new Bundle();
        synchronized (TerminalSettingsProvider.class) {
            try {
                if (enable) {
                    if (!baseline.getBoolean("saved", false)) {
                        if (!baseline.edit().putBoolean("saved", true)
                            .putInt("stay", Settings.Global.getInt(resolver, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, 0))
                            .putInt("timeout", Settings.System.getInt(resolver, Settings.System.SCREEN_OFF_TIMEOUT, 300000)).commit())
                            throw new IllegalStateException("Unable to save baseline");
                    }
                    Settings.Global.putInt(resolver, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, 0);
                    Settings.System.putInt(resolver, Settings.System.SCREEN_OFF_TIMEOUT, 60000);
                } else if (baseline.getBoolean("saved", false)) {
                    Settings.Global.putInt(resolver, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, baseline.getInt("stay", 0));
                    Settings.System.putInt(resolver, Settings.System.SCREEN_OFF_TIMEOUT, baseline.getInt("timeout", 300000));
                }
                boolean applied = !enable || Settings.Global.getInt(resolver, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, -1) == 0 && Settings.System.getInt(resolver, Settings.System.SCREEN_OFF_TIMEOUT, -1) == 60000;
                result.putString("status", applied ? (enable ? "AOD 组件已连接 · 60 秒待机已应用" : "已恢复原待机设置") : "待机设置未生效，请通过电脑修复权限");
            } catch (SecurityException error) { result.putString("status", "待机设置权限未授权，请通过电脑部署脚本修复"); }
        }
        return result;
        } finally { android.os.Binder.restoreCallingIdentity(identity); }
    }
    @Override public String getType(Uri uri) { return null; }
    @Override public Cursor query(Uri uri, String[] p, String s, String[] a, String o) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] a) { throw new UnsupportedOperationException(); }
}
