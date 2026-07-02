import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import { buildingsApi, neighborhoodsApi } from '@/services/api';
import { Building, Neighborhood } from '@/types';

export default function NeighborhoodScreen() {
  const { code, name, borough, density, area_sq_miles } = useLocalSearchParams<{
    code: string;
    name: string;
    borough: string;
    density: string;
    area_sq_miles: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (code) {
      buildingsApi.searchByNeighborhood(code)
        .then(data => {
          // Sort by most recent report, then by report count descending
          const sorted = data.sort((a, b) => {
            const aCount = (a.reports || []).filter(r => r.has_roaches).length;
            const bCount = (b.reports || []).filter(r => r.has_roaches).length;
            return bCount - aCount;
          });
          setBuildings(sorted);
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [code]);

  const getStatusColor = (building: Building) => {
    const reports = building.reports || [];
    if (reports.length === 0) return '#999';
    const recentCutoff = new Date();
    recentCutoff.setMonth(recentCutoff.getMonth() - 6);
    const hasRecent = reports.some(r =>
      r.has_roaches && new Date(r.report_date || r.created_at).getTime() > recentCutoff.getTime()
    );
    if (hasRecent) return '#e74c3c';
    if (reports.some(r => r.has_roaches)) return '#f39c12';
    return '#27ae60';
  };

  const getReportSummary = (building: Building) => {
    const reports = building.reports || [];
    const positive = reports.filter(r => r.has_roaches).length;
    if (reports.length === 0) return 'No reports';
    return `${positive}/${reports.length} with roaches`;
  };

  const densityNum = density ? parseFloat(density) : null;
  const densityColor = !densityNum ? '#999'
    : densityNum > 30 ? '#e74c3c'
    : densityNum > 10 ? '#f39c12'
    : '#27ae60';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <FontAwesome name="chevron-left" size={16} color="#8B4411" />
          </TouchableOpacity>
          <View style={styles.titleBlock}>
            <Text style={styles.neighborhoodName}>{name}</Text>
            <Text style={styles.boroughName}>{borough}</Text>
          </View>
        </View>

        <View style={styles.statsBanner}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: densityColor }]}>
              {densityNum != null ? densityNum.toFixed(1) : '—'}
            </Text>
            <Text style={styles.statLabel}>reports/sq mi</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{buildings.length}</Text>
            <Text style={styles.statLabel}>buildings</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {area_sq_miles ? parseFloat(area_sq_miles).toFixed(2) : '—'}
            </Text>
            <Text style={styles.statLabel}>sq miles</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#AE6E4E" />
          </View>
        ) : buildings.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No buildings on record in this neighborhood yet.</Text>
          </View>
        ) : (
          <FlatList
            data={buildings}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.buildingItem}
                onPress={() => router.push(`/building/${item.id}`)}
              >
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(item) }]} />
                <View style={styles.buildingInfo}>
                  <Text style={styles.buildingAddress}>{item.address}</Text>
                  <Text style={styles.reportSummary}>{getReportSummary(item)}</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color="#C7AD7F" />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0C8A8',
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  titleBlock: {
    flex: 1,
  },
  neighborhoodName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#3D1F0D',
  },
  boroughName: {
    fontSize: 14,
    color: '#A57A5A',
    marginTop: 2,
  },
  statsBanner: {
    flexDirection: 'row',
    backgroundColor: '#FDF6EC',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0C8A8',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#3D1F0D',
  },
  statLabel: {
    fontSize: 11,
    color: '#A57A5A',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statDivider: {
    width: 1,
    backgroundColor: '#E0C8A8',
    marginVertical: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 15,
    color: '#A57A5A',
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
  },
  buildingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  buildingInfo: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  buildingAddress: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3D1F0D',
  },
  reportSummary: {
    fontSize: 13,
    color: '#A57A5A',
    marginTop: 2,
  },
});
