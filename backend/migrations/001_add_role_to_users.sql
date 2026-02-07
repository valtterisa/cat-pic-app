-- Migration: Add role field to users table
-- Date: 2026-02-07
-- Description: Adds RBAC support by adding a role field to the users table

-- Add role column to users table with default value 'user'
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Update any existing users to have 'user' role (if they don't already have one)
UPDATE users SET role = 'user' WHERE role IS NULL OR role = '';

-- Optional: Create an admin user (uncomment if needed)
-- UPDATE users SET role = 'admin' WHERE email = 'your-admin-email@example.com';
