// AI Risk Score Cache Utility
// Handles smart caching of AI risk data with size optimization

export interface CachedAIRiskScore {
  'Tool Name': string;
  'AI-Native': string;
  'Average 1': string; // Data Privacy
  'Average 2': string; // Security Access  
  'Average 3': string; // Business Impact
  'Average 4': string; // AI Governance
  'Average 5': string; // Vendor Profile
  matchedAppName: string;
  app_id: number;
  // Only cache essential fields for UI - reduces storage by ~70%
}

interface CacheData {
  scores: Record<string, CachedAIRiskScore>; // Keyed by app name
  timestamp: number;
  orgId: string;
  version: string; // For cache invalidation when structure changes
}

const CACHE_KEY = 'aiRiskScores';
const CACHE_VERSION = '1.0';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (increased from 1 hour)
const MAX_CACHE_SIZE = 3 * 1024 * 1024; // 3MB limit

// Extract only essential fields from full AI risk data
const extractEssentialFields = (fullData: any): CachedAIRiskScore => ({
  'Tool Name': fullData['Tool Name'] || '',
  'AI-Native': fullData['AI-Native'] || '',
  'Average 1': fullData['Average 1'] || '0',
  'Average 2': fullData['Average 2'] || '0', 
  'Average 3': fullData['Average 3'] || '0',
  'Average 4': fullData['Average 4'] || '0',
  'Average 5': fullData['Average 5'] || '0',
  matchedAppName: fullData.matchedAppName || '',
  app_id: fullData.app_id || 0
});

// Cache AI risk scores with size optimization
export const cacheAIRiskScores = (aiRiskData: any[], orgId: string): boolean => {
  if (typeof window === 'undefined') return false;
  
  try {
    // Extract only essential fields to reduce storage size
    const optimizedScores: Record<string, CachedAIRiskScore> = {};
    
    aiRiskData.forEach(score => {
      const appName = score.matchedAppName || score['Tool Name'];
      if (appName) {
        optimizedScores[appName.toLowerCase().trim()] = extractEssentialFields(score);
      }
    });

    const cacheData: CacheData = {
      scores: optimizedScores,
      timestamp: Date.now(),
      orgId,
      version: CACHE_VERSION
    };

    const serialized = JSON.stringify(cacheData);
    
    // Check cache size before storing
    const sizeInBytes = new Blob([serialized]).size;
    if (sizeInBytes > MAX_CACHE_SIZE) {
      console.warn('AI Risk cache size exceeds limit:', sizeInBytes, 'bytes');
      return false;
    }

    localStorage.setItem(CACHE_KEY, serialized);
    console.log(`AI Risk scores cached successfully. Size: ${Math.round(sizeInBytes / 1024)}KB`);
    return true;
    
  } catch (error) {
    console.error('Error caching AI risk scores:', error);
    return false;
  }
};

// Get cached AI risk scores
export const getCachedAIRiskScores = (orgId: string): Record<string, CachedAIRiskScore> | null => {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const cacheData: CacheData = JSON.parse(cached);
    
    // Check cache validity
    const isExpired = Date.now() - cacheData.timestamp > CACHE_TTL;
    const isDifferentOrg = cacheData.orgId !== orgId;
    const isOldVersion = cacheData.version !== CACHE_VERSION;
    
    if (isExpired || isDifferentOrg || isOldVersion) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    
    return cacheData.scores;
    
  } catch (error) {
    console.error('Error retrieving cached AI risk scores:', error);
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
};

// Check if cache exists and is valid
export const isCacheValid = (orgId: string): boolean => {
  return getCachedAIRiskScores(orgId) !== null;
};

// Check if cache needs refreshing (but don't remove it)
export const shouldRefreshCache = (orgId: string): boolean => {
  if (typeof window === 'undefined') return false;
  
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return true; // No cache, need to fetch

    const cacheData: CacheData = JSON.parse(cached);
    
    // Check cache validity without removing
    const isExpired = Date.now() - cacheData.timestamp > CACHE_TTL;
    const isDifferentOrg = cacheData.orgId !== orgId;
    const isOldVersion = cacheData.version !== CACHE_VERSION;
    
    return isExpired || isDifferentOrg || isOldVersion;
    
  } catch (error) {
    console.error('Error checking cache refresh status:', error);
    return true; // Error means we should refresh
  }
};

// Get time remaining until cache expires (in minutes)
export const getCacheTimeRemaining = (orgId: string): number => {
  if (typeof window === 'undefined') return 0;
  
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return 0;

    const cacheData: CacheData = JSON.parse(cached);
    if (cacheData.orgId !== orgId) return 0;
    
    const timeRemaining = CACHE_TTL - (Date.now() - cacheData.timestamp);
    return Math.max(0, Math.round(timeRemaining / (60 * 1000))); // Return minutes
    
  } catch {
    return 0;
  }
};

// Clear cache manually
export const clearAIRiskCache = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CACHE_KEY);
  }
};

// Get cache info for debugging
export const getCacheInfo = (): { size: string; timestamp: string; orgId: string } | null => {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const cacheData: CacheData = JSON.parse(cached);
    const sizeInBytes = new Blob([cached]).size;
    
    return {
      size: `${Math.round(sizeInBytes / 1024)}KB`,
      timestamp: new Date(cacheData.timestamp).toLocaleString(),
      orgId: cacheData.orgId
    };
  } catch {
    return null;
  }
}; 