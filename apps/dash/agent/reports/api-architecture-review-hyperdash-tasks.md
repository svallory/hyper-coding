# API Architecture Review - HyperDash Tasks

**Date**: 2025-09-18  
**Reviewer**: API Architecture Specialist (Agent 4 of Multi-Agent Review)  
**System**: HyperDash (2,441+ lines)  
**Focus**: External integration patterns, data protocols, reliability strategies

## Executive Summary

HyperDash demonstrates solid file-based integration patterns with JSON workflows and fsnotify-based real-time updates. The architecture is well-suited for monitoring but requires significant API design for TaskMaster CLI integration. The current implementation shows good separation of concerns with message-based communication patterns that can be extended for external APIs.

## Current API Architecture Analysis

### Strengths
1. **Message-Based Architecture**: Clean pub/sub pattern via Bubble Tea messages
2. **JSON Schema Design**: Well-structured workflow state with versioning potential
3. **File-Based Integration**: Robust fsnotify implementation for real-time updates
4. **Error Handling**: Graceful degradation with ErrorMsg propagation
5. **Concurrent Design**: Thread-safe watcher with proper mutex usage

### Integration Patterns Identified

#### 1. File-Based API (Current)
```go
// Current pattern: JSON files as API
workflow-state.json → Epic model → UI updates
workflow.log → Log parser → Log viewer
```

**Reliability**: Excellent for local filesystem operations
**Performance**: Sub-millisecond file change detection
**Scalability**: Limited to local filesystem scope

#### 2. Message Bus Pattern (Internal)
```go
type EpicUpdateMsg struct { Epic Epic }
type LogUpdateMsg struct { Entry LogEntry }
type ErrorMsg string
```

**Pattern Quality**: Clean separation, easy to extend
**Type Safety**: Strong typing with Go structs
**Extensibility**: Ready for external message sources

## Task-by-Task API Architecture Assessment

### Task 1: Implement 6-Tab UI Structure Alignment ✅

**API Impact**: Minimal  
**Integration Points**: None required  
**Data Flow**: Internal only via existing message types

**Recommendation**: No API changes needed. Current message types sufficient.

### Task 2: Vi-mode Navigation Enhancement ✅

**API Impact**: None  
**Integration Points**: Keyboard event handling only  
**Data Flow**: Pure UI concern

**Recommendation**: No API considerations required.

### Task 3: Create TaskMaster CLI Integration Package 🔴 CRITICAL

**API Impact**: Major - Core integration requirement  
**Integration Points**: Multiple communication patterns needed

#### Proposed API Architecture

##### Option 1: JSON-RPC 2.0 (Recommended)
```go
package taskmaster

type RPCClient struct {
    stdin  io.WriteCloser
    stdout io.ReadCloser
    decoder *json.Decoder
    encoder *json.Encoder
    reqID   uint64
}

type Request struct {
    JSONRPC string      `json:"jsonrpc"`
    Method  string      `json:"method"`
    Params  interface{} `json:"params"`
    ID      uint64      `json:"id"`
}

type Response struct {
    JSONRPC string          `json:"jsonrpc"`
    Result  json.RawMessage `json:"result,omitempty"`
    Error   *Error          `json:"error,omitempty"`
    ID      uint64          `json:"id"`
}
```

**Pros**: Standard protocol, bidirectional, request/response correlation  
**Cons**: Requires TaskMaster to implement JSON-RPC server

##### Option 2: REST-like CLI Commands
```go
type CommandExecutor struct {
    cmd *exec.Cmd
    timeout time.Duration
}

func (e *CommandExecutor) Execute(command string, args ...string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
    defer cancel()
    
    cmd := exec.CommandContext(ctx, "taskmaster", append([]string{command}, args...)...)
    return cmd.Output()
}
```

**Pros**: Simple, stateless, easy error handling  
**Cons**: Higher latency, no streaming support

##### Option 3: Named Pipes/Unix Sockets
```go
type SocketClient struct {
    conn net.Conn
    protocol Protocol
}

func (c *SocketClient) Connect() error {
    conn, err := net.Dial("unix", "/tmp/taskmaster.sock")
    if err != nil {
        return fmt.Errorf("failed to connect: %w", err)
    }
    c.conn = conn
    return nil
}
```

**Pros**: Low latency, bidirectional streaming  
**Cons**: Platform-specific, complex error recovery

#### API Reliability Patterns Required

1. **Circuit Breaker**
```go
type CircuitBreaker struct {
    maxFailures  int
    resetTimeout time.Duration
    failures     int
    lastFailTime time.Time
    state        State // CLOSED, OPEN, HALF_OPEN
}
```

2. **Retry with Exponential Backoff**
```go
type RetryConfig struct {
    MaxAttempts int
    InitialDelay time.Duration
    MaxDelay time.Duration
    Multiplier float64
}
```

3. **Request Timeout Management**
```go
type TimeoutManager struct {
    defaultTimeout time.Duration
    perMethod map[string]time.Duration
}
```

#### Data Schema Design

```go
// TaskMaster API Types
type Task struct {
    ID          string    `json:"id"`
    EpicID      string    `json:"epic_id"`
    Title       string    `json:"title"`
    Status      string    `json:"status"`
    Priority    int       `json:"priority"`
    AssignedTo  []string  `json:"assigned_to"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
}

type CreateTaskRequest struct {
    EpicID   string   `json:"epic_id"`
    Title    string   `json:"title"`
    Priority int      `json:"priority"`
    Agents   []string `json:"agents"`
}

type UpdateTaskRequest struct {
    Status string `json:"status,omitempty"`
    Notes  string `json:"notes,omitempty"`
}
```

**Risk Assessment**: HIGH - Complex integration with unknown TaskMaster API  
**Mitigation**: Start with mock TaskMaster server for development

### Task 4: Enhance Table Components with Advanced Features ✅

**API Impact**: Minimal  
**Integration Points**: Sorting/filtering on existing data

**API Considerations**:
- Ensure Epic model supports all sortable fields
- Consider lazy loading for large datasets
- Cache filtered/sorted results

```go
type TableConfig struct {
    SortBy      string
    SortOrder   string // "asc" | "desc"
    FilterBy    map[string]string
    PageSize    int
    CurrentPage int
}
```

### Task 5: Implement Performance Optimization and Caching ⚠️

**API Impact**: Moderate - Caching layer design  
**Integration Points**: All data fetching operations

#### Proposed Caching Architecture

```go
type CacheLayer struct {
    memory *MemoryCache
    disk   *DiskCache
    ttl    map[string]time.Duration
}

type MemoryCache struct {
    data map[string]CacheEntry
    mu   sync.RWMutex
    maxSize int64
    currentSize int64
}

type CacheEntry struct {
    Data      []byte
    ExpiresAt time.Time
    ETag      string
    Size      int64
}
```

**Cache Strategies**:
1. **Workflow State**: 5-second TTL with ETag validation
2. **Log Files**: Append-only cache with position tracking
3. **TaskMaster Responses**: 30-second TTL for read operations
4. **UI State**: In-memory only, no persistence

### Task 6: Setup Cross-platform CI/CD ✅

**API Impact**: None  
**Integration Points**: Build system only

**API Testing Requirements**:
- Mock TaskMaster server for CI
- Contract testing for API compatibility
- Load testing for concurrent operations

### Task 7: Create npm Package Wrapper ✅

**API Impact**: Package distribution only  
**Integration Points**: Binary execution wrapper

```javascript
// npm wrapper API
const { spawn } = require('child_process');

class HyperDash {
    constructor(options = {}) {
        this.binaryPath = options.binaryPath || getBinaryPath();
        this.epicDir = options.epicDir || './agent/epics';
    }
    
    start() {
        return spawn(this.binaryPath, ['-epics', this.epicDir], {
            stdio: 'inherit'
        });
    }
}
```

### Task 8: Comprehensive Testing ⚠️

**API Impact**: Testing infrastructure  
**Integration Points**: All API boundaries

#### API Testing Strategy

1. **Unit Tests**: Mock all external dependencies
2. **Integration Tests**: Test with real file system
3. **Contract Tests**: Validate TaskMaster API compatibility
4. **E2E Tests**: Full workflow simulation
5. **Performance Tests**: Concurrent operation limits

```go
// API Test Helpers
type MockTaskMaster struct {
    responses map[string]interface{}
    calls     []CallRecord
    mu        sync.Mutex
}

func (m *MockTaskMaster) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Record and respond
}
```

## Critical API Design Decisions

### 1. Communication Protocol Selection

**Recommendation**: JSON-RPC 2.0 via stdio
- Standardized protocol
- Bidirectional communication
- Request/response correlation
- Stream support via notifications

### 2. Error Handling Strategy

```go
type APIError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
    Details map[string]interface{} `json:"details,omitempty"`
    Retry   bool   `json:"retry"`
}

// Error codes
const (
    ErrTaskMasterUnavailable = "TASKMASTER_UNAVAILABLE"
    ErrInvalidRequest        = "INVALID_REQUEST"
    ErrTimeout               = "TIMEOUT"
    ErrRateLimited           = "RATE_LIMITED"
)
```

### 3. Rate Limiting Design

```go
type RateLimiter struct {
    tokens    int
    maxTokens int
    refillRate time.Duration
    mu        sync.Mutex
}

func (r *RateLimiter) Allow() bool {
    // Token bucket algorithm
}
```

### 4. Authentication Pattern

```go
type AuthProvider interface {
    GetToken() (string, error)
    Refresh() error
    Validate(token string) bool
}

type APIKeyAuth struct {
    key string
}

type JWTAuth struct {
    token        string
    refreshToken string
    expiresAt    time.Time
}
```

## Performance Optimization Recommendations

### 1. Connection Pooling
```go
type ConnectionPool struct {
    connections chan net.Conn
    factory     ConnectionFactory
    maxSize     int
}
```

### 2. Request Batching
```go
type BatchProcessor struct {
    requests  []Request
    batchSize int
    interval  time.Duration
}
```

### 3. Response Caching
```go
type ResponseCache struct {
    cache *lru.Cache
    ttl   time.Duration
}
```

## Security Considerations

### 1. Input Validation
- Validate all TaskMaster responses
- Sanitize file paths
- Limit request sizes
- Validate JSON schemas

### 2. Process Isolation
- Run TaskMaster CLI in separate process
- Use context timeouts
- Handle process crashes gracefully
- Implement resource limits

### 3. Data Encryption
- Use TLS for network communications
- Encrypt sensitive cache entries
- Secure credential storage
- Audit log API calls

## Risk Matrix

| Task | API Risk | Complexity | Mitigation Strategy |
|------|----------|------------|--------------------|
| 1. UI Tabs | None | Simple | None needed |
| 2. Vi-mode | None | Simple | None needed |
| 3. TaskMaster | **HIGH** | Complex | Mock server, phased rollout |
| 4. Tables | Low | Medium | Performance testing |
| 5. Caching | Medium | Medium | Cache invalidation strategy |
| 6. CI/CD | None | Simple | None needed |
| 7. npm | None | Simple | None needed |
| 8. Testing | Low | Medium | Comprehensive test coverage |

## Implementation Priority (API Perspective)

1. **Phase 1**: TaskMaster API Design & Mock Server
   - Define JSON-RPC protocol
   - Create mock server
   - Implement client library
   - Add circuit breaker

2. **Phase 2**: Caching Infrastructure
   - Memory cache implementation
   - Cache invalidation logic
   - Performance monitoring

3. **Phase 3**: Production Hardening
   - Rate limiting
   - Connection pooling
   - Comprehensive error handling
   - Security audit

## Conclusion

HyperDash has a solid foundation for API integration with clean message-based architecture and robust file monitoring. The TaskMaster CLI integration represents the primary API challenge, requiring careful protocol selection, reliability patterns, and comprehensive error handling. The recommended JSON-RPC approach provides the best balance of standardization, flexibility, and reliability.

### Key Recommendations

1. **Start with Mock TaskMaster**: Build against mock server first
2. **Use JSON-RPC 2.0**: Standard protocol with good Go support
3. **Implement Circuit Breaker**: Essential for CLI integration reliability
4. **Design for Failure**: Assume TaskMaster will be unavailable
5. **Cache Aggressively**: Reduce TaskMaster API calls
6. **Test Extensively**: Focus on integration boundaries
7. **Monitor Everything**: API calls, latency, errors, cache hits

### Success Metrics

- TaskMaster API latency < 100ms p95
- Circuit breaker recovery < 30 seconds
- Cache hit rate > 80% for read operations
- Zero data loss on TaskMaster unavailability
- API error rate < 0.1%

**Assessment**: The system is well-architected for monitoring with excellent potential for API integration. TaskMaster integration is the critical path item requiring immediate attention and careful design.
