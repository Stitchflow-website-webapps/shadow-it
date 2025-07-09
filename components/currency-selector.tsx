import React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface CurrencySelectorProps {
  value: string
  onValueChange: (value: string) => void
  className?: string
}

export const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  { code: "DKK", symbol: "kr", name: "Danish Krone" },
]

export function getCurrencySymbol(currencyCode: string): string {
  const currency = CURRENCIES.find(c => c.code === currencyCode)
  return currency?.symbol || "$"
}

export function parseCurrencyValue(value: string): { symbol: string, amount: string, currencyCode: string } {
  if (!value || value === "Not specified") {
    return { symbol: "$", amount: "", currencyCode: "USD" }
  }
  
  // Find which currency symbol the value starts with
  for (const currency of CURRENCIES) {
    if (value.startsWith(currency.symbol)) {
      return {
        symbol: currency.symbol,
        amount: value.slice(currency.symbol.length),
        currencyCode: currency.code
      }
    }
  }
  
  // Default fallback - assume USD and clean any remaining symbols
  return {
    symbol: "$",
    amount: value.replace(/[^0-9.]/g, ""),
    currencyCode: "USD"
  }
}

export function formatCurrencyValue(symbol: string, amount: string): string {
  if (!amount || amount === "") return ""
  return `${symbol}${amount}`
}

export function CurrencySelector({ value, onValueChange, className }: CurrencySelectorProps) {
  return (
    <Select value={value || "USD"} onValueChange={onValueChange}>
      <SelectTrigger className={className}>
        <SelectValue>
          {getCurrencySymbol(value || "USD")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((currency) => (
          <SelectItem key={currency.code} value={currency.code}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{currency.symbol}</span>
              <span className="text-sm text-gray-600">{currency.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
} 