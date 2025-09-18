// Package cache provides a high-performance LRU caching system with TTL support
package cache

import (
	"context"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
)

// Stats tracks cache performance metrics
type Stats struct {
	Hits       uint64
	Misses     uint64
	Evictions  uint64
	Sets       uint64
	Size       int
	MaxSize    int
	MemoryUsed uint64
}

// Entry represents a cached item with TTL
type Entry struct {
	Value      interface{}
	Expiry     time.Time
	Size       int64 // Size in bytes
	AccessTime time.Time
}

// Cache provides thread-safe LRU caching with TTL and memory management
type Cache struct {
	lru        *lru.Cache[string, *Entry]
	mu         sync.RWMutex
	ttl        time.Duration
	maxMemory  int64
	memoryUsed int64
	
	// Performance metrics
	hits       uint64
	misses     uint64
	evictions  uint64
	sets       uint64
	
	// Background cleanup
	stopCleanup chan struct{}
	cleanupDone chan struct{}
}

// Options configures cache behavior
type Options struct {
	MaxSize      int           // Maximum number of entries
	TTL          time.Duration // Default TTL for entries
	MaxMemory    int64         // Maximum memory usage in bytes
	CleanupInterval time.Duration // Cleanup interval for expired entries
}

// DefaultOptions returns sensible defaults
func DefaultOptions() Options {
	return Options{
		MaxSize:      1000,
		TTL:          5 * time.Minute,
		MaxMemory:    500 * 1024 * 1024, // 500MB
		CleanupInterval: 30 * time.Second,
	}
}

// New creates a new cache instance
func New(opts Options) (*Cache, error) {
	c := &Cache{
		ttl:         opts.TTL,
		maxMemory:   opts.MaxMemory,
		stopCleanup: make(chan struct{}),
		cleanupDone: make(chan struct{}),
	}
	
	// Create LRU with eviction callback
	onEvicted := func(key string, value *Entry) {
		atomic.AddUint64(&c.evictions, 1)
		atomic.AddInt64(&c.memoryUsed, -value.Size)
	}
	
	cache, err := lru.NewWithEvict[string, *Entry](opts.MaxSize, onEvicted)
	if err != nil {
		return nil, fmt.Errorf("failed to create LRU cache: %w", err)
	}
	
	c.lru = cache
	
	// Start background cleanup goroutine
	if opts.CleanupInterval > 0 {
		go c.cleanupExpired(opts.CleanupInterval)
	} else {
		// If no cleanup goroutine, set channels to nil
		c.stopCleanup = nil
		c.cleanupDone = nil
	}
	
	return c, nil
}

// Get retrieves a value from the cache
func (c *Cache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	
	entry, ok := c.lru.Get(key)
	if !ok {
		atomic.AddUint64(&c.misses, 1)
		return nil, false
	}
	
	// Check if expired
	if time.Now().After(entry.Expiry) {
		c.mu.RUnlock()
		c.mu.Lock()
		c.lru.Remove(key)
		atomic.AddInt64(&c.memoryUsed, -entry.Size)
		c.mu.Unlock()
		c.mu.RLock()
		
		atomic.AddUint64(&c.misses, 1)
		return nil, false
	}
	
	// Update access time
	entry.AccessTime = time.Now()
	atomic.AddUint64(&c.hits, 1)
	return entry.Value, true
}

// Set adds or updates a value in the cache
func (c *Cache) Set(key string, value interface{}, ttl time.Duration) error {
	return c.SetWithSize(key, value, ttl, estimateSize(value))
}

// SetWithSize adds a value with explicit size tracking
func (c *Cache) SetWithSize(key string, value interface{}, ttl time.Duration, size int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	// Check memory limit
	if atomic.LoadInt64(&c.memoryUsed)+size > c.maxMemory {
		// Try to evict entries to make space
		if !c.makeSpace(size) {
			return fmt.Errorf("cache memory limit exceeded")
		}
	}
	
	if ttl <= 0 {
		ttl = c.ttl
	}
	
	entry := &Entry{
		Value:      value,
		Expiry:     time.Now().Add(ttl),
		Size:       size,
		AccessTime: time.Now(),
	}
	
	// Check if we're updating an existing entry
	if oldEntry, exists := c.lru.Get(key); exists {
		atomic.AddInt64(&c.memoryUsed, size-oldEntry.Size)
	} else {
		atomic.AddInt64(&c.memoryUsed, size)
	}
	
	c.lru.Add(key, entry)
	atomic.AddUint64(&c.sets, 1)
	
	return nil
}

// Delete removes an entry from the cache
func (c *Cache) Delete(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	if entry, ok := c.lru.Get(key); ok {
		c.lru.Remove(key)
		atomic.AddInt64(&c.memoryUsed, -entry.Size)
		return true
	}
	return false
}

// Clear removes all entries from the cache
func (c *Cache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	c.lru.Purge()
	atomic.StoreInt64(&c.memoryUsed, 0)
}

// Stats returns current cache statistics
func (c *Cache) Stats() Stats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	
	return Stats{
		Hits:       atomic.LoadUint64(&c.hits),
		Misses:     atomic.LoadUint64(&c.misses),
		Evictions:  atomic.LoadUint64(&c.evictions),
		Sets:       atomic.LoadUint64(&c.sets),
		Size:       c.lru.Len(),
		MaxSize:    1000, // Default max size
		MemoryUsed: uint64(atomic.LoadInt64(&c.memoryUsed)),
	}
}

// HitRatio returns the cache hit ratio
func (c *Cache) HitRatio() float64 {
	hits := atomic.LoadUint64(&c.hits)
	misses := atomic.LoadUint64(&c.misses)
	total := hits + misses
	if total == 0 {
		return 0
	}
	return float64(hits) / float64(total)
}

// Close stops background cleanup goroutine
func (c *Cache) Close() {
	if c.stopCleanup != nil {
		close(c.stopCleanup)
		if c.cleanupDone != nil {
			<-c.cleanupDone
		}
	}
}

// cleanupExpired runs in background to remove expired entries
func (c *Cache) cleanupExpired(interval time.Duration) {
	defer close(c.cleanupDone)
	
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			c.removeExpired()
		case <-c.stopCleanup:
			return
		}
	}
}

// removeExpired removes all expired entries
func (c *Cache) removeExpired() {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	now := time.Now()
	keys := c.lru.Keys()
	
	for _, key := range keys {
		if entry, ok := c.lru.Peek(key); ok && now.After(entry.Expiry) {
			c.lru.Remove(key)
			atomic.AddInt64(&c.memoryUsed, -entry.Size)
			atomic.AddUint64(&c.evictions, 1)
		}
	}
}

// makeSpace tries to evict entries to make room for new data
func (c *Cache) makeSpace(needed int64) bool {
	current := atomic.LoadInt64(&c.memoryUsed)
	if current+needed <= c.maxMemory {
		return true
	}
	
	// Evict oldest entries until we have space
	toFree := (current + needed) - c.maxMemory
	freed := int64(0)
	
	for freed < toFree && c.lru.Len() > 0 {
		// Remove oldest entry
		key, entry, ok := c.lru.GetOldest()
		if !ok {
			break
		}
		c.lru.Remove(key)
		freed += entry.Size
		atomic.AddInt64(&c.memoryUsed, -entry.Size)
		atomic.AddUint64(&c.evictions, 1)
	}
	
	return freed >= toFree
}

// estimateSize estimates the memory size of a value
func estimateSize(v interface{}) int64 {
	switch val := v.(type) {
	case string:
		return int64(len(val))
	case []byte:
		return int64(len(val))
	case nil:
		return 0
	default:
		// Use runtime memory stats as rough estimate
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		return 1024 // Default 1KB for unknown types
	}
}

// GetWithContext retrieves value with context support
func (c *Cache) GetWithContext(ctx context.Context, key string) (interface{}, bool) {
	select {
	case <-ctx.Done():
		return nil, false
	default:
		return c.Get(key)
	}
}

// SetWithContext sets value with context support
func (c *Cache) SetWithContext(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return c.Set(key, value, ttl)
	}
}