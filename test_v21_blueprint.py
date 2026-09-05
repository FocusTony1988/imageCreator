"""
Nano Banana Ultimate - v2.1 Architectural Blueprint Test Suite
Verifies all 4 requirement packages:
1. ThreadPool-Hardening & OpenCV Pipeline (core/imaging.py)
2. Multi-Tier Orchestrator, BoundedLRUCache, CircuitBreaker, ContextCompressor (core/orchestrator.py)
3. Streaming Helpers (core/streaming.py)
"""

import time
import json
import numpy as np
import cv2
from core.imaging import (
    imaging_pool,
    _process_inpaint_blocking,
    optimize_and_remove_watermark_async
)
from core.orchestrator import (
    BoundedLRUCache,
    generate_cache_key,
    CircuitBreaker,
    StoryboardContextCompressor,
    MultiTierOrchestrator
)
from core.streaming import format_sse, ping_sse, get_sse_headers


def test_bounded_lru_cache():
    print("[TEST] BoundedLRUCache...")
    cache = BoundedLRUCache(maxsize=3, ttl_seconds=1)

    # 1. Insert 3 items
    cache.set("k1", "v1")
    cache.set("k2", "v2")
    cache.set("k3", "v3")
    assert len(cache) == 3
    assert cache.get("k1") == "v1"

    # 2. Access k1 so k2 becomes LRU
    assert cache.get("k1") == "v1"

    # 3. Insert 4th item -> k2 must be evicted (popitem last=False)
    cache.set("k4", "v4")
    assert len(cache) == 3
    assert cache.get("k2") is None, "k2 should have been evicted"
    assert cache.get("k1") == "v1"
    assert cache.get("k4") == "v4"

    # 4. TTL test
    time.sleep(1.1)
    assert cache.get("k1") is None, "k1 should have expired via TTL"
    assert len(cache) == 0, "Cache should be empty after TTL expiration"
    print("  -> PASSED: LRU eviction, TTL check, and deterministic sizing OK.")


def test_cache_key_generation():
    print("[TEST] Cache Key Generation (Nested Dicts & Normalization)...")
    
    # 1. Whitespace & Case Normalization
    k1 = generate_cache_key("  Cinematic   DRone SHOT  ", {"aspect": "16:9"})
    k2 = generate_cache_key("cinematic drone shot", {"aspect": "16:9"})
    assert k1 == k2, "Normalized keys must match"

    # 2. Nested Dict Serialization (Must not crash with TypeError)
    nested_params = {
        "camera_rig": {
            "lens": "35mm Anamorphic",
            "settings": {"iso": 800, "kelvin": 3200}
        },
        "character": {"name": "Yuki", "tags": ["cyberpunk", "runner"]}
    }
    try:
        k_nested = generate_cache_key("Prompt test", nested_params)
        assert isinstance(k_nested, str) and len(k_nested) == 64
    except TypeError as te:
        assert False, f"Nested dict serialization crashed: {te}"

    print("  -> PASSED: Robust JSON serialization without TypeError crash OK.")


def test_circuit_breaker():
    print("[TEST] CircuitBreaker (LM Studio Tier 3 Guard)...")
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=0.5)

    assert cb.can_execute() is True
    assert cb.state == CircuitBreaker.STATE_CLOSED

    # Record 2 failures -> Still CLOSED
    cb.record_failure()
    cb.record_failure()
    assert cb.can_execute() is True
    assert cb.state == CircuitBreaker.STATE_CLOSED

    # 3rd failure -> Trips to OPEN
    cb.record_failure()
    assert cb.state == CircuitBreaker.STATE_OPEN
    assert cb.can_execute() is False, "OPEN circuit breaker must reject calls immediately"

    # Wait for recovery timeout -> Transitions to HALF_OPEN
    time.sleep(0.6)
    assert cb.can_execute() is True
    assert cb.state == CircuitBreaker.STATE_HALF_OPEN

    # Record success -> Closes circuit
    cb.record_success()
    assert cb.state == CircuitBreaker.STATE_CLOSED
    assert cb.failure_count == 0
    print("  -> PASSED: State transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED OK.")


def test_storyboard_context_compressor():
    print("[TEST] StoryboardContextCompressor (Sliding Window)...")
    shots = [
        {"shot_number": 1, "duration_seconds": 3, "framing": "Wide", "camera_motion": "Slow pan left"},
        {"shot_number": 2, "duration_seconds": 4, "framing": "Medium", "camera_motion": "Tracking"},
        {"shot_number": 3, "duration_seconds": 5, "framing": "Close-up", "camera_motion": "Push-in"},
        {"shot_number": 4, "duration_seconds": 6, "framing": "Extreme Close-up", "camera_motion": "Crash zoom"},
        {"shot_number": 5, "duration_seconds": 4, "framing": "Packshot", "camera_motion": "Static"}
    ]

    compressed = StoryboardContextCompressor.compress(shots, max_shots=3)
    assert len(compressed) == 3, f"Expected 3 shots, got {len(compressed)}"
    assert compressed[0]["shot_number"] == 3
    assert compressed[1]["shot_number"] == 4
    assert compressed[2]["shot_number"] == 5
    assert "prior_context_summary" in compressed[0], "First recent shot must hold prior context summary"
    print("  -> PASSED: 5 shots compressed to 3 shots with retained context summary OK.")


def test_imaging_pipeline():
    print("[TEST] Imaging Pipeline & Zero-OOM Inpainting...")
    
    # Generate dummy image bytes (300x300 RGB)
    dummy_img = np.zeros((300, 300, 3), dtype=np.uint8)
    dummy_img[:, :] = (30, 40, 50)
    # Add fake watermark in corner
    cv2.putText(dummy_img, "AI", (250, 280), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
    
    _, enc = cv2.imencode('.png', dummy_img)
    img_bytes = enc.tobytes()

    # 1. Direct blocking processing
    processed = _process_inpaint_blocking(img_bytes, max_dim=1536, remove_synthid=False)
    assert isinstance(processed, bytes) and len(processed) > 0

    # 2. Async wrapper
    async_res = optimize_and_remove_watermark_async(img_bytes, max_dim=1024, timeout_sec=10.0, remove_synthid=False)
    assert isinstance(async_res, bytes) and len(async_res) > 0
    print("  -> PASSED: Inpainting and async ThreadPool execution OK.")


def test_streaming_helpers():
    print("[TEST] Streaming Helpers...")
    sse_out = format_sse("log", {"message": "Test Message"}, message="Hello")
    assert sse_out.startswith("data: ")
    assert "Test Message" in sse_out
    assert sse_out.endswith("\n\n")

    ping = ping_sse()
    assert ping == ": keep-alive\n\n"

    headers = get_sse_headers()
    assert headers["X-Accel-Buffering"] == "no"
    assert "text/event-stream" in headers["Content-Type"]
    print("  -> PASSED: SSE formatting and zero-buffering headers OK.")


if __name__ == "__main__":
    print("=== STARTING v2.1 ARCHITECTURE BLUEPRINT TEST SUITE ===")
    test_bounded_lru_cache()
    test_cache_key_generation()
    test_circuit_breaker()
    test_storyboard_context_compressor()
    test_imaging_pipeline()
    test_streaming_helpers()
    print("=== ALL BACKEND TESTS PASSED SUCCESSFULLY! ===")
