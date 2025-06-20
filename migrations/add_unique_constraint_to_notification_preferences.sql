-- Add a unique constraint to the notification_preferences table
-- This ensures that each user has only one set of notification preferences per organization
ALTER TABLE shadow_it.notification_preferences
ADD CONSTRAINT unique_user_org_notification_preferences UNIQUE (user_email, organization_id); 