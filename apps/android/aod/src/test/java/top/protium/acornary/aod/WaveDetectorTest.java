package top.protium.acornary.aod;
import org.junit.Test;
import static org.junit.Assert.*;
public class WaveDetectorTest {
    @Test public void requiresFarNearFarAndCooldown() {
        WaveDetector d = new WaveDetector();
        assertFalse(d.sample(false, 0)); assertFalse(d.sample(true, 500)); assertTrue(d.sample(false, 700));
        assertFalse(d.sample(true, 1200)); assertFalse(d.sample(false, 1400));
        assertFalse(d.sample(true, 12000)); assertTrue(d.sample(false, 12500));
    }
    @Test public void ignoresInitialCoverLongCoverAndChatter() {
        WaveDetector d = new WaveDetector();
        assertFalse(d.sample(true, 0)); assertFalse(d.sample(false, 500));
        assertFalse(d.sample(true, 900)); assertFalse(d.sample(false, 3000));
        assertFalse(d.sample(true, 3100)); assertFalse(d.sample(false, 3150));
        assertFalse(d.sample(true, 4000)); assertFalse(d.sample(false, 4050));
    }
}
