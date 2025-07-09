"use client"

import { useState, useEffect } from "react"

export interface AppIntegration {
  name: string
  connectionStatus: string
}

export function useAppIntegrations() {
  const [integrations, setIntegrations] = useState<AppIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchIntegrations() {
      try {
        const response = await fetch(
          "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/stitchflow-intg%20list-K5UBvEAIl4xhSgVYxIckYWH6WsdxMh.csv",
        )
        const csvText = await response.text()

        const lines = csvText.split("\n")
        const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""))

        const data: AppIntegration[] = []

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim()
          if (!line) continue

          const values = line.split(",").map((v) => v.trim().replace(/"/g, ""))
          if (values.length >= 2) {
            const name = values[0]
            const status = values[1]

            if (name && status) {
              // Map CSV status to our dropdown values
              let mappedStatus = "No"
              if (status.toLowerCase().includes("csv") && status.toLowerCase().includes("api coming soon")) {
                mappedStatus = "Yes - CSV Sync"
              } else if (status.toLowerCase().includes("api")) {
                mappedStatus = "Yes - API"
              } else if (status.toLowerCase().includes("csv")) {
                mappedStatus = "Yes - CSV Sync"
              }

              data.push({
                name: name,
                connectionStatus: mappedStatus,
              })
            }
          }
        }

        setIntegrations(data)
      } catch (err) {
        setError("Failed to fetch integrations")
        console.error("Error fetching integrations:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchIntegrations()
  }, [])

  return { integrations, loading, error }
}
