import { EventEmitter } from 'events';

export interface ResourceUsage {
  cpuPercent: number;
  memoryPercent: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  timestamp: number;
}

export interface ResourceLimits {
  maxCpuPercent: number;
  maxMemoryPercent: number;
  warningCpuPercent: number;
  warningMemoryPercent: number;
}

export class ResourceMonitor extends EventEmitter {
  private static instance: ResourceMonitor;
  private resourceHistory: ResourceUsage[] = [];
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private lastCpuUsage?: NodeJS.CpuUsage;
  private limits: ResourceLimits;

  constructor(limits: ResourceLimits = {
    maxCpuPercent: 80,
    maxMemoryPercent: 80,
    warningCpuPercent: 70,
    warningMemoryPercent: 70
  }) {
    super();
    this.limits = limits;
  }

  static getInstance(limits?: ResourceLimits): ResourceMonitor {
    if (!ResourceMonitor.instance) {
      ResourceMonitor.instance = new ResourceMonitor(limits);
    }
    return ResourceMonitor.instance;
  }

  startMonitoring(intervalMs: number = 1000): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.lastCpuUsage = process.cpuUsage();
    
    this.monitoringInterval = setInterval(() => {
      const usage = this.getCurrentUsage();
      this.resourceHistory.push(usage);
      
      // Keep only last 60 readings (1 minute if 1s interval)
      if (this.resourceHistory.length > 60) {
        this.resourceHistory.shift();
      }
      
      // Emit events based on usage
      this.checkThresholds(usage);
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
  }

  getCurrentUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    
    // Calculate CPU percentage (approximation)
    const cpuPercent = Math.min(100, ((cpuUsage.user + cpuUsage.system) / 1000000) * 100);
    
    // Calculate memory percentage (based on RSS vs available system memory)
    // For containers, we'll use a rough estimate based on heap limits
    const memoryPercent = Math.min(100, (memUsage.heapUsed / (memUsage.heapTotal * 2)) * 100);
    
    return {
      cpuPercent,
      memoryPercent,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      timestamp: Date.now()
    };
  }

  getAverageUsage(windowMs: number = 5000): ResourceUsage | null {
    const cutoff = Date.now() - windowMs;
    const recentReadings = this.resourceHistory.filter(r => r.timestamp >= cutoff);
    
    if (recentReadings.length === 0) return null;
    
    const avg = recentReadings.reduce((acc, curr) => ({
      cpuPercent: acc.cpuPercent + curr.cpuPercent,
      memoryPercent: acc.memoryPercent + curr.memoryPercent,
      heapUsed: acc.heapUsed + curr.heapUsed,
      heapTotal: acc.heapTotal + curr.heapTotal,
      rss: acc.rss + curr.rss,
      timestamp: curr.timestamp
    }), {
      cpuPercent: 0,
      memoryPercent: 0,
      heapUsed: 0,
      heapTotal: 0,
      rss: 0,
      timestamp: Date.now()
    });
    
    const count = recentReadings.length;
    return {
      cpuPercent: avg.cpuPercent / count,
      memoryPercent: avg.memoryPercent / count,
      heapUsed: avg.heapUsed / count,
      heapTotal: avg.heapTotal / count,
      rss: avg.rss / count,
      timestamp: avg.timestamp
    };
  }

  isOverloaded(): boolean {
    const current = this.getCurrentUsage();
    const avg = this.getAverageUsage(3000); // 3 second average
    
    if (!avg) return current.cpuPercent > this.limits.maxCpuPercent || 
                   current.memoryPercent > this.limits.maxMemoryPercent;
    
    return avg.cpuPercent > this.limits.maxCpuPercent || 
           avg.memoryPercent > this.limits.maxMemoryPercent;
  }

  shouldThrottle(): boolean {
    const current = this.getCurrentUsage();
    const avg = this.getAverageUsage(3000);
    
    if (!avg) return current.cpuPercent > this.limits.warningCpuPercent || 
                   current.memoryPercent > this.limits.warningMemoryPercent;
    
    return avg.cpuPercent > this.limits.warningCpuPercent || 
           avg.memoryPercent > this.limits.warningMemoryPercent;
  }

  getThrottleDelay(): number {
    if (!this.shouldThrottle()) return 0;
    
    const current = this.getCurrentUsage();
    const cpuOverage = Math.max(0, current.cpuPercent - this.limits.warningCpuPercent);
    const memOverage = Math.max(0, current.memoryPercent - this.limits.warningMemoryPercent);
    
    // Exponential backoff based on overage
    const maxOverage = Math.max(cpuOverage, memOverage);
    return Math.min(5000, Math.max(100, maxOverage * 50)); // 100ms to 5s delay
  }

  forceMemoryCleanup(): void {
    if (global.gc) {
      global.gc();
    }
    
    // Clear resource history if it's getting too large
    if (this.resourceHistory.length > 100) {
      this.resourceHistory = this.resourceHistory.slice(-30);
    }
  }

  private checkThresholds(usage: ResourceUsage): void {
    if (usage.cpuPercent > this.limits.maxCpuPercent || 
        usage.memoryPercent > this.limits.maxMemoryPercent) {
      this.emit('overload', usage);
    } else if (usage.cpuPercent > this.limits.warningCpuPercent || 
               usage.memoryPercent > this.limits.warningMemoryPercent) {
      this.emit('warning', usage);
    }
  }
}

// Circuit breaker for preventing cascading failures
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private failureThreshold: number = 5,
    private timeout: number = 60000, // 1 minute
    private monitoringPeriod: number = 10000 // 10 seconds
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN - too many failures');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): string {
    return this.state;
  }
}

// Helper function to wait with resource awareness
export async function resourceAwareSleep(baseMs: number, resourceMonitor: ResourceMonitor): Promise<void> {
  const throttleDelay = resourceMonitor.getThrottleDelay();
  const totalDelay = baseMs + throttleDelay;
  
  if (throttleDelay > 0) {
    console.log(`🔧 Throttling: Adding ${throttleDelay}ms delay due to resource usage`);
  }
  
  return new Promise(resolve => setTimeout(resolve, totalDelay));
}

// Dynamic batch size calculator
export function calculateOptimalBatchSize(
  baseBatchSize: number, 
  resourceMonitor: ResourceMonitor,
  minBatchSize: number = 5,
  maxBatchSize: number = 100
): number {
  const usage = resourceMonitor.getCurrentUsage();
  
  // Reduce batch size if resources are high
  let multiplier = 1;
  if (usage.cpuPercent > 70) multiplier *= 0.7;
  if (usage.memoryPercent > 70) multiplier *= 0.7;
  if (usage.cpuPercent > 50) multiplier *= 0.8;
  if (usage.memoryPercent > 50) multiplier *= 0.8;
  
  const adjustedSize = Math.floor(baseBatchSize * multiplier);
  return Math.max(minBatchSize, Math.min(maxBatchSize, adjustedSize));
} 