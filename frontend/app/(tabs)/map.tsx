import React, { useEffect, useState, useRef } from 'react';
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

  useEffect(() => {
    initializeLocation();
  }, []);

  useEffect(() => {
    loadBuildingsInRegion();
  }, [region]);

  const initializeLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Showing NYC by default.');
        setIsLoading(false);
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
    } catch (error) {
      console.error('Failed to get location:', error);
      setLocationError('Could not get your location. Showing NYC by default.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadBuildingsInRegion = async () => {
    try {
      const radius = Math.max(
        region.latitudeDelta * 111000,
        region.longitudeDelta * 111000 * Math.cos(region.latitude * Math.PI / 180)
      );

      const data = await buildingsApi.getNearby(
        region.latitude,
        region.longitude,
        radius
      );
      setBuildings(data);
    } catch (error) {
      console.error('Failed to load buildings:', error);
    }
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
    setSelectedBuilding(null);
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
    const reports = building.reports || [];
    if (reports.length === 0) return '#999';

    const recentReports = reports.filter((r) => {
      const reportDate = new Date(r.created_at);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return reportDate > sixMonthsAgo && r.has_roaches;
    });

    if (recentReports.length > 0) return '#e74c3c';
    const anyPositive = reports.some((r) => r.has_roaches);
    if (anyPositive) return '#f39c12';
    return '#27ae60';
  };

  const getReportSummary = (building: Building) => {
    const reports = building.reports || [];
    const total = reports.length;
    const positive = reports.filter((r) => r.has_roaches).length;

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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2f95dc" />
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
        {buildings
          .filter((b) => b.latitude && b.longitude)
          .map((building) => (
            <Marker
              key={building.id}
              coordinate={{
                latitude: building.latitude!,
                longitude: building.longitude!,
              }}
              pinColor={getMarkerColor(building)}
              onPress={() => handleMarkerPress(building)}
            />
          ))}
      </MapView>

      {locationError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{locationError}</Text>
        </View>
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
  locationButton: {
    position: 'absolute',
    top: 60,
    right: 10,
    backgroundColor: '#fff',
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
    color: '#2f95dc',
    fontWeight: '600',
  },
  legend: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
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
    color: '#333',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
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
    backgroundColor: '#ddd',
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
    color: '#666',
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
    color: '#444',
  },
  tapToView: {
    fontSize: 12,
    color: '#2f95dc',
    marginTop: 12,
    textAlign: 'center',
  },
});
