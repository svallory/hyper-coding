package performance

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBackgroundWorkerCreation(t *testing.T) {
	opts := DefaultWorkerOptions()
	worker := NewBackgroundWorker(opts)
	require.NotNil(t, worker)
	defer worker.Shutdown(5 * time.Second)
	
	// Check initial state
	stats := worker.GetStats()
	assert.EqualValues(t, 0, stats.Active)
	assert.EqualValues(t, 0, stats.Processed)
	assert.EqualValues(t, 0, stats.Errors)
}

func TestFileWriteOperation(t *testing.T) {
	opts := DefaultWorkerOptions()
	worker := NewBackgroundWorker(opts)
	defer worker.Shutdown(5 * time.Second)
	
	// Create temp directory
	tempDir := t.TempDir()
	testFile := filepath.Join(tempDir, "test.txt")
	testData := []byte("Hello, World!")
	
	done := make(chan error, 1)
	op := &FileOperation{
		Type: OpWrite,
		Path: testFile,
		Data: testData,
		Callback: func(err error) {
			done <- err
		},
	}
	
	// Submit operation
	err := worker.Submit(op)
	require.NoError(t, err)
	
	// Wait for completion
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("Operation timeout")
	}
	
	// Verify file was written
	content, err := os.ReadFile(testFile)
	require.NoError(t, err)
	assert.Equal(t, testData, content)
	
	// Check stats
	stats := worker.GetStats()
	assert.EqualValues(t, 1, stats.Processed)
	assert.EqualValues(t, 0, stats.Errors)
}

func TestFileReadOperation(t *testing.T) {
	opts := DefaultWorkerOptions()
	worker := NewBackgroundWorker(opts)
	defer worker.Shutdown(5 * time.Second)
	
	// Create test file
	tempDir := t.TempDir()
	testFile := filepath.Join(tempDir, "test.txt")
	testData := []byte("Test content")
	err := os.WriteFile(testFile, testData, 0644)
	require.NoError(t, err)
	
	done := make(chan error, 1)
	var readData []byte
	
	op := &FileOperation{
		Type: OpRead,
		Path: testFile,
	}
	
	op.Callback = func(err error) {
		if err == nil {
			readData = op.Data
		}
		done <- err
	}
	
	// Submit operation
	err = worker.Submit(op)
	require.NoError(t, err)
	
	// Wait for completion
	select {
	case err := <-done:
		require.NoError(t, err)
		assert.Equal(t, testData, readData)
	case <-time.After(2 * time.Second):
		t.Fatal("Operation timeout")
	}
}

func TestFileDeleteOperation(t *testing.T) {
	opts := DefaultWorkerOptions()
	worker := NewBackgroundWorker(opts)
	defer worker.Shutdown(5 * time.Second)
	
	// Create test file
	tempDir := t.TempDir()
	testFile := filepath.Join(tempDir, "test.txt")
	err := os.WriteFile(testFile, []byte("delete me"), 0644)
	require.NoError(t, err)
	
	done := make(chan error, 1)
	op := &FileOperation{
		Type: OpDelete,
		Path: testFile,
		Callback: func(err error) {
			done <- err
		},
	}
	
	// Submit operation
	err = worker.Submit(op)
	require.NoError(t, err)
	
	// Wait for completion
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("Operation timeout")
	}
	
	// Verify file was deleted
	_, err = os.Stat(testFile)
	assert.True(t, os.IsNotExist(err))
}

func TestPriorityQueue(t *testing.T) {
	pq := NewPriorityQueue()
	
	// Add operations with different priorities
	op1 := &FileOperation{ID: "1", Priority: 1}
	op2 := &FileOperation{ID: "2", Priority: 5}
	op3 := &FileOperation{ID: "3", Priority: 3}
	
	pq.Push(op1)
	pq.Push(op2)
	pq.Push(op3)
	
	// Pop should return in priority order
	assert.Equal(t, "2", pq.Pop().ID) // Highest priority
	assert.Equal(t, "3", pq.Pop().ID)
	assert.Equal(t, "1", pq.Pop().ID) // Lowest priority
	assert.Nil(t, pq.Pop())            // Empty
}

func TestConcurrentOperations(t *testing.T) {
	opts := DefaultWorkerOptions()
	opts.NumWorkers = 4
	worker := NewBackgroundWorker(opts)
	defer worker.Shutdown(10 * time.Second)
	
	tempDir := t.TempDir()
	numOps := 20
	
	var wg sync.WaitGroup
	errors := make(chan error, numOps)
	
	for i := 0; i < numOps; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			
			testFile := filepath.Join(tempDir, fmt.Sprintf("file-%d.txt", id))
			data := []byte(fmt.Sprintf("Content %d", id))
			
			done := make(chan error, 1)
			op := &FileOperation{
				Type: OpWrite,
				Path: testFile,
				Data: data,
				Callback: func(err error) {
					done <- err
				},
			}
			
			if err := worker.Submit(op); err != nil {
				errors <- err
				return
			}
			
			select {
			case err := <-done:
				if err != nil {
					errors <- err
				}
			case <-time.After(5 * time.Second):
				errors <- assert.AnError
			}
		}(i)
	}
	
	wg.Wait()
	close(errors)
	
	// Check for errors
	for err := range errors {
		t.Errorf("Operation error: %v", err)
	}
	
	// Verify stats
	stats := worker.GetStats()
	assert.EqualValues(t, numOps, stats.Processed)
	assert.EqualValues(t, 0, stats.Errors)
}

func TestRateLimiting(t *testing.T) {
	rl := NewRateLimiter(10) // 10 ops/sec
	
	start := time.Now()
	
	// Try to perform 20 operations
	for i := 0; i < 20; i++ {
		rl.Wait()
	}
	
	elapsed := time.Since(start)
	// Should take at least 500ms for the last 10 ops (first 10 use pre-filled tokens)
	// Allow some margin for timing variance
	assert.Greater(t, elapsed, 400*time.Millisecond)
}

func TestBatchSubmit(t *testing.T) {
	opts := DefaultWorkerOptions()
	worker := NewBackgroundWorker(opts)
	defer worker.Shutdown(5 * time.Second)
	
	tempDir := t.TempDir()
	
	// Create batch of operations
	var ops []*FileOperation
	for i := 0; i < 5; i++ {
		ops = append(ops, &FileOperation{
			Type: OpWrite,
			Path: filepath.Join(tempDir, fmt.Sprintf("batch-%d.txt", i)),
			Data: []byte(fmt.Sprintf("Batch %d", i)),
		})
	}
	
	// Submit batch
	err := worker.SubmitBatch(ops)
	require.NoError(t, err)
	
	// Wait for processing
	time.Sleep(1 * time.Second)
	
	// Verify all files were created
	for i := 0; i < 5; i++ {
		path := filepath.Join(tempDir, fmt.Sprintf("batch-%d.txt", i))
		_, err := os.Stat(path)
		assert.NoError(t, err)
	}
}

func TestWorkerShutdown(t *testing.T) {
	opts := DefaultWorkerOptions()
	opts.NumWorkers = 2
	worker := NewBackgroundWorker(opts)
	
	// Submit some long-running operations
	for i := 0; i < 10; i++ {
		op := &FileOperation{
			Type: OpWrite,
			Path: filepath.Join(t.TempDir(), fmt.Sprintf("shutdown-%d.txt", i)),
			Data: []byte("test"),
		}
		worker.Submit(op)
	}
	
	// Shutdown with timeout
	err := worker.Shutdown(2 * time.Second)
	assert.NoError(t, err)
}

func TestErrorHandling(t *testing.T) {
	opts := DefaultWorkerOptions()
	worker := NewBackgroundWorker(opts)
	defer worker.Shutdown(5 * time.Second)
	
	done := make(chan error, 1)
	op := &FileOperation{
		Type: OpRead,
		Path: "/nonexistent/file.txt",
		Callback: func(err error) {
			done <- err
		},
	}
	
	// Submit operation
	err := worker.Submit(op)
	require.NoError(t, err)
	
	// Wait for error
	select {
	case err := <-done:
		assert.Error(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("Operation timeout")
	}
	
	// Check error was recorded
	stats := worker.GetStats()
	assert.EqualValues(t, 1, stats.Errors)
}

func BenchmarkFileOperations(b *testing.B) {
	opts := DefaultWorkerOptions()
	opts.NumWorkers = 4
	worker := NewBackgroundWorker(opts)
	defer worker.Shutdown(10 * time.Second)
	
	tempDir := b.TempDir()
	
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			op := &FileOperation{
				Type: OpWrite,
				Path: filepath.Join(tempDir, fmt.Sprintf("bench-%d.txt", i)),
				Data: []byte("benchmark data"),
			}
			worker.Submit(op)
			i++
		}
	})
}