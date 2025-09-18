// Package performance provides background operation management
package performance

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// FileOperation represents a file operation to be performed
type FileOperation struct {
	ID        string
	Type      FileOpType
	Path      string
	Data      []byte
	Callback  func(error)
	Priority  int
	CreatedAt time.Time
}

// FileOpType defines the type of file operation
type FileOpType int

const (
	OpRead FileOpType = iota
	OpWrite
	OpAppend
	OpDelete
	OpCopy
	OpMove
	OpWatch
)

// BackgroundWorker manages background file operations
type BackgroundWorker struct {
	// Worker pool
	workers      int
	workQueue    chan *FileOperation
	priorityQueue *PriorityQueue
	
	// State management
	mu           sync.RWMutex
	active       int32
	processed    uint64
	errors       uint64
	
	// Metrics
	avgLatency   time.Duration
	maxLatency   time.Duration
	
	// Control
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	
	// Rate limiting
	rateLimiter  *RateLimiter
}

// WorkerOptions configures the background worker
type WorkerOptions struct {
	NumWorkers    int
	QueueSize     int
	MaxOpsPerSec  int
	EnableMetrics bool
}

// DefaultWorkerOptions returns sensible defaults
func DefaultWorkerOptions() WorkerOptions {
	return WorkerOptions{
		NumWorkers:    4,
		QueueSize:     1000,
		MaxOpsPerSec:  100,
		EnableMetrics: true,
	}
}

// NewBackgroundWorker creates a new background worker pool
func NewBackgroundWorker(opts WorkerOptions) *BackgroundWorker {
	ctx, cancel := context.WithCancel(context.Background())
	
	bw := &BackgroundWorker{
		workers:       opts.NumWorkers,
		workQueue:     make(chan *FileOperation, opts.QueueSize),
		priorityQueue: NewPriorityQueue(),
		ctx:           ctx,
		cancel:        cancel,
		rateLimiter:   NewRateLimiter(opts.MaxOpsPerSec),
	}
	
	// Start dispatcher
	bw.wg.Add(1)
	go bw.dispatcher()
	
	// Start workers
	for i := 0; i < opts.NumWorkers; i++ {
		bw.wg.Add(1)
		go bw.worker(i)
	}
	
	return bw
}

// Submit adds a file operation to the queue
func (bw *BackgroundWorker) Submit(op *FileOperation) error {
	select {
	case <-bw.ctx.Done():
		return fmt.Errorf("worker pool is shutting down")
	default:
	}
	
	if op.ID == "" {
		op.ID = generateID()
	}
	op.CreatedAt = time.Now()
	
	// Add to priority queue
	bw.priorityQueue.Push(op)
	
	// Signal dispatcher
	select {
	case bw.workQueue <- op:
		return nil
	case <-time.After(1 * time.Second):
		return fmt.Errorf("queue is full")
	}
}

// SubmitBatch submits multiple operations efficiently
func (bw *BackgroundWorker) SubmitBatch(ops []*FileOperation) error {
	for _, op := range ops {
		if err := bw.Submit(op); err != nil {
			return fmt.Errorf("failed to submit operation %s: %w", op.ID, err)
		}
	}
	return nil
}

// dispatcher manages the priority queue and dispatches work
func (bw *BackgroundWorker) dispatcher() {
	defer bw.wg.Done()
	
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	
	for {
		select {
		case <-bw.ctx.Done():
			return
		case <-ticker.C:
			// Process priority queue
			for bw.priorityQueue.Len() > 0 {
				op := bw.priorityQueue.Pop()
				if op == nil {
					break
				}
				
				// Rate limit
				bw.rateLimiter.Wait()
				
				select {
				case bw.workQueue <- op:
				case <-bw.ctx.Done():
					return
				}
			}
		}
	}
}

// worker processes file operations
func (bw *BackgroundWorker) worker(id int) {
	defer bw.wg.Done()
	
	for {
		select {
		case <-bw.ctx.Done():
			return
		case op := <-bw.workQueue:
			if op == nil {
				continue
			}
			
			atomic.AddInt32(&bw.active, 1)
			start := time.Now()
			
			err := bw.processOperation(op)
			
			latency := time.Since(start)
			bw.updateMetrics(latency, err)
			
			atomic.AddInt32(&bw.active, -1)
			atomic.AddUint64(&bw.processed, 1)
			
			if err != nil {
				atomic.AddUint64(&bw.errors, 1)
			}
			
			// Call callback if provided
			if op.Callback != nil {
				go op.Callback(err)
			}
		}
	}
}

// processOperation executes a file operation
func (bw *BackgroundWorker) processOperation(op *FileOperation) error {
	switch op.Type {
	case OpRead:
		return bw.readFile(op)
	case OpWrite:
		return bw.writeFile(op)
	case OpAppend:
		return bw.appendFile(op)
	case OpDelete:
		return bw.deleteFile(op)
	case OpCopy:
		return bw.copyFile(op)
	case OpMove:
		return bw.moveFile(op)
	default:
		return fmt.Errorf("unknown operation type: %v", op.Type)
	}
}

// readFile performs a background file read
func (bw *BackgroundWorker) readFile(op *FileOperation) error {
	data, err := os.ReadFile(op.Path)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", op.Path, err)
	}
	op.Data = data
	return nil
}

// writeFile performs a background file write
func (bw *BackgroundWorker) writeFile(op *FileOperation) error {
	// Ensure directory exists
	dir := filepath.Dir(op.Path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	
	// Write atomically using temp file
	tmpFile := op.Path + ".tmp"
	if err := os.WriteFile(tmpFile, op.Data, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", op.Path, err)
	}
	
	// Rename atomically
	if err := os.Rename(tmpFile, op.Path); err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("failed to rename %s: %w", op.Path, err)
	}
	
	return nil
}

// appendFile performs a background file append
func (bw *BackgroundWorker) appendFile(op *FileOperation) error {
	file, err := os.OpenFile(op.Path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open %s: %w", op.Path, err)
	}
	defer file.Close()
	
	if _, err := file.Write(op.Data); err != nil {
		return fmt.Errorf("failed to append to %s: %w", op.Path, err)
	}
	
	return nil
}

// deleteFile performs a background file deletion
func (bw *BackgroundWorker) deleteFile(op *FileOperation) error {
	if err := os.Remove(op.Path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete %s: %w", op.Path, err)
	}
	return nil
}

// copyFile performs a background file copy
func (bw *BackgroundWorker) copyFile(op *FileOperation) error {
	// op.Path is source, op.Data contains destination path as string
	dst := string(op.Data)
	
	source, err := os.Open(op.Path)
	if err != nil {
		return fmt.Errorf("failed to open source %s: %w", op.Path, err)
	}
	defer source.Close()
	
	// Ensure destination directory exists
	dstDir := filepath.Dir(dst)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory %s: %w", dstDir, err)
	}
	
	destination, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to create destination %s: %w", dst, err)
	}
	defer destination.Close()
	
	if _, err := io.Copy(destination, source); err != nil {
		return fmt.Errorf("failed to copy from %s to %s: %w", op.Path, dst, err)
	}
	
	return nil
}

// moveFile performs a background file move
func (bw *BackgroundWorker) moveFile(op *FileOperation) error {
	dst := string(op.Data)
	
	// Try rename first (fast path)
	if err := os.Rename(op.Path, dst); err == nil {
		return nil
	}
	
	// Fall back to copy and delete
	if err := bw.copyFile(op); err != nil {
		return err
	}
	
	return bw.deleteFile(&FileOperation{Path: op.Path})
}

// updateMetrics updates performance metrics
func (bw *BackgroundWorker) updateMetrics(latency time.Duration, err error) {
	bw.mu.Lock()
	defer bw.mu.Unlock()
	
	// Update average latency (exponential moving average)
	if bw.avgLatency == 0 {
		bw.avgLatency = latency
	} else {
		bw.avgLatency = (bw.avgLatency*9 + latency) / 10
	}
	
	// Update max latency
	if latency > bw.maxLatency {
		bw.maxLatency = latency
	}
}

// GetStats returns worker statistics
type WorkerStats struct {
	Active       int32
	Processed    uint64
	Errors       uint64
	QueueSize    int
	AvgLatency   time.Duration
	MaxLatency   time.Duration
}

func (bw *BackgroundWorker) GetStats() WorkerStats {
	bw.mu.RLock()
	defer bw.mu.RUnlock()
	
	return WorkerStats{
		Active:     atomic.LoadInt32(&bw.active),
		Processed:  atomic.LoadUint64(&bw.processed),
		Errors:     atomic.LoadUint64(&bw.errors),
		QueueSize:  len(bw.workQueue),
		AvgLatency: bw.avgLatency,
		MaxLatency: bw.maxLatency,
	}
}

// Shutdown gracefully shuts down the worker pool
func (bw *BackgroundWorker) Shutdown(timeout time.Duration) error {
	// Stop accepting new work
	bw.cancel()
	
	// Wait for workers to finish with timeout
	done := make(chan struct{})
	go func() {
		bw.wg.Wait()
		close(done)
	}()
	
	select {
	case <-done:
		return nil
	case <-time.After(timeout):
		return fmt.Errorf("shutdown timeout exceeded")
	}
}

// PriorityQueue implements a priority queue for file operations
type PriorityQueue struct {
	mu    sync.Mutex
	items []*FileOperation
}

func NewPriorityQueue() *PriorityQueue {
	return &PriorityQueue{
		items: make([]*FileOperation, 0),
	}
}

func (pq *PriorityQueue) Push(op *FileOperation) {
	pq.mu.Lock()
	defer pq.mu.Unlock()
	
	// Insert in priority order
	inserted := false
	for i, item := range pq.items {
		if op.Priority > item.Priority {
			pq.items = append(pq.items[:i], append([]*FileOperation{op}, pq.items[i:]...)...)
			inserted = true
			break
		}
	}
	
	if !inserted {
		pq.items = append(pq.items, op)
	}
}

func (pq *PriorityQueue) Pop() *FileOperation {
	pq.mu.Lock()
	defer pq.mu.Unlock()
	
	if len(pq.items) == 0 {
		return nil
	}
	
	op := pq.items[0]
	pq.items = pq.items[1:]
	return op
}

func (pq *PriorityQueue) Len() int {
	pq.mu.Lock()
	defer pq.mu.Unlock()
	return len(pq.items)
}

// RateLimiter implements token bucket rate limiting
type RateLimiter struct {
	rate       int
	tokens     int
	maxTokens  int
	lastRefill time.Time
	mu         sync.Mutex
}

func NewRateLimiter(ratePerSec int) *RateLimiter {
	return &RateLimiter{
		rate:       ratePerSec,
		tokens:     ratePerSec,
		maxTokens:  ratePerSec,
		lastRefill: time.Now(),
	}
}

func (rl *RateLimiter) Wait() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	// Refill tokens
	now := time.Now()
	elapsed := now.Sub(rl.lastRefill).Seconds()
	tokensToAdd := int(elapsed * float64(rl.rate))
	
	if tokensToAdd > 0 {
		rl.tokens = min(rl.tokens+tokensToAdd, rl.maxTokens)
		rl.lastRefill = now
	}
	
	// Wait if no tokens available
	if rl.tokens <= 0 {
		waitTime := time.Second / time.Duration(rl.rate)
		time.Sleep(waitTime)
		rl.tokens = 1
	}
	
	rl.tokens--
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var idCounter uint64

func generateID() string {
	id := atomic.AddUint64(&idCounter, 1)
	return fmt.Sprintf("op-%d-%d", time.Now().Unix(), id)
}