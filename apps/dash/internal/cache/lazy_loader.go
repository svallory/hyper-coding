// Package cache provides lazy loading mechanisms for large datasets
package cache

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// PageRequest represents a request for paginated data
type PageRequest struct {
	Offset int
	Limit  int
	SortBy string
	Filter string
}

// PageResponse contains paginated results
type PageResponse struct {
	Items      []interface{}
	Total      int
	Offset     int
	Limit      int
	HasMore    bool
	LoadedAt   time.Time
	LoadTimeMs int64
}

// DataLoader defines the interface for loading data
type DataLoader interface {
	Load(ctx context.Context, req PageRequest) (*PageResponse, error)
	Count(ctx context.Context, filter string) (int, error)
}

// LazyLoader provides efficient lazy loading with caching
type LazyLoader struct {
	loader      DataLoader
	cache       *Cache
	pageSize    int
	prefetchAhead int
	
	// Metrics
	mu          sync.RWMutex
	totalLoads  int64
	cacheHits   int64
	avgLoadTime time.Duration
	
	// Background prefetching
	prefetchChan chan PageRequest
	stopPrefetch chan struct{}
}

// LazyLoaderOptions configures the lazy loader
type LazyLoaderOptions struct {
	PageSize      int
	PrefetchAhead int // Number of pages to prefetch
	CacheTTL      time.Duration
	MaxCacheSize  int
}

// DefaultLazyLoaderOptions returns sensible defaults
func DefaultLazyLoaderOptions() LazyLoaderOptions {
	return LazyLoaderOptions{
		PageSize:      50,
		PrefetchAhead: 2,
		CacheTTL:      5 * time.Minute,
		MaxCacheSize:  100,
	}
}

// NewLazyLoader creates a new lazy loader instance
func NewLazyLoader(loader DataLoader, opts LazyLoaderOptions) (*LazyLoader, error) {
	cacheOpts := Options{
		MaxSize: opts.MaxCacheSize,
		TTL:     opts.CacheTTL,
	}
	
	cache, err := New(cacheOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to create cache: %w", err)
	}
	
	ll := &LazyLoader{
		loader:       loader,
		cache:        cache,
		pageSize:     opts.PageSize,
		prefetchAhead: opts.PrefetchAhead,
		prefetchChan: make(chan PageRequest, 10),
		stopPrefetch: make(chan struct{}),
	}
	
	// Start background prefetch worker
	go ll.prefetchWorker()
	
	return ll, nil
}

// GetPage retrieves a page of data with caching and prefetching
func (ll *LazyLoader) GetPage(ctx context.Context, page int, sortBy, filter string) (*PageResponse, error) {
	req := PageRequest{
		Offset: page * ll.pageSize,
		Limit:  ll.pageSize,
		SortBy: sortBy,
		Filter: filter,
	}
	
	// Check cache first
	cacheKey := ll.cacheKey(req)
	if cached, ok := ll.cache.Get(cacheKey); ok {
		ll.recordCacheHit()
		if response, ok := cached.(*PageResponse); ok {
			// Trigger prefetch of next pages
			ll.triggerPrefetch(page, sortBy, filter)
			return response, nil
		}
	}
	
	// Load from source
	start := time.Now()
	response, err := ll.loader.Load(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to load page: %w", err)
	}
	
	loadTime := time.Since(start)
	response.LoadTimeMs = loadTime.Milliseconds()
	ll.recordLoad(loadTime)
	
	// Cache the response
	ll.cache.Set(cacheKey, response, 0)
	
	// Trigger prefetch of next pages
	ll.triggerPrefetch(page, sortBy, filter)
	
	return response, nil
}

// GetRange retrieves multiple pages efficiently
func (ll *LazyLoader) GetRange(ctx context.Context, startPage, endPage int, sortBy, filter string) ([]*PageResponse, error) {
	if startPage > endPage {
		return nil, fmt.Errorf("invalid range: start page %d > end page %d", startPage, endPage)
	}
	
	responses := make([]*PageResponse, 0, endPage-startPage+1)
	
	// Load pages concurrently with limits
	type result struct {
		page     int
		response *PageResponse
		err      error
	}
	
	resultChan := make(chan result, endPage-startPage+1)
	var wg sync.WaitGroup
	
	// Limit concurrent loads
	semaphore := make(chan struct{}, 3)
	
	for page := startPage; page <= endPage; page++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			
			resp, err := ll.GetPage(ctx, p, sortBy, filter)
			resultChan <- result{page: p, response: resp, err: err}
		}(page)
	}
	
	go func() {
		wg.Wait()
		close(resultChan)
	}()
	
	// Collect results in order
	resultMap := make(map[int]*PageResponse)
	var firstErr error
	
	for res := range resultChan {
		if res.err != nil && firstErr == nil {
			firstErr = res.err
		}
		if res.response != nil {
			resultMap[res.page] = res.response
		}
	}
	
	if firstErr != nil {
		return nil, firstErr
	}
	
	// Build ordered response
	for page := startPage; page <= endPage; page++ {
		if resp, ok := resultMap[page]; ok {
			responses = append(responses, resp)
		}
	}
	
	return responses, nil
}

// Invalidate clears cached data for a specific filter
func (ll *LazyLoader) Invalidate(filter string) {
	ll.mu.Lock()
	defer ll.mu.Unlock()
	
	// Clear all pages for this filter
	// In a real implementation, we'd track keys by filter
	ll.cache.Clear()
}

// Stats returns loader statistics
type LazyLoaderStats struct {
	TotalLoads    int64
	CacheHits     int64
	CacheHitRatio float64
	AvgLoadTimeMs int64
	CacheStats    Stats
}

// GetStats returns current statistics
func (ll *LazyLoader) GetStats() LazyLoaderStats {
	ll.mu.RLock()
	defer ll.mu.RUnlock()
	
	total := ll.totalLoads + ll.cacheHits
	hitRatio := float64(0)
	if total > 0 {
		hitRatio = float64(ll.cacheHits) / float64(total)
	}
	
	return LazyLoaderStats{
		TotalLoads:    ll.totalLoads,
		CacheHits:     ll.cacheHits,
		CacheHitRatio: hitRatio,
		AvgLoadTimeMs: ll.avgLoadTime.Milliseconds(),
		CacheStats:    ll.cache.Stats(),
	}
}

// Close stops background workers and cleans up
func (ll *LazyLoader) Close() {
	close(ll.stopPrefetch)
	ll.cache.Close()
}

// cacheKey generates a cache key for a request
func (ll *LazyLoader) cacheKey(req PageRequest) string {
	return fmt.Sprintf("page:%d:%d:%s:%s", req.Offset, req.Limit, req.SortBy, req.Filter)
}

// triggerPrefetch queues pages for background prefetching
func (ll *LazyLoader) triggerPrefetch(currentPage int, sortBy, filter string) {
	for i := 1; i <= ll.prefetchAhead; i++ {
		nextPage := currentPage + i
		req := PageRequest{
			Offset: nextPage * ll.pageSize,
			Limit:  ll.pageSize,
			SortBy: sortBy,
			Filter: filter,
		}
		
		select {
		case ll.prefetchChan <- req:
		default:
			// Channel full, skip prefetch
		}
	}
}

// prefetchWorker handles background prefetching
func (ll *LazyLoader) prefetchWorker() {
	for {
		select {
		case req := <-ll.prefetchChan:
			// Check if already cached
			cacheKey := ll.cacheKey(req)
			if _, ok := ll.cache.Get(cacheKey); ok {
				continue
			}
			
			// Load in background
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			response, err := ll.loader.Load(ctx, req)
			cancel()
			
			if err == nil {
				ll.cache.Set(cacheKey, response, 0)
			}
			
		case <-ll.stopPrefetch:
			return
		}
	}
}

// recordLoad updates load statistics
func (ll *LazyLoader) recordLoad(duration time.Duration) {
	ll.mu.Lock()
	defer ll.mu.Unlock()
	
	ll.totalLoads++
	
	// Update average load time (exponential moving average)
	if ll.avgLoadTime == 0 {
		ll.avgLoadTime = duration
	} else {
		ll.avgLoadTime = (ll.avgLoadTime*9 + duration) / 10
	}
}

// recordCacheHit updates cache hit statistics
func (ll *LazyLoader) recordCacheHit() {
	ll.mu.Lock()
	defer ll.mu.Unlock()
	ll.cacheHits++
}