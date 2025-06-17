# Resource Monitoring and Concurrent Processing

## Overview

This system now includes advanced resource monitoring and adaptive concurrency controls to prevent CPU and memory usage from exceeding 80% while enabling parallel processing for better performance.

## Key Features

### 1. Resource Monitor (`lib/resource-monitor.ts`)
- Real-time CPU and memory monitoring
- Adaptive concurrency based on current resource usage
- Emergency throttling when resources exceed 90%
- Automatic garbage collection and memory cleanup

### 2. Configuration Limits (for 1 CPU + 2GB RAM)
```typescript
{
  maxHeapUsageMB: 1600,     // 80% of 2GB
  maxRSSUsageMB: 1600,      // 80% of 2GB  
  maxConcurrency: 2,        // Conservative for 1 CPU
  emergencyThresholdMB: 1800 // 90% emergency threshold
}
```

### 3. Adaptive Processing

#### Concurrency Levels
- **High Memory (>80%)**: Single-threaded processing only
- **Medium Memory (60-80%)**: Max 2 concurrent operations
- **Low Memory (<60%)**: Full concurrency (up to configured max)

#### Dynamic Batch Sizes
- **High Memory (>70%)**: 50% smaller batches with 3x delays
- **Medium Memory (50-70%)**: 25% smaller batches with 2x delays
- **Normal Memory (<50%)**: Standard batch sizes

## Implementation Details

### 1. Main Sync Route (`/api/background/sync/route.ts`)
- **NEW**: Parallel processing of users + tokens endpoints when resources allow
- **NEW**: Automatic fallback to sequential processing if resources are constrained
- **NEW**: Resource monitoring throughout the sync process

```typescript
// Enable parallel processing with resource awareness
const enableParallel = process.env.ENABLE_PARALLEL_SYNC !== 'false';
const concurrency = monitor.getOptimalConcurrency();

if (concurrency >= 2 && endpoints.length >= 2) {
  // Run users and tokens in parallel
  await Promise.allSettled(parallelPromises);
} else {
  // Fall back to sequential processing
  await processEndpointsSequentially(...);
}
```

### 2. Users Route (`/api/background/sync/users/route.ts`)
- **NEW**: Resource-aware batch processing with `processInBatchesWithResourceControl`
- **NEW**: Dynamic update batch sizes based on memory usage
- **NEW**: Adaptive delays and concurrent user updates

### 3. Tokens Route (`/api/background/sync/tokens/route.ts`)
- **NEW**: Concurrent application processing with `processConcurrentlyWithResourceControl`
- **NEW**: Dynamic batch sizes for token grouping based on memory usage
- **NEW**: Resource-aware database operations

### 4. Relations Route (`/api/background/sync/relations/route.ts`)
- **NEW**: Resource-aware fetching of existing relationships
- **NEW**: Adaptive batch processing for updates and inserts
- **NEW**: Memory-conscious grouping of user-app relationships

## Environment Variables

Add these to your `.env` file to control resource monitoring:

```bash
# Resource Monitoring Configuration
ENABLE_PARALLEL_SYNC=true
MAX_HEAP_USAGE_MB=1600
MAX_RSS_USAGE_MB=1600  
MAX_CONCURRENCY=2
EMERGENCY_THRESHOLD_MB=1800
```

## Benefits

### 1. Performance Improvements
- **Parallel Processing**: Users and tokens sync can run simultaneously
- **Concurrent Operations**: Multiple applications processed concurrently within resource limits
- **Adaptive Batching**: Batch sizes automatically adjust to current system load

### 2. Resource Protection
- **CPU Protection**: Never exceeds configured concurrency limits
- **Memory Protection**: Automatic throttling when memory usage approaches 80%
- **Emergency Handling**: System automatically reduces load at 90% memory usage

### 3. Scalability
- **Large Organizations**: Parallel processing significantly reduces sync time
- **Resource Constraints**: Graceful degradation to sequential processing when needed
- **Memory Management**: Proactive cleanup and garbage collection

## Monitoring

The system provides detailed logging of resource usage:

```
📊 [Users 123] Resources: heap: 890MB/1600MB, rss: 945MB/1600MB, external: 45MB, concurrency: 2
🚀 [Tokens 123] Starting concurrent processing with max concurrency: 2
📉 [Relations 123] Reducing concurrency from 2 to 1 due to resource constraints
```

## Testing

Run the CPU stress test to verify the system stays within resource limits:

```bash
# The stress test will now respect the 80% limits
POST /api/background/cpu-stress-test
```

## Emergency Scenarios

If resources are exhausted:
1. **Automatic Throttling**: Concurrency reduced to 1
2. **Increased Delays**: Longer pauses between operations
3. **Smaller Batches**: Reduced batch sizes to conserve memory
4. **Forced Cleanup**: Automatic garbage collection

This ensures your sync operations never crash due to resource exhaustion while maximizing performance within safe limits. 