package cache

import (
	"context"
	"fmt"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestCacheBasicOperations(t *testing.T) {
	opts := Options{
		MaxSize:         10,
		TTL:             1 * time.Second,
		MaxMemory:       1024 * 1024, // 1MB
		CleanupInterval: 0, // Disable background cleanup for test
	}
	
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	defer cache.Close()
	
	// Test Set and Get
	key := "test-key"
	value := "test-value"
	
	err = cache.Set(key, value, 0)
	if err != nil {
		t.Fatalf("Failed to set value: %v", err)
	}
	
	retrieved, ok := cache.Get(key)
	if !ok {
		t.Fatalf("Failed to retrieve value")
	}
	
	if retrieved.(string) != value {
		t.Errorf("Expected %s, got %s", value, retrieved)
	}
	
	// Test cache miss
	_, ok = cache.Get("non-existent")
	if ok {
		t.Error("Expected cache miss for non-existent key")
	}
	
	// Test Delete
	deleted := cache.Delete(key)
	if !deleted {
		t.Error("Expected successful deletion")
	}
	
	_, ok = cache.Get(key)
	if ok {
		t.Error("Expected cache miss after deletion")
	}
}

func TestCacheTTL(t *testing.T) {
	opts := Options{
		MaxSize:         10,
		TTL:             100 * time.Millisecond,
		MaxMemory:       1024 * 1024, // 1MB
		CleanupInterval: 50 * time.Millisecond,
	}
	
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	defer cache.Close()
	
	// Set value with short TTL
	err = cache.Set("ttl-key", "ttl-value", 50*time.Millisecond)
	if err != nil {
		t.Fatalf("Failed to set value: %v", err)
	}
	
	// Value should exist immediately
	_, ok := cache.Get("ttl-key")
	if !ok {
		t.Error("Expected value to exist immediately after setting")
	}
	
	// Wait for expiry
	time.Sleep(100 * time.Millisecond)
	
	// Value should be expired
	_, ok = cache.Get("ttl-key")
	if ok {
		t.Error("Expected value to be expired")
	}
}

func TestCacheEviction(t *testing.T) {
	opts := Options{
		MaxSize:   3,
		TTL:       1 * time.Hour,
		MaxMemory: 1024 * 1024, // 1MB
	}
	
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	defer cache.Close()
	
	// Fill cache to capacity
	for i := 0; i < 3; i++ {
		key := fmt.Sprintf("key-%d", i)
		value := fmt.Sprintf("value-%d", i)
		err := cache.Set(key, value, 0)
		if err != nil {
			t.Fatalf("Failed to set value: %v", err)
		}
	}
	
	stats := cache.Stats()
	if stats.Size != 3 {
		t.Errorf("Expected size 3, got %d", stats.Size)
	}
	
	// Add one more item, should evict the oldest
	err = cache.Set("key-3", "value-3", 0)
	if err != nil {
		t.Fatalf("Failed to set value: %v", err)
	}
	
	// First item should be evicted
	_, ok := cache.Get("key-0")
	if ok {
		t.Error("Expected first item to be evicted")
	}
	
	// Last item should exist
	_, ok = cache.Get("key-3")
	if !ok {
		t.Error("Expected last item to exist")
	}
	
	stats = cache.Stats()
	if stats.Evictions == 0 {
		t.Error("Expected at least one eviction")
	}
}

func TestCacheMemoryLimit(t *testing.T) {
	opts := Options{
		MaxSize:   100,
		TTL:       1 * time.Hour,
		MaxMemory: 100, // 100 bytes
	}
	
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	defer cache.Close()
	
	// Add small items
	for i := 0; i < 10; i++ {
		key := fmt.Sprintf("k%d", i)
		value := fmt.Sprintf("v%d", i) // ~2 bytes each
		err := cache.SetWithSize(key, value, 0, 10)
		if err != nil && i < 10 {
			// Should succeed for first 10 items (100 bytes total)
			t.Errorf("Failed to set value %d: %v", i, err)
		}
	}
	
	stats := cache.Stats()
	if stats.MemoryUsed > 100 {
		t.Errorf("Memory usage exceeded limit: %d > 100", stats.MemoryUsed)
	}
}

func TestCacheConcurrency(t *testing.T) {
	opts := Options{
		MaxSize:   1000,
		TTL:       1 * time.Second,
		MaxMemory: 1024 * 1024, // 1MB
	}
	
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	defer cache.Close()
	
	// Concurrent operations
	var wg sync.WaitGroup
	numGoroutines := 10
	numOperations := 100
	
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			
			for j := 0; j < numOperations; j++ {
				key := fmt.Sprintf("key-%d-%d", id, j)
				value := fmt.Sprintf("value-%d-%d", id, j)
				
				// Set
				err := cache.Set(key, value, 0)
				if err != nil {
					t.Errorf("Failed to set: %v", err)
				}
				
				// Get
				retrieved, ok := cache.Get(key)
				if !ok {
					t.Errorf("Failed to get key: %s", key)
				} else if retrieved.(string) != value {
					t.Errorf("Value mismatch for key %s", key)
				}
				
				// Random delete
				if j%3 == 0 {
					cache.Delete(key)
				}
			}
		}(i)
	}
	
	wg.Wait()
	
	stats := cache.Stats()
	if stats.Sets != uint64(numGoroutines*numOperations) {
		t.Errorf("Expected %d sets, got %d", numGoroutines*numOperations, stats.Sets)
	}
}

func TestCacheStats(t *testing.T) {
	opts := DefaultOptions()
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	defer cache.Close()
	
	// Perform operations
	for i := 0; i < 10; i++ {
		key := fmt.Sprintf("key-%d", i)
		value := fmt.Sprintf("value-%d", i)
		cache.Set(key, value, 0)
	}
	
	// Some hits
	for i := 0; i < 5; i++ {
		key := fmt.Sprintf("key-%d", i)
		cache.Get(key)
	}
	
	// Some misses
	for i := 10; i < 15; i++ {
		key := fmt.Sprintf("key-%d", i)
		cache.Get(key)
	}
	
	stats := cache.Stats()
	if stats.Sets != 10 {
		t.Errorf("Expected 10 sets, got %d", stats.Sets)
	}
	if stats.Hits != 5 {
		t.Errorf("Expected 5 hits, got %d", stats.Hits)
	}
	if stats.Misses != 5 {
		t.Errorf("Expected 5 misses, got %d", stats.Misses)
	}
	
	ratio := cache.HitRatio()
	expectedRatio := 0.5
	if ratio != expectedRatio {
		t.Errorf("Expected hit ratio %f, got %f", expectedRatio, ratio)
	}
}

func TestCacheContext(t *testing.T) {
	opts := DefaultOptions()
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	defer cache.Close()
	
	// Test with cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	
	err = cache.SetWithContext(ctx, "key", "value", 0)
	if err == nil {
		t.Error("Expected error with cancelled context")
	}
	
	_, ok := cache.GetWithContext(ctx, "key")
	if ok {
		t.Error("Expected failure with cancelled context")
	}
	
	// Test with valid context
	ctx = context.Background()
	err = cache.SetWithContext(ctx, "key", "value", 0)
	if err != nil {
		t.Errorf("Failed to set with valid context: %v", err)
	}
	
	value, ok := cache.GetWithContext(ctx, "key")
	if !ok {
		t.Error("Failed to get with valid context")
	}
	if value.(string) != "value" {
		t.Errorf("Expected 'value', got %v", value)
	}
}

func BenchmarkCacheSet(b *testing.B) {
	opts := DefaultOptions()
	cache, _ := New(opts)
	defer cache.Close()
	
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			key := fmt.Sprintf("key-%d", i)
			value := fmt.Sprintf("value-%d", i)
			cache.Set(key, value, 0)
			i++
		}
	})
}

func BenchmarkCacheGet(b *testing.B) {
	opts := DefaultOptions()
	cache, _ := New(opts)
	defer cache.Close()
	
	// Pre-populate cache
	for i := 0; i < 1000; i++ {
		key := fmt.Sprintf("key-%d", i)
		value := fmt.Sprintf("value-%d", i)
		cache.Set(key, value, 0)
	}
	
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			key := fmt.Sprintf("key-%d", i%1000)
			cache.Get(key)
			i++
		}
	})
}

func TestMemoryLeaks(t *testing.T) {
	opts := Options{
		MaxSize:         100,
		TTL:             100 * time.Millisecond,
		CleanupInterval: 50 * time.Millisecond,
	}
	
	cache, err := New(opts)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	
	// Track initial goroutines
	initialGoroutines := runtime.NumGoroutine()
	
	// Perform many operations
	for i := 0; i < 10000; i++ {
		key := fmt.Sprintf("key-%d", i)
		value := fmt.Sprintf("value-%d", i)
		cache.Set(key, value, 50*time.Millisecond)
		
		if i%100 == 0 {
			cache.Get(key)
		}
	}
	
	// Wait for cleanup
	time.Sleep(200 * time.Millisecond)
	
	// Clear and close
	cache.Clear()
	cache.Close()
	
	// Check for goroutine leaks
	time.Sleep(100 * time.Millisecond)
	finalGoroutines := runtime.NumGoroutine()
	
	if finalGoroutines > initialGoroutines {
		t.Errorf("Potential goroutine leak: started with %d, ended with %d",
			initialGoroutines, finalGoroutines)
	}
}