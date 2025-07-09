import type { OrganizeApp } from '@/lib/supabase/organize-client'

// API client for organize-app-inbox operations
export const organizeApi = {
  // Get all apps for an organization
  async getApps(shadowOrgId: string): Promise<OrganizeApp[]> {
    const response = await fetch(`/api/organize/apps?shadowOrgId=${shadowOrgId}`)
    if (!response.ok) {
      throw new Error('Failed to fetch apps')
    }
    return response.json()
  },

  // Create a new app
  async createApp(app: Partial<OrganizeApp>, shadowOrgId: string): Promise<OrganizeApp> {
    const response = await fetch('/api/organize/apps', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app, shadowOrgId }),
    })
    if (!response.ok) {
      throw new Error('Failed to create app')
    }
    return response.json()
  },

  // Update an existing app
  async updateApp(app: OrganizeApp, shadowOrgId: string): Promise<OrganizeApp> {
    const response = await fetch('/api/organize/apps', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app, shadowOrgId }),
    })
    if (!response.ok) {
      throw new Error('Failed to update app')
    }
    return response.json()
  },

  // Delete an app
  async deleteApp(appId: string, shadowOrgId: string): Promise<void> {
    const response = await fetch(`/api/organize/apps?appId=${appId}&shadowOrgId=${shadowOrgId}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error('Failed to delete app')
    }
  },
} 