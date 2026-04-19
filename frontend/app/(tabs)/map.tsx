import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import MapView, { Marker, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { buildingsApi } from '@/services/api';
import { Building } from '@/types';

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.01;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;

function isWithinCache(
  region: Region,
  cache: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null
): boolean {
  if (!cache) return false;
  const halfLat = region.latitudeDelta / 2;
  const halfLng = region.longitudeDelta / 2;
  const vMinLat = region.latitude - halfLat;
  const vMaxLat = region.latitude + halfLat;
  const vMinLng = region.longitude - halfLng;
  const vMaxLng = region.longitude + halfLng;
  const overlapLat = Math.min(vMaxLat, cache.maxLat) - Math.max(vMinLat, cache.minLat);
  const overlapLng = Math.min(vMaxLng, cache.maxLng) - Math.max(vMinLng, cache.minLng);
  const viewportArea = region.latitudeDelta * region.longitudeDelta;
  const overlapArea = Math.max(0, overlapLat) * Math.max(0, overlapLng);
  return overlapArea / viewportArea > 0.70;
}

// NYC default location
const NYC_CENTER = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05 * ASPECT_RATIO,
};

export default function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(NYC_CENTER);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const [hasMoved, setHasMoved] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const cachedBoundsRef = useRef<{
    minLat: number; maxLat: number; minLng: number; maxLng: number;
  } | null>(null);

  useEffect(() => {
    initializeLocation();
  }, []);

  const initializeLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Showing NYC by default.');
        loadBuildingsInRegion(NYC_CENTER);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA,
      };
      setRegion(newRegion);
      loadBuildingsInRegion(newRegion);
    } catch (error) {
      console.error('Failed to get location:', error);
      setLocationError('Could not get your location. Showing NYC by default.');
      loadBuildingsInRegion(NYC_CENTER);
    } finally {
      setIsLoading(false);
    }
  };

  const loadBuildingsInRegion = async (targetRegion: Region) => {
    if (isWithinCache(targetRegion, cachedBoundsRef.current)) return;

    const requestId = ++requestIdRef.current;
    setIsSearching(true);
    try {
      const radius = Math.max(
        targetRegion.latitudeDelta * 111000,
        targetRegion.longitudeDelta * 111000 * Math.cos(targetRegion.latitude * Math.PI / 180)
      );

      const data = await buildingsApi.getNearby(
        targetRegion.latitude,
        targetRegion.longitude,
        radius
      );
      if (requestId === requestIdRef.current) {
        setBuildings(data);
        cachedBoundsRef.current = {
          minLat: targetRegion.latitude - targetRegion.latitudeDelta,
          maxLat: targetRegion.latitude + targetRegion.latitudeDelta,
          minLng: targetRegion.longitude - targetRegion.longitudeDelta,
          maxLng: targetRegion.longitude + targetRegion.longitudeDelta,
        };
      }
    } catch (error) {
      console.error('Failed to load buildings:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
    setSelectedBuilding(null);
    setHasMoved(true);
  };

  const handleMarkerPress = (building: Building) => {
    setSelectedBuilding(building);
  };

  const handleBuildingPress = () => {
    if (selectedBuilding) {
      router.push(`/building/${selectedBuilding.id}`);
    }
  };

  const getMarkerColor = (building: Building) => {
    if (building.marker_status) {
      if (building.marker_status === 'recent_roach') return '#e74c3c';
      if (building.marker_status === 'older_roach') return '#f39c12';
      if (building.marker_status === 'no_roach') return '#27ae60';
      return '#999';
    }
    return '#999';
  };

  const getReportSummary = (building: Building) => {
    const total = building.report_count ?? 0;
    const positive = building.positive_count ?? 0;

    if (total === 0) return 'No reports yet';
    if (positive === 0) return `${total} report${total > 1 ? 's' : ''} - No roaches`;
    return `${positive}/${total} reports with roaches`;
  };

  const centerOnLocation = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({});
      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA,
      };
      mapRef.current?.animateToRegion(newRegion, 500);
    } catch (error) {
      console.error('Failed to get location:', error);
    }
  };

  const markers = useMemo(() =>
    buildings
      .filter((b) => b.latitude && b.longitude)
      .map((building) => {
        const color = getMarkerColor(building);
        const isRoach = color === '#e74c3c';
        return (
          <Marker
            key={building.id}
            coordinate={{
              latitude: building.latitude!,
              longitude: building.longitude!,
            }}
            pinColor={isRoach ? undefined : color}
            anchor={isRoach ? { x: 0.5, y: 0.5 } : undefined}
            onPress={() => handleMarkerPress(building)}
          >
            {isRoach && (
              <Text style={styles.roachMarker}>🪳</Text>
            )}
          </Marker>
        );
      }),
  [buildings]
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#AE6E4E" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {markers}
      </MapView>

      {locationError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{locationError}</Text>
        </View>
      )}

      {hasMoved && (
        <TouchableOpacity
          style={styles.searchAreaButton}
          onPress={() => {
            setHasMoved(false);
            loadBuildingsInRegion(region);
          }}
          disabled={isSearching}
        >
          {isSearching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.searchAreaButtonText}>Search this area</Text>
          }
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.locationButton} onPress={centerOnLocation}>
        <Text style={styles.locationButtonText}>My Location</Text>
      </TouchableOpacity>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#e74c3c' }]} />
          <Text style={styles.legendText}>Recent reports</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#f39c12' }]} />
          <Text style={styles.legendText}>Older reports</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#27ae60' }]} />
          <Text style={styles.legendText}>No roaches</Text>
        </View>
      </View>

      {selectedBuilding && (
        <TouchableOpacity
          style={styles.bottomSheet}
          onPress={handleBuildingPress}
          activeOpacity={0.9}
        >
          <View style={styles.bottomSheetHandle} />
          <Text style={styles.buildingAddress}>{selectedBuilding.address}</Text>
          <Text style={styles.buildingLocation}>
            {selectedBuilding.city}, {selectedBuilding.state}
          </Text>
          <View style={styles.reportInfo}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: getMarkerColor(selectedBuilding) },
              ]}
            />
            <Text style={styles.reportText}>
              {getReportSummary(selectedBuilding)}
            </Text>
          </View>
          <Text style={styles.tapToView}>Tap to view details</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  map: {
    flex: 1,
  },
  errorBanner: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(231, 76, 60, 0.9)',
    padding: 10,
    borderRadius: 8,
  },
  errorText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
  },
  searchAreaButton: {
    position: 'absolute',
    top: 65,
    alignSelf: 'center',
    backgroundColor: '#AE6E4E',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 50,
    alignItems: 'center',
  },
  searchAreaButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  locationButton: {
    position: 'absolute',
    top: 60,
    right: 10,
    backgroundColor: '#8B4411',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  locationButtonText: {
    color: '#F5F5DD',
    fontWeight: '600',
  },
  legend: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    backgroundColor: 'rgba(245, 245, 221, 0.95)',
    padding: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendText: {
    fontSize: 12,
    color: '#8B4411',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#F5F5DD',
    padding: 20,
    paddingBottom: 30,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 10,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#C7AD7F',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  buildingAddress: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  buildingLocation: {
    fontSize: 14,
    color: '#A57A5A',
    marginTop: 4,
  },
  reportInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  reportText: {
    fontSize: 14,
    color: '#8B4411',
  },
  tapToView: {
    fontSize: 12,
    color: '#AE6E4E',
    marginTop: 12,
    textAlign: 'center',
  },
  roachMarker: {
    fontSize: 28,
  },
});
