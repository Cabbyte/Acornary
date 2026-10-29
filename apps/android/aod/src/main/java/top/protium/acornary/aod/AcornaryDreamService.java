package top.protium.acornary.aod;

import android.app.AlarmManager;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.database.ContentObserver;
import android.graphics.*;
import android.hardware.*;
import android.net.Uri;
import android.os.*;
import android.service.dreams.DreamService;
import android.util.Log;
import android.view.*;
import java.lang.reflect.Method;
import java.time.*;
import java.time.format.DateTimeFormatter;

/** Pixel 3 Android 12 only; package-scoped hidden API exemption provided by the reversible module. */
public final class AcornaryDreamService extends DreamService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Uri projection = Uri.parse("content://top.protium.acornary.ambient/snapshot");
    private AlarmManager alarms;
    private PowerManager.WakeLock renderLock;
    private AmbientView view;
    private SensorManager sensors;
    private Sensor doubleTap;
    private boolean running, waveEnabled;
    private static long waveCooldownUntil;
    private WaveDetector waveDetector = new WaveDetector();
    private final ContentObserver observer = new ContentObserver(handler) {
        @Override public void onChange(boolean selfChange) { if (running) render(); }
    };
    private final AlarmManager.OnAlarmListener minute = () -> { if (running) { render(); scheduleMinute(); } };
    private final TriggerEventListener tap = new TriggerEventListener() {
        @Override public void onTrigger(TriggerEvent event) { handler.post(() -> launchTerminal()); }
    };
    private final SensorEventListener wave = new SensorEventListener() {
        @Override public void onSensorChanged(SensorEvent event) {
            if (running && waveEnabled && waveDetector.sample(event.values[0] < event.sensor.getMaximumRange(), SystemClock.elapsedRealtime())) { waveCooldownUntil = SystemClock.elapsedRealtime() + 10000; launchTerminal(); }
        }
        @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }
    };
    private void configureWave(boolean enabled) {
        if (enabled == waveEnabled) return;
        waveEnabled = enabled;
        if (sensors == null) return;
        if (enabled) {
            Sensor proximity = sensors.getDefaultSensor(Sensor.TYPE_PROXIMITY, true);
            waveDetector = new WaveDetector(waveCooldownUntil);
            if (proximity != null) sensors.registerListener(wave, proximity, SensorManager.SENSOR_DELAY_NORMAL, handler);
        } else sensors.unregisterListener(wave);
    }
    @Override public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setFullscreen(true); setScreenBright(false); setInteractive(false);
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.screenOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        getWindow().setAttributes(attributes);
        view = new AmbientView(); setContentView(view);
        if (running && renderLock != null) render();
    }
    @Override public void onDreamingStarted() {
        super.onDreamingStarted(); running = true;
        alarms = getSystemService(AlarmManager.class);
        renderLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Acornary:AodRender");
        renderLock.setReferenceCounted(false);
        sensors = getSystemService(SensorManager.class);
        for (Sensor sensor : sensors.getSensorList(Sensor.TYPE_ALL)) if ("com.google.sensor.double_touch".equals(sensor.getStringType())) { doubleTap = sensor; break; }
        if (doubleTap != null) sensors.requestTriggerSensor(tap, doubleTap);
        if (getSystemService(UserManager.class).isUserUnlocked()) getContentResolver().registerContentObserver(projection, false, observer);
        try {
            hidden("setDozeScreenBrightness", new Class<?>[] { int.class }, 10);
            hidden("setDozeScreenState", new Class<?>[] { int.class }, Display.STATE_DOZE);
            hidden("startDozing", new Class<?>[0]);
            Log.i("AcornaryAOD", "Started Android 12 doze service");
            render(); scheduleMinute();
        } catch (Exception error) { Log.e("AcornaryAOD", "Doze integration unavailable", error); finish(); }
    }
    private void hidden(String name, Class<?>[] signature, Object... args) throws Exception {
        Method method = DreamService.class.getDeclaredMethod(name, signature); method.invoke(this, args);
    }
    private void render() {
        if (!running || view == null) return;
        renderLock.acquire(2000); view.loadSnapshot(); view.invalidate();
        handler.postDelayed(() -> { if (renderLock.isHeld()) renderLock.release(); }, 1000);
    }
    private void scheduleMinute() {
        alarms.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 60000L - System.currentTimeMillis() % 60000L, "Acornary AOD clock", minute, handler);
    }
    private void launchTerminal() {
        if (!running) return;
        try { startActivity(new Intent().setClassName("top.protium.acornary", "top.protium.acornary.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)); }
        catch (Exception error) { Log.e("AcornaryAOD", "Unable to open terminal", error); }
        wakeUp();
    }
    @Override public void onDreamingStopped() {
        running = false;
        if (alarms != null) alarms.cancel(minute);
        if (sensors != null && doubleTap != null) sensors.cancelTriggerSensor(tap, doubleTap);
        configureWave(false); getContentResolver().unregisterContentObserver(observer);
        handler.removeCallbacksAndMessages(null);
        if (renderLock != null && renderLock.isHeld()) renderLock.release();
        super.onDreamingStopped();
    }
    private final class AmbientView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private String status = "重启后请先解锁", title = "松仓", lines = "";
        private ZoneId timezone = ZoneId.systemDefault();
        private int rotation = 1, extra;
        AmbientView() { super(AcornaryDreamService.this); setBackgroundColor(Color.BLACK); }
        void loadSnapshot() {
            status = "重启后请先解锁"; title = "松仓"; lines = ""; timezone = ZoneId.systemDefault(); extra = 0;
            if (!getSystemService(UserManager.class).isUserUnlocked()) return;
            try (Cursor c = getContentResolver().query(projection, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    status = c.getString(c.getColumnIndexOrThrow("status")); title = c.getString(c.getColumnIndexOrThrow("title"));
                    lines = c.getString(c.getColumnIndexOrThrow("lines")); timezone = ZoneId.of(c.getString(c.getColumnIndexOrThrow("timezone")));
                    rotation = c.getInt(c.getColumnIndexOrThrow("rotation")); extra = c.getInt(c.getColumnIndexOrThrow("extra"));
                    configureWave(c.getInt(c.getColumnIndexOrThrow("wave")) == 1);
                }
            } catch (Exception error) { status = "请打开松仓终端"; configureWave(false); }
        }
        private String fit(String text, float width) {
            if (paint.measureText(text) <= width) return text;
            int count = paint.breakText(text, true, Math.max(0, width - paint.measureText("…")), null);
            return text.substring(0, count) + "…";
        }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float width = getWidth(), height = getHeight();
            // Keyguard may force portrait; retain the last landscape used in the app.
            if (height > width) {
                if (rotation == 3) { canvas.translate(0, height); canvas.rotate(-90); }
                else { canvas.translate(width, 0); canvas.rotate(90); }
                float swap = width; width = height; height = swap;
            } else if (getDisplay() != null && getDisplay().getRotation() != (rotation == 3 ? Surface.ROTATION_270 : Surface.ROTATION_90)) { canvas.translate(width, height); canvas.rotate(180); }
            float d = getResources().getDisplayMetrics().density;
            long minute = System.currentTimeMillis() / 60000;
            canvas.translate(((minute % 5) - 2) * 2 * d, (((minute / 5) % 5) - 2) * 2 * d);
            float left = width * 0.06f, top = height * 0.36f, right = width * 0.50f;
            ZonedDateTime now = ZonedDateTime.now(timezone);
            paint.setColor(0xff999999); paint.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL)); paint.setTextSize(58*d);
            canvas.drawText(now.format(DateTimeFormatter.ofPattern("HH:mm")), left, top, paint);
            paint.setTextSize(16*d); canvas.drawText(now.format(DateTimeFormatter.ofPattern("M月d日 EEEE")), left, top + 34*d, paint);
            paint.setTextSize(15*d); canvas.drawText(fit(title, width * 0.40f), left, top + 66*d, paint);
            paint.setTextSize(11*d); canvas.drawText(fit(status, width * 0.40f), left, top + 92*d, paint);
            paint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            int i = 0;
            for (String line : lines.split("\n")) {
                if (i == 4) break;
                String[] pair = line.split("\t", 2);
                float y = top - 18*d + (i++)*46*d;
                paint.setTextSize(17*d); canvas.drawText(fit(pair[0], width * 0.44f), right, y, paint);
                if (pair.length > 1) { paint.setTextSize(11*d); canvas.drawText(fit(pair[1], width * 0.44f), right, y + 18*d, paint); }
            }
            if (extra > 0) { paint.setTextSize(11*d); canvas.drawText("另有 " + extra + " 件", right, top + 171*d, paint); }
        }
    }
}
