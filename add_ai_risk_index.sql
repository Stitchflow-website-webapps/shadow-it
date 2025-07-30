-- Add index for Tool Name column in ai_risk_scores table for faster lookups
-- This will dramatically improve performance when matching application names with AI risk data

-- Create case-insensitive index on Tool Name column
CREATE INDEX IF NOT EXISTS idx_ai_risk_scores_tool_name_lower 
ON ai_risk_scores (LOWER("Tool Name"));

-- Optional: Create a regular index as well for exact matches
CREATE INDEX IF NOT EXISTS idx_ai_risk_scores_tool_name 
ON ai_risk_scores ("Tool Name");

-- Add comment to explain the purpose
COMMENT ON INDEX idx_ai_risk_scores_tool_name_lower IS 'Case-insensitive index for faster application name matching in AI risk calculations';
COMMENT ON INDEX idx_ai_risk_scores_tool_name IS 'Exact match index for Tool Name column'; 