-- Migration 001: Add fields to support third-party data ingestion
-- Run this in your Supabase SQL Editor against an existing database.
-- (These columns are already included in schema.sql for fresh installs.)

-- Add ingestion tracking columns to reports
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_date timestamptz;

-- Add NYC building identifier columns to buildings
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS bbl text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS bin text;

-- Prevent re-importing the same HPD violation or 311 complaint on incremental runs
CREATE UNIQUE INDEX IF NOT EXISTS reports_external_source_idx
  ON reports(source, external_id)
  WHERE external_id IS NOT NULL;

-- Speed up BBL lookups during ingestion deduplication
CREATE INDEX IF NOT EXISTS idx_buildings_bbl
  ON buildings(bbl)
  WHERE bbl IS NOT NULL;
