'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ExportModal from '@/components/ExportModal';

interface Organization {
  id: string;
  name: string;
  domain: string;
  auth_provider: string;
  applicationCount: number;
  created_at: string;
}

export default function OrgSelectorPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Check if user is the special user
    const userEmail = localStorage.getItem('userEmail');
    const specialUser = localStorage.getItem('specialUser');
    
    if (userEmail !== 'success@stitchflow.io' || specialUser !== 'true') {
      router.push('/?error=access_denied');
      return;
    }

    fetchOrganizations();
  }, [router]);

  const fetchOrganizations = async () => {
    try {
      const response = await fetch('/api/organizations', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch organizations');
      }

      const data = await response.json();
      setOrganizations(data.organizations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const selectOrganization = async (orgId: string) => {
    setSelecting(orgId);
    try {
      const response = await fetch('/api/org-selector/select', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ organizationId: orgId }),
      });

      if (!response.ok) {
        throw new Error('Failed to select organization');
      }

      const data = await response.json();
      
      // Update localStorage with selected org info
      localStorage.setItem('userOrgId', orgId);
      localStorage.setItem('userHd', data.organization.domain);
      
      // Redirect to main dashboard
      window.location.href = data.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select organization');
      setSelecting(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading organizations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p className="font-bold">Error</p>
            <p>{error}</p>
          </div>
          <button 
            onClick={fetchOrganizations}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1"></div>
            <div className="flex-1 text-center">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Select Organization
              </h1>
              <p className="text-gray-600">
                Choose an organization to view their shadow IT applications
              </p>
            </div>
            <div className="flex-1 flex justify-end">
              <button
                onClick={() => setShowExportModal(true)}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export Data</span>
              </button>
            </div>
          </div>
        </div>

        {organizations.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No organizations found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {organizations.map((org) => (
              <div
                key={org.id}
                onClick={() => selectOrganization(org.id)}
                className={`bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer border-2 border-transparent hover:border-blue-500 ${
                  selecting === org.id ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">
                      {org.name}
                    </h3>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      org.auth_provider === 'google' 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {org.auth_provider}
                    </span>
                  </div>
                  
                  <div className="space-y-2 text-sm text-gray-600">
                    <p>
                      <span className="font-medium">Domain:</span> {org.domain}
                    </p>
                    <p>
                      <span className="font-medium">Applications:</span> {org.applicationCount}
                    </p>
                    <p>
                      <span className="font-medium">Created:</span>{' '}
                      {new Date(org.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  {selecting === org.id && (
                    <div className="mt-4 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <span className="ml-2 text-sm text-gray-600">Selecting...</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-center mt-8">
          <p className="text-gray-500 text-sm">
            Logged in as: {localStorage.getItem('userEmail')}
          </p>
        </div>
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        organizations={organizations}
      />
    </div>
  );
} 