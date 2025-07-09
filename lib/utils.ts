import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// For client components to get session info
export async function getSessionInfo() {
  try {
    const response = await fetch('/api/auth/session');
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error('Error getting session info:', error);
    return null;
  }
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Generates a cryptographically secure random string
 * @param length Length of the string to generate (default: 32)
 * @returns A random string of the specified length
 */
export function generateRandomString(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues)
    .map(v => chars[v % chars.length])
    .join('');
}


export function formatCurrency(
  cost: number | string | null | undefined,
  currency: string = "USD",
  locale: string = "en-US"
): string {
  if (cost === null || cost === undefined || cost === "") {
    return "—";
  }

  let numericCost: number;
  if (typeof cost === "string") {
    // Remove any non-numeric characters except for the decimal point
    const cleanedCost = cost.replace(/[^0-9.]/g, "");
    numericCost = parseFloat(cleanedCost);
  } else {
    numericCost = cost;
  }

  if (isNaN(numericCost)) {
    return "—";
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericCost);
}

// License utilization badge utilities
export function getLicenseUtilizationStatus(licensesUsed: number | null, planLimit: string): {
  status: string;
  variant: 'success' | 'warning' | 'destructive' | 'outline';
  color: string;
} | null {
  // Return null if we don't have the required data
  if (licensesUsed === null || !planLimit) return null;
  
  // Handle special cases like "Unlimited"
  if (planLimit.toLowerCase().includes('unlimited') || planLimit.toLowerCase().includes('no limit')) {
    return null; // Don't show badge for unlimited plans
  }
  
  // Extract numeric value from plan limit
  const numericLimit = extractNumericFromPlanLimit(planLimit);
  if (numericLimit === 0) return null; // Can't calculate if no valid limit
  
  // Calculate utilization percentage
  const utilizationPercent = (licensesUsed / numericLimit) * 100;
  
  // Determine status based on percentage
  if (utilizationPercent >= 100) {
    return {
      status: 'Exceeded limit',
      variant: 'destructive',
      color: 'bg-red-50 text-red-700 border-red-200'
    };
  } else if (utilizationPercent >= 85) {
    return {
      status: 'Near capacity',
      variant: 'warning',
      color: 'bg-orange-50 text-orange-700 border-orange-200'
    };
  } else if (utilizationPercent >= 70) {
    return {
      status: 'Growing usage',
      variant: 'warning',
      color: 'bg-yellow-50 text-yellow-700 border-yellow-200'
    };
  } else {
    return {
      status: 'Optimal',
      variant: 'success',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    };
  }
}

// Helper function to extract numeric value from plan limit text
function extractNumericFromPlanLimit(planLimit: string): number {
  // Handle special cases
  if (!planLimit || planLimit.toLowerCase().includes('unlimited') || planLimit.toLowerCase().includes('no limit')) {
    return 0; // Return 0 to indicate no valid numeric limit
  }
  
  // Extract first number from the string
  const match = planLimit.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}