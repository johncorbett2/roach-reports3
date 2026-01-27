-- Roach Reports 3 - Supabase Database Schema
-- Run this in your Supabase SQL Editor

-- Buildings table
CREATE TABLE buildings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  address text NOT NULL,
  city text DEFAULT 'New York',
  state text DEFAULT 'NY',
  zip text,
  latitude decimal,
  longitude decimal,
  created_at timestamp DEFAULT now()
);

-- Reports table
CREATE TABLE reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id uuid REFERENCES buildings(id) ON DELETE CASCADE,
  unit_number text,
  has_roaches boolean NOT NULL,
  severity int CHECK (severity >= 1 AND severity <= 5),
  notes text,
  created_at timestamp DEFAULT now()
);

-- Report images table
CREATE TABLE report_images (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id uuid REFERENCES reports(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Index for address search (full-text search)
CREATE INDEX idx_buildings_address ON buildings USING gin(to_tsvector('english', address));

-- Index for faster building lookups
CREATE INDEX idx_reports_building_id ON reports(building_id);
CREATE INDEX idx_reports_created_at ON reports(created_at DESC);

-- Index for geographic queries
CREATE INDEX idx_buildings_location ON buildings(latitude, longitude);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_images ENABLE ROW LEVEL SECURITY;

-- Allow public read access (for anonymous users)
CREATE POLICY "Allow public read on buildings" ON buildings
  FOR SELECT USING (true);

CREATE POLICY "Allow public read on reports" ON reports
  FOR SELECT USING (true);

CREATE POLICY "Allow public read on report_images" ON report_images
  FOR SELECT USING (true);

-- Allow public insert (for submitting reports)
CREATE POLICY "Allow public insert on buildings" ON buildings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public insert on reports" ON reports
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public insert on report_images" ON report_images
  FOR INSERT WITH CHECK (true);
