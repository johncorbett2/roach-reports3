import {
  Building,
  Report,
  ReportImage,
  CreateReportInput,
  CreateBuildingInput,
  PaginatedResponse,
} from '@/types';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(data.error || 'Something went wrong', response.status);
  }

  return data;
}

// Buildings API
export const buildingsApi = {
  search: async (query: string): Promise<Building[]> => {
    return request<Building[]>(`/buildings/search?q=${encodeURIComponent(query)}`);
  },

  getById: async (id: string): Promise<Building> => {
    return request<Building>(`/buildings/${id}`);
  },

  getNearby: async (
    lat: number,
    lng: number,
    radius: number = 1000
  ): Promise<Building[]> => {
    return request<Building[]>(
      `/buildings/nearby?lat=${lat}&lng=${lng}&radius=${radius}`
    );
  },

  create: async (building: CreateBuildingInput): Promise<Building> => {
    return request<Building>('/buildings', {
      method: 'POST',
      body: JSON.stringify(building),
    });
  },
};

// Reports API
export const reportsApi = {
  getAll: async (
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResponse<Report>> => {
    return request<PaginatedResponse<Report>>(
      `/reports?page=${page}&limit=${limit}`
    );
  },

  create: async (report: CreateReportInput): Promise<Report> => {
    return request<Report>('/reports', {
      method: 'POST',
      body: JSON.stringify(report),
    });
  },

  uploadImage: async (
    reportId: string,
    imageUrl: string
  ): Promise<ReportImage> => {
    return request<ReportImage>(`/reports/${reportId}/images`, {
      method: 'POST',
      body: JSON.stringify({ image_url: imageUrl }),
    });
  },
};

export { ApiError };
