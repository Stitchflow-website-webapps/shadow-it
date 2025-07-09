import type { App } from '@/types/app'
import type { LoginCredentials, User, Organization } from '@/types/auth'

interface LoginResponse {
  user: User
  organization: Organization | null
  isFirstUser?: boolean
}

interface UpdateOrgSettingsRequest {
  identityProvider: string
  emailProvider: string
}

interface ApiError {
  error: string
}

// Authentication API calls
export const authApi = {
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Login failed')
    }

    // Manually map snake_case to camelCase for organization object
    const organization = data.organization ? {
      id: data.organization.id,
      name: data.organization.name,
      createdAt: data.organization.created_at,
      updatedAt: data.organization.updated_at,
      identityProvider: data.organization.identity_provider,
      emailProvider: data.organization.email_provider,
    } : null

    return { user: data.user, organization, isFirstUser: data.isFirstUser }
  },

  verify: async (userId: string): Promise<LoginResponse> => {
    try {
      // Fetch user and organization from your server-side API
      const response = await fetch(`/api/auth/verify?userId=${userId}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Verification failed')
      }
      const data = await response.json()
      
      // Manually map snake_case to camelCase for organization object
      const organization = data.organization ? {
        id: data.organization.id,
        name: data.organization.name,
        createdAt: data.organization.created_at,
        updatedAt: data.organization.updated_at,
        identityProvider: data.organization.identity_provider,
        emailProvider: data.organization.email_provider,
      } : null
      
      return { user: data.user, organization }
    } catch (error) {
      console.error('API verification error:', error)
      throw error
    }
  },

  updateOrgSettings: async (orgId: string, settings: UpdateOrgSettingsRequest): Promise<Organization> => {
    const response = await fetch('/api/organization/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orgId, ...settings }),
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update organization settings')
    }

    return data.organization
  }
}

// App management API calls
export const appsApi = {
  getApps: async (orgId: string): Promise<App[]> => {
    const response = await fetch(`/api/apps?orgId=${orgId}`, {
      method: 'GET',
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch apps')
    }

    return data.apps
  },

  createApp: async (app: App, orgId: string): Promise<App> => {
    const response = await fetch('/api/apps', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app, orgId }),
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create app')
    }

    return data.app
  },

  updateApp: async (app: App, orgId: string): Promise<App> => {
    const response = await fetch('/api/apps', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app, orgId }),
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update app')
    }

    return data.app
  },

  deleteApp: async (appId: string, orgId: string): Promise<void> => {
    const response = await fetch(`/api/apps?id=${appId}&orgId=${orgId}`, {
      method: 'DELETE',
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete app')
    }
  }
}

// File upload API
export const uploadApi = {
  uploadFile: async (file: File, orgId: string, appName: string): Promise<{ url: string; filePath: string; fileName: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('orgId', orgId)
    formData.append('appName', appName)

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to upload file')
    }

    return {
      url: data.url,
      filePath: data.filePath,
      fileName: data.fileName
    }
  },

  getSignedUrl: async (filePath: string): Promise<string> => {
    const response = await fetch('/api/files/signed-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath }),
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get signed URL')
    }

    return data.signedUrl
  },

  deleteFile: async (filePath: string): Promise<void> => {
    const response = await fetch('/api/files/delete', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath }),
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete file')
    }
  }
} 