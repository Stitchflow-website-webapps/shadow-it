-- Create org_apps table to track which apps are used by which organizations
CREATE TABLE "AI-database-shadow-it".org_apps (
    id SERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    app_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign key constraint to ai_risk_scores table
    CONSTRAINT fk_org_apps_app_id 
        FOREIGN KEY (app_id) 
        REFERENCES "AI-database-shadow-it".ai_risk_scores(app_id)
        ON DELETE CASCADE,
    
    -- Unique constraint to prevent duplicate org-app combinations
    CONSTRAINT unique_org_app 
        UNIQUE (org_id, app_id)
) TABLESPACE pg_default;

-- Create indexes for better query performance
CREATE INDEX idx_org_apps_org_id ON "AI-database-shadow-it".org_apps(org_id);
CREATE INDEX idx_org_apps_app_id ON "AI-database-shadow-it".org_apps(app_id);

-- Optional: Create a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_org_apps_updated_at 
    BEFORE UPDATE ON "AI-database-shadow-it".org_apps 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();