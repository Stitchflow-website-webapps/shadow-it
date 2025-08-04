# Shadow IT Scanner

A comprehensive tool for scanning and managing shadow IT applications within organizations.

## Features

### Domain Mapping for Non-Shadow IT Organizations

The system now supports automatic domain mapping between the `organize-app-inbox` schema and the shadow IT schema. When a user signs up for the first time:

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
  "tool_name": "RL Task Template, 1001 Fonts, 10416621583336-st7941eStsm9c43jbldqvbem4ad0c64.apps.googleusercontent.com, 1045500800636.apps.googleusercontent.com, 10Web, 123cards, 1757127470701-2vd180drt0ej6w9.apps.googleusercontent.com, 1811 Labs, 192.com, isaacs.co, 222247420410-nt2713ctqchbprtvvpt8cu4q40latno8.apps.googleusercontent.com, 243672_ModelA, 253788 - Delete rows, 253788 - Delete rows App Script, 26448307912B-7e3pgk40lj36rdh2ed9pchmi+470001.apps.googleusercontent.com"
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

## Getting Started

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