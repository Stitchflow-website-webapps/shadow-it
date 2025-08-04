# Shadow IT Management Dashboard

A comprehensive dashboard for managing and monitoring shadow IT applications across your organization.

## Features

- **Automated Discovery**: Automatically discover and catalog applications being used across your organization
- **Risk Assessment**: Identify high-risk applications based on permissions and scopes
- **User Tracking**: Monitor which users have access to what applications
- **Management Status**: Track which applications are managed vs. unmanaged
- **AI-Powered Categorization**: Automatically categorize applications using ChatGPT
- **Domain Mapping**: Automatically map non-shadow IT organizations from organize-app-inbox schema
- **Webhook Notifications**: Send application data to external systems on first-time signup

### Domain Mapping for Non-Shadow IT Organizations

The system supports automatic domain mapping between the `organize-app-inbox` schema and the shadow IT schema. When a user signs up for the first time:

1. **Domain Check**: The system checks if the organization's domain already exists in the `organize-app-inbox.organizations` table
2. **Existing Organization**: If the domain exists, the system links the shadow IT organization to the existing `organize-app-inbox` organization using the `shadow_org_id` field
3. **New Organization**: If the domain doesn't exist, a new organization is created in both schemas with proper linking

This ensures that non-shadow IT organizations are properly mapped between the two schemas, maintaining data consistency and enabling cross-schema operations.

#### Supported Auth Providers
- Google Workspace (OAuth)
- Microsoft Entra ID (OAuth)

#### Implementation Details
- **Google Auth**: Uses the `hd` (hosted domain) field from Google user info
- **Microsoft Auth**: Extracts domain from the user's email address (`userPrincipalName`)
- **Error Handling**: Domain mapping failures don't block the main authentication flow
- **Logging**: Comprehensive logging for debugging domain mapping operations

### Webhook Notifications

The system automatically sends webhook notifications when background sync completes **for the first time only** (new user signup). This allows external systems to be notified when new application data is available.

#### Webhook Features
- **First-Time Only**: Only sent when a user signs up for the first time and completes their initial sync
- **Application Data**: Includes all discovered applications as a comma-separated string
- **Basic Authentication**: Uses environment variables for secure webhook delivery
- **App Name Filtering**: 
  - Removes all commas from application names
  - Removes "Inc" or "Inc." suffixes (case insensitive)
- **Error Handling**: Webhook failures don't impact the sync process

#### Webhook Payload Format
```json
{
  "org_id": "354c2aae-f32e-44b8-b820-9e393ff6909",
  "tool_name": "RL Task Template, 1001 Fonts, Microsoft, Google LLC, Slack Technologies, Adobe Systems, Zoom Video Communications"
}
```

#### Environment Variables
Set these environment variables for webhook configuration:
- `WEBHOOK_URL` - The webhook endpoint URL (defaults to Railway endpoint if not set)
- `WEBHOOK_USERNAME` - Basic auth username (defaults to 'SF-AI-DB' if not set)  
- `WEBHOOK_PASSWORD` - Basic auth password (defaults to 'SF-AI-DB' if not set)

#### Configuration
- **Default URL**: Railway endpoint with hardcoded path
- **Authentication**: Basic auth using environment variables
- **Test Mode**: Webhook calls are skipped when sync runs in test mode
- **First-Time Detection**: Checks for previous completed syncs to ensure one-time delivery

## Application Categorization

The system uses OpenAI's ChatGPT to automatically categorize applications into the following categories:

- Analytics & Business Intelligence
- Cloud Platforms & Infrastructure
- Customer Success & Support
- Design & Creative Tools
- Developer & Engineering Tools
- Finance & Accounting
- Human Resources & People Management
- IT Operations & Security
- Identity & Access Management
- Productivity & Collaboration
- Project Management
- Sales & Marketing
- Others

The categorization happens automatically during the background sync process when applications are discovered or updated. If the OpenAI API key is not provided, the system falls back to a rule-based categorization using keyword matching.

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env.local` and fill in the required values
3. Install dependencies: `npm install`
4. Run the development server: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Environment Variables

See `.env.example` for required environment variables. For application categorization, you'll need:

```
# OpenAI API (for categorizing applications)
OPENAI_API_KEY=your-openai-api-key
```

## Background Tasks

The system uses background tasks to:

1. Fetch users from Google Workspace
2. Fetch application tokens and permissions
3. Categorize applications using ChatGPT
4. Create relationships between users and applications

These tasks run automatically during the sync process. 