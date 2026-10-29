package top.protium.acornary.aod;

/** A deliberate far-near-far gesture, never continuous presence detection. Pure state machine. */
public final class WaveDetector {
    private boolean initialized, wasNear, armed;
    private long nearAt, farAt, cooldownUntil;
    public WaveDetector() { }
    public WaveDetector(long cooldownUntil) { this.cooldownUntil = cooldownUntil; }
    public boolean sample(boolean near, long now) {
        if (!initialized) { initialized = true; wasNear = near; farAt = now; return false; }
        if (now < cooldownUntil) { wasNear = near; armed = false; farAt = now; return false; }
        if (near == wasNear) return false;
        wasNear = near;
        if (near) { armed = now - farAt >= 300; nearAt = now; return false; }
        farAt = now;
        boolean fire = armed && now - nearAt >= 100 && now - nearAt <= 1500;
        armed = false;
        if (fire) cooldownUntil = now + 10000;
        return fire;
    }
}
