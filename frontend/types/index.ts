export interface Building {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  reports?: Report[];
  stats?: BuildingStats;
}

export interface BuildingStats {
  totalReports: number;
  positiveReports: number;
  percentPositive: number;
  avgSeverity: number;
}

export interface Report {
  id: string;
  building_id: string;
  unit_number: string | null;
  has_roaches: boolean;
  severity: number | null;
  notes: string | null;
  created_at: string;
  buildings?: Building;
  report_images?: ReportImage[];
}

export interface ReportImage {
  id: string;
  report_id: string;
  image_url: string;
  created_at: string;
}

export interface CreateReportInput {
  building_id?: string;
  address?: string;
  unit_number?: string;
  has_roaches: boolean;
  severity?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
}

export interface CreateBuildingInput {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  address: string;
  hasRecentReports: boolean;
  reportCount: number;
}
