// Resource monitoring and adaptive concurrency control for sync operations
export interface ResourceUsage {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  cpuTime?: number;
}

export interface ResourceLimits {
  maxHeapUsageMB: number;
  maxRSSUsageMB: number;
  maxConcurrency: number;
  emergencyThresholdMB: number;
}

export class ResourceMonitor {
  private static instance: ResourceMonitor;
  private resourceHistory: ResourceUsage[] = [];
  private readonly maxHistorySize = 10;
  private lastCpuTime = process.cpuUsage();
  private limits: ResourceLimits;
  
  constructor(limits?: Partial<ResourceLimits>) {
    this.limits = {
      maxHeapUsageMB: limits?.maxHeapUsageMB || 1600, // 80% of 2GB
      maxRSSUsageMB: limits?.maxRSSUsageMB || 1600,   // 80% of 2GB
      maxConcurrency: limits?.maxConcurrency || 2,     // Conservative for 1 CPU
      emergencyThresholdMB: limits?.emergencyThresholdMB || 1800, // 90% emergency threshold
    };
  }

  static getInstance(limits?: Partial<ResourceLimits>): ResourceMonitor {
    if (!ResourceMonitor.instance) {
      ResourceMonitor.instance = new ResourceMonitor(limits);
    }
    return ResourceMonitor.instance;
  }

  getCurrentUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuTime);
    
    const usage: ResourceUsage = {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024),
      cpuTime: (cpuUsage.user + cpuUsage.system) / 1000 // Convert to milliseconds
    };

    // Update history
    this.resourceHistory.push(usage);
    if (this.resourceHistory.length > this.maxHistorySize) {
      this.resourceHistory.shift();
    }
    
    this.lastCpuTime = process.cpuUsage();
    return usage;
  }

  isResourceAvailable(): boolean {
    const usage = this.getCurrentUsage();
    return usage.heapUsed < this.limits.maxHeapUsageMB && 
           usage.rss < this.limits.maxRSSUsageMB;
  }

  getOptimalConcurrency(): number {
    const usage = this.getCurrentUsage();
    
    // Emergency mode - severely limit concurrency
    if (usage.heapUsed > this.limits.emergencyThresholdMB || 
        usage.rss > this.limits.emergencyThresholdMB) {
      return 1;
    }
    
    // Calculate dynamic concurrency based on current usage
    const heapRatio = usage.heapUsed / this.limits.maxHeapUsageMB;
    const rssRatio = usage.rss / this.limits.maxRSSUsageMB;
    const maxRatio = Math.max(heapRatio, rssRatio);
    
    if (maxRatio > 0.8) {
      return 1; // Single threaded when near limits
    } else if (maxRatio > 0.6) {
      return Math.min(2, this.limits.maxConcurrency);
    } else {
      return this.limits.maxConcurrency;
    }
  }

  shouldPause(): boolean {
    const usage = this.getCurrentUsage();
    return usage.heapUsed > this.limits.maxHeapUsageMB || 
           usage.rss > this.limits.maxRSSUsageMB;
  }

  forceCleanup(): void {
    if (global.gc) {
      global.gc();
    }
    
    // Clear resource history to free memory
    this.resourceHistory = this.resourceHistory.slice(-3);
  }

  logResourceUsage(operation: string): void {
    const usage = this.getCurrentUsage();
    console.log(`📊 [${operation}] Resources:`, {
      heap: `${usage.heapUsed}MB/${this.limits.maxHeapUsageMB}MB`,
      rss: `${usage.rss}MB/${this.limits.maxRSSUsageMB}MB`,
      external: `${usage.external}MB`,
      concurrency: this.getOptimalConcurrency()
    });
  }

  async waitForResources(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    
    while (!this.isResourceAvailable() && (Date.now() - startTime) < timeoutMs) {
      console.log('⏳ Waiting for resources to become available...');
      this.forceCleanup();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!this.isResourceAvailable()) {
      throw new Error('Timeout waiting for resources to become available');
    }
  }
}

// Helper functions for batch processing with resource awareness
export async function processInBatchesWithResourceControl<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  operation: string,
  baseBatchSize: number = 25,
  baseDelay: number = 100
): Promise<void> {
  const monitor = ResourceMonitor.getInstance();
  
  for (let i = 0; i < items.length; i += baseBatchSize) {
    // Check resources before processing each batch
    await monitor.waitForResources();
    
    // Adjust batch size based on current resource usage
    const usage = monitor.getCurrentUsage();
    const memoryRatio = Math.max(
      usage.heapUsed / 1600, // Assuming 1600MB limit
      usage.rss / 1600
    );
    
    // Reduce batch size if memory usage is high
    let adjustedBatchSize = baseBatchSize;
    if (memoryRatio > 0.7) {
      adjustedBatchSize = Math.max(5, Math.floor(baseBatchSize * 0.5));
    } else if (memoryRatio > 0.5) {
      adjustedBatchSize = Math.max(10, Math.floor(baseBatchSize * 0.75));
    }
    
    const batch = items.slice(i, i + adjustedBatchSize);
    
    try {
      await processor(batch);
      monitor.logResourceUsage(operation);
    } catch (error) {
      console.error(`Error processing batch in ${operation}:`, error);
      // Force cleanup on error
      monitor.forceCleanup();
      throw error;
    }
    
    // Adaptive delay based on resource usage
    let delay = baseDelay;
    if (memoryRatio > 0.7) {
      delay = baseDelay * 3; // Longer delay when memory is high
    } else if (memoryRatio > 0.5) {
      delay = baseDelay * 2;
    }
    
    if (i + adjustedBatchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Force cleanup every few batches
    if (i % (baseBatchSize * 5) === 0) {
      monitor.forceCleanup();
    }
  }
}

// Concurrent processing with resource limits
export async function processConcurrentlyWithResourceControl<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  operation: string,
  maxConcurrency?: number
): Promise<void> {
  const monitor = ResourceMonitor.getInstance();
  
  // Use adaptive concurrency if not specified
  const concurrency = maxConcurrency || monitor.getOptimalConcurrency();
  
  console.log(`🚀 [${operation}] Starting concurrent processing with max concurrency: ${concurrency}`);
  
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    chunks.push(items.slice(i, i + concurrency));
  }
  
  for (const chunk of chunks) {
    // Wait for resources before processing each chunk
    await monitor.waitForResources();
    
    // Check if we should reduce concurrency due to high resource usage
    const currentConcurrency = Math.min(chunk.length, monitor.getOptimalConcurrency());
    
    if (currentConcurrency < chunk.length) {
      console.log(`📉 [${operation}] Reducing concurrency from ${chunk.length} to ${currentConcurrency} due to resource constraints`);
      
      // Process with reduced concurrency
      const reducedChunks = [];
      for (let i = 0; i < chunk.length; i += currentConcurrency) {
        reducedChunks.push(chunk.slice(i, i + currentConcurrency));
      }
      
      for (const reducedChunk of reducedChunks) {
        await Promise.all(reducedChunk.map(processor));
        monitor.logResourceUsage(operation);
        
        // Small delay between reduced chunks
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } else {
      // Process with full concurrency
      await Promise.all(chunk.map(processor));
      monitor.logResourceUsage(operation);
    }
    
    // Delay between chunks, longer if resources are stressed
    const usage = monitor.getCurrentUsage();
    const memoryRatio = Math.max(usage.heapUsed / 1600, usage.rss / 1600);
    const delay = memoryRatio > 0.7 ? 500 : memoryRatio > 0.5 ? 300 : 100;
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }
} 