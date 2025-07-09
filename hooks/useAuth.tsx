"use client"

import React, { createContext, useContext, useEffect, useState } from 'react'
import Cookies from 'js-cookie'
import { authApi } from '@/lib/api'
import type { AuthContextType, User, Organization, LoginCredentials } from '@/types/auth'

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isAuthenticated = !!user

  const login = async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string; isFirstUser?: boolean }> => {
    try {
      setIsLoading(true)
      
      // Call server-side login API
      const response = await authApi.login(credentials)

      setUser(response.user)
      setOrganization(response.organization)

      // Set cookie for session persistence
      Cookies.set('organize-app-auth', response.user.id, { expires: 7 }) // 7 days

      return { success: true, isFirstUser: (response as any).isFirstUser }
    } catch (error) {
      console.error('Login error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'An error occurred during login' }
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    setUser(null)
    setOrganization(null)
    Cookies.remove('organize-app-auth')
  }

  const refreshAuth = async () => {
    try {
      setIsLoading(true)
      const userId = Cookies.get('organize-app-auth')
      
      if (!userId) {
        setUser(null)
        setOrganization(null)
        return
      }

      // Call server-side verify API
      const { user, organization } = await authApi.verify(userId)

      setUser(user)
      setOrganization(organization)
    } catch (error) {
      console.error('Auth refresh error:', error)
      logout()
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshAuth()
  }, [])

  const updateOrgSettings = async (identityProvider: string, emailProvider: string) => {
    if (!user?.orgId) {
      throw new Error('No organization found')
    }

    try {
      const updatedOrg = await authApi.updateOrgSettings(user.orgId, {
        identityProvider,
        emailProvider
      })
      setOrganization(updatedOrg)
      return updatedOrg
    } catch (error) {
      console.error('Error updating org settings:', error)
      throw error
    }
  }

  const value: AuthContextType = {
    user,
    organization,
    isLoading,
    isAuthenticated,
    login,
    logout,
    refreshAuth,
    updateOrgSettings
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
} 