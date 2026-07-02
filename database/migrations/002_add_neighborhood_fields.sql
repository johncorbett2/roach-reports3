-- Add neighborhood columns to buildings
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS neighborhood text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS neighborhood_code text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS borough text;

-- Index for neighborhood-filtered queries
CREATE INDEX IF NOT EXISTS idx_buildings_neighborhood_code ON buildings (neighborhood_code);

-- Reference table seeded from NTA 2020 GeoJSON (262 rows, never changes)
CREATE TABLE IF NOT EXISTS neighborhoods (
  code text PRIMARY KEY,
  name text NOT NULL,
  borough text NOT NULL,
  area_sq_miles decimal NOT NULL
);
