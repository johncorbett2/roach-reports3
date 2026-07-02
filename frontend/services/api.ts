import {
  Building,
  Neighborhood,
  Report,
  ReportImage,
  CreateReportInput,
  CreateBuildingInput,
  PaginatedResponse,
  PlacePrediction,
  ValidatedAddress,
} from '@/types';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

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

  searchByNeighborhood: async (neighborhoodCode: string): Promise<Building[]> => {
    return request<Building[]>(`/buildings/search?neighborhood_code=${encodeURIComponent(neighborhoodCode)}`);
  },

  getById: async (id: string): Promise<Building> => {
    return request<Building>(`/buildings/${id}`);
  },

  getNearby: async (
    lat: number,
    lng: number,
    radius: number = 1000,
    neighborhoodCode?: string
  ): Promise<Building[]> => {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius: String(radius),
    });
    if (neighborhoodCode) params.append('neighborhood_code', neighborhoodCode);
    return request<Building[]>(`/buildings/nearby?${params}`);
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

// Places API
export const placesApi = {
  autocomplete: async (
    input: string,
    sessionToken?: string
  ): Promise<PlacePrediction[]> => {
    const params = new URLSearchParams({ input });
    if (sessionToken) {
      params.append('sessiontoken', sessionToken);
    }
    const response = await request<{ predictions: PlacePrediction[] }>(
      `/places/autocomplete?${params}`
    );
    return response.predictions;
  },

  getDetails: async (
    placeId: string,
    sessionToken?: string
  ): Promise<ValidatedAddress> => {
    const params = new URLSearchParams({ place_id: placeId });
    if (sessionToken) {
      params.append('sessiontoken', sessionToken);
    }
    return request<ValidatedAddress>(`/places/details?${params}`);
  },
};

// Neighborhoods API
export const neighborhoodsApi = {
  getAll: async (): Promise<Neighborhood[]> => {
    return request<Neighborhood[]>('/neighborhoods');
  },
};

// Stats API
export const statsApi = {
  get: async (): Promise<{ buildings_with_roaches: number }> => {
    return request<{ buildings_with_roaches: number }>('/stats');
  },
};

// Listings API
export const listingsApi = {
  extractFromUrl: async (url: string): Promise<{ extracted_address: string; building: Building | null }> => {
    return request('/listings/extract', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },
};

export { ApiError };
