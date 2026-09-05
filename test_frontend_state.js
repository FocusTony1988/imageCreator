/**
 * Nano Banana Ultimate - Frontend State Engine & 3D Camera Test Suite
 */

const { StudioStateEngine } = require('./static/js/core/state.js');

async function testStateEngine() {
    console.log("[TEST JS] StudioStateEngine...");
    const engine = new StudioStateEngine({
        camera: { pitch: 0, yaw: 0, mode: 'pro' },
        camera_mode: 'cinematic',
        autobot: { duration: 30 }
    });

    // 1. Exact Path Matching Test
    let cameraNotifications = 0;
    let cameraModeNotifications = 0;

    engine.subscribe('camera', () => { cameraNotifications++; });
    engine.subscribe('camera_mode', () => { cameraModeNotifications++; });

    // Modifying 'camera.pitch' should notify 'camera', but NOT 'camera_mode'
    engine.set('camera.pitch', 15);

    // Wait for microtask flush
    await new Promise(resolve => queueMicrotask(resolve));

    if (cameraNotifications !== 1) {
        throw new Error(`Expected cameraNotifications=1, got ${cameraNotifications}`);
    }
    if (cameraModeNotifications !== 0) {
        throw new Error(`Sub-path collision! 'camera' modification triggered 'camera_mode' listener!`);
    }
    console.log("  -> PASSED: Exact sub-path matching without substring collisions OK.");

    // 2. Microtask Batching Test (Preset Load)
    let autobotListenerCalls = 0;
    engine.subscribe('autobot', () => { autobotListenerCalls++; });

    // 5 sequential updates
    engine.set('autobot.duration', 60);
    engine.set('autobot.shots', 6);
    engine.set('autobot.pacing', 'fast');
    engine.set('autobot.genre', 'Sci-Fi');
    engine.set('autobot.aspect', '9:16');

    // Before microtask: 0 calls
    if (autobotListenerCalls !== 0) {
        throw new Error("Notifications must be deferred to microtask turn!");
    }

    // Wait for microtask
    await new Promise(resolve => queueMicrotask(resolve));

    // After microtask: Exactly 1 call despite 5 changes
    if (autobotListenerCalls !== 1) {
        throw new Error(`Expected 1 batched notification, got ${autobotListenerCalls}`);
    }
    console.log("  -> PASSED: queueMicrotask batching debounced 5 sequential sets into 1 render cycle OK.");

    // 3. AbortSignal Auto-Cleanup Test
    const ac = new AbortController();
    let abortListenerCalls = 0;

    engine.subscribe('camera.yaw', () => { abortListenerCalls++; }, ac.signal);

    engine.set('camera.yaw', 45);
    await new Promise(resolve => queueMicrotask(resolve));
    if (abortListenerCalls !== 1) throw new Error("Listener should have fired");

    // Abort signal
    ac.abort();

    // Next update should NOT trigger listener
    engine.set('camera.yaw', 90);
    await new Promise(resolve => queueMicrotask(resolve));
    if (abortListenerCalls !== 1) {
        throw new Error("Aborted listener still received notification! Memory leak detected.");
    }
    console.log("  -> PASSED: AbortSignal auto-deregistration & leak safety OK.");
}

async function run() {
    try {
        await testStateEngine();
        console.log("=== ALL FRONTEND TESTS PASSED SUCCESSFULLY! ===");
    } catch (err) {
        console.error("TEST FAILED:", err);
        process.exit(1);
    }
}

run();
