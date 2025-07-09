export interface User {
  id: string
  username: string
  orgId: string
  createdAt: string
  updatedAt: string
}

export interface Organization {
  id: string
  name: string
  identityProvider: string
  emailProvider: string
  createdAt: string
  updatedAt: string
}

export interface AuthState {
  user: User | null
  organization: Organization | null
  isLoading: boolean
  isAuthenticated: boolean
}

export interface LoginCredentials {
  username: string
  password: string
}

export interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string; isFirstUser?: boolean }>
  logout: () => void
  refreshAuth: () => Promise<void>
  updateOrgSettings: (identityProvider: string, emailProvider: string) => Promise<Organization>
} 