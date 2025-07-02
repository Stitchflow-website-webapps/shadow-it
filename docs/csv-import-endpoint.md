# CSV Import Endpoint

This endpoint allows you to import a CSV file with tool names and automatically match them against the `ai_risk_scores` table, then store the matches in the `org_apps` table.

## Endpoint
```
POST /api/applications/import-csv
```

## Headers
- `x-org-id` (required): The organization ID to associate the imported apps with

## Request Body
- Form data with a CSV file using the key `csv`

## CSV Format
The CSV should have a header row with one column containing tool names. The endpoint will automatically detect columns with these names:
- `tool`
- `app` 
- `application`
- `name`

Example CSV:
```csv
Tool Name,Category,Users
Slack,Communication,150
GitHub,Development,80
Figma,Design,45
```

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "CSV processed successfully",
  "results": {
    "totalToolsInCsv": 3,
    "matchedTools": 2,
    "unmatchedTools": 1,
    "insertedRecords": 2
  },
  "details": {
    "matchedTools": ["Slack", "GitHub"],
    "unmatchedTools": ["Figma"]
  }
}
```

### Error Response
```json
{
  "error": "Missing x-org-id header"
}
```

## Usage Examples

### Using curl
```bash
curl -X POST \
  -H "x-org-id: your-org-id-here" \
  -F "csv=@path/to/your/file.csv" \
  http://localhost:3000/api/applications/import-csv
```

### Using JavaScript/Fetch
```javascript
const formData = new FormData();
formData.append('csv', csvFile);

const response = await fetch('/api/applications/import-csv', {
  method: 'POST',
  headers: {
    'x-org-id': 'your-org-id-here'
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

## How It Works

1. **CSV Parsing**: The endpoint reads the uploaded CSV file and automatically detects the column containing tool names
2. **Matching**: It queries the `ai_risk_scores` table to find tools that match the names in your CSV
3. **Storage**: For each match found, it creates a record in the `org_apps` table linking your organization to that application
4. **Deduplication**: The endpoint handles duplicates automatically - if an org-app combination already exists, it won't create a duplicate
5. **Reporting**: It returns detailed information about which tools were matched and which weren't

## Error Handling

The endpoint handles several error scenarios:
- Missing org_id header
- Missing or empty CSV file
- CSV with no detectable tool name column
- Database connection issues
- Invalid CSV format

## Notes

- The matching is case-sensitive and looks for exact matches in the `Tool Name` column of `ai_risk_scores`
- Duplicate org-app combinations are automatically handled via database constraints
- The endpoint will process all valid rows even if some rows have missing data
- Tool names are trimmed of whitespace and quotes during processing
- Uses the "AI-database-shadow-it" schema in Supabase 