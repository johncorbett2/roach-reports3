import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  Modal,
  Pressable,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { buildingsApi, API_URL } from '@/services/api';
import { Building, Report } from '@/types';

export default function BuildingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [building, setBuilding] = useState<Building | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streetViewError, setStreetViewError] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dy, dx }) => Math.abs(dy) > Math.abs(dx) && dy > 5,
      onPanResponderMove: (_, { dy }) => { if (dy > 0) translateY.setValue(dy); },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 120 || vy > 1.2) {
          Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(
            () => setSelectedImage(null)
          );
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  useEffect(() => { translateY.setValue(0); }, [selectedImage]);

  useEffect(() => {
    if (id) {
      loadBuilding();
    }
  }, [id]);

  const loadBuilding = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await buildingsApi.getById(id!);
      setBuilding(data);
    } catch (err) {
      setError('Failed to load building details');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const getDisplayDate = (report: Report) => report.report_date || report.created_at;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  const getSeverityLabel = (severity: number) => {
    const labels = ['', 'Minimal', 'Low', 'Moderate', 'High', 'Severe'];
    return labels[severity] || '';
  };

  const getSeverityColor = (severity: number) => {
    const colors = ['', '#27ae60', '#f1c40f', '#e67e22', '#e74c3c', '#8e44ad'];
    return colors[severity] || '#999';
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#AE6E4E" />
      </View>
    );
  }

  if (error || !building) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || 'Building not found'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadBuilding}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const reports = building.reports || [];
  const stats = building.stats;

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerBackTitle: 'Back',
        }}
      />
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.address}>{building.address}</Text>
          <Text style={styles.location}>
            {building.city}, {building.state} {building.zip}
          </Text>
        </View>

        {!streetViewError && (
          <Image
            source={{ uri: `${API_URL}/buildings/${building.id}/street-view` }}
            style={styles.streetViewImage}
            onError={() => setStreetViewError(true)}
          />
        )}

        {stats && (
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalReports}</Text>
              <Text style={styles.statLabel}>Total Reports</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: stats.percentPositive > 0 ? '#e74c3c' : '#27ae60' }]}>
                {stats.percentPositive}%
              </Text>
              <Text style={styles.statLabel}>With Roaches</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {stats.avgSeverity > 0 ? stats.avgSeverity.toFixed(1) : '-'}
              </Text>
              <Text style={styles.statLabel}>Avg Severity</Text>
            </View>
          </View>
        )}

        <View style={styles.reportsSection}>
          <Text style={styles.sectionTitle}>
            Reports ({reports.length})
          </Text>

          {reports.length === 0 ? (
            <View style={styles.noReportsContainer}>
              <Text style={styles.noReportsText}>No reports yet for this building</Text>
              <Text style={styles.noReportsSubtext}>
                Be the first to share your experience!
              </Text>
            </View>
          ) : (
            reports
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((report) => (
                <ReportCard key={report.id} report={report} />
              ))
          )}
        </View>
      </ScrollView>

      <Modal visible={!!selectedImage} transparent animationType="fade" onRequestClose={() => setSelectedImage(null)}>
        <Pressable style={styles.imageModalBackdrop} onPress={() => setSelectedImage(null)}>
          <Animated.View
            style={[styles.imageModalContent, { transform: [{ translateY }] }]}
            {...panResponder.panHandlers}
          >
            <Pressable style={styles.imageModalClose} onPress={() => setSelectedImage(null)}>
              <Text style={styles.imageModalCloseText}>✕</Text>
            </Pressable>
            {selectedImage && (
              <Image
                source={{ uri: selectedImage }}
                style={styles.imageModalImage}
                resizeMode="contain"
              />
            )}
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );

  function ReportCard({ report }: { report: Report }) {
    const [expanded, setExpanded] = useState(false);
    const images = report.report_images || [];

    return (
      <TouchableOpacity
        style={styles.reportCard}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.reportHeader}>
          <View style={styles.reportMeta}>
            <View
              style={[
                styles.roachIndicator,
                { backgroundColor: report.has_roaches ? '#e74c3c' : '#27ae60' },
              ]}
            />
            <Text style={styles.reportStatus}>
              {report.has_roaches ? 'Roaches reported' : 'No roaches'}
            </Text>
          </View>
          <Text style={styles.reportDate}>{getRelativeTime(getDisplayDate(report))}</Text>
        </View>

        {report.unit_number && (
          <Text style={styles.unitNumber}>Unit {report.unit_number}</Text>
        )}

        {report.has_roaches && report.severity && (
          <View style={styles.severityContainer}>
            <Text style={styles.severityLabel}>Severity: </Text>
            <View
              style={[
                styles.severityBadge,
                { backgroundColor: getSeverityColor(report.severity) },
              ]}
            >
              <Text style={styles.severityBadgeText}>
                {report.severity}/5 - {getSeverityLabel(report.severity)}
              </Text>
            </View>
          </View>
        )}

        {report.notes && (
          <Text
            style={styles.reportNotes}
            numberOfLines={expanded ? undefined : 2}
          >
            {report.notes}
          </Text>
        )}

        {images.length > 0 && (
          <View style={styles.imagesContainer}>
            {images.slice(0, expanded ? images.length : 2).map((img) => (
              <TouchableOpacity key={img.id} onPress={() => setSelectedImage(img.image_url)} activeOpacity={0.8}>
                <Image
                  source={{ uri: img.image_url }}
                  style={styles.reportImage}
                />
              </TouchableOpacity>
            ))}
            {!expanded && images.length > 2 && (
              <View style={styles.moreImagesOverlay}>
                <Text style={styles.moreImagesText}>+{images.length - 2}</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.reportTimestamp}>{formatDate(getDisplayDate(report))}</Text>
      </TouchableOpacity>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  streetViewImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#e5e5e5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#e74c3c',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#AE6E4E',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#C7AD7F',
  },
  address: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  location: {
    fontSize: 16,
    color: '#A57A5A',
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#C7AD7F',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#C7AD7F',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    color: '#A57A5A',
    marginTop: 4,
  },
  reportsSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
  },
  noReportsContainer: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: '#F5F5DD',
    borderRadius: 12,
  },
  noReportsText: {
    fontSize: 16,
    fontWeight: '600',
  },
  noReportsSubtext: {
    fontSize: 14,
    color: '#A57A5A',
    marginTop: 8,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  reportMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  roachIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  reportStatus: {
    fontSize: 14,
    fontWeight: '600',
  },
  reportDate: {
    fontSize: 12,
    color: '#A57A5A',
  },
  unitNumber: {
    fontSize: 14,
    color: '#A57A5A',
    marginBottom: 8,
  },
  severityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  severityLabel: {
    fontSize: 14,
    color: '#A57A5A',
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  severityBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  reportNotes: {
    fontSize: 14,
    color: '#8B4411',
    lineHeight: 20,
    marginTop: 8,
  },
  imagesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  reportImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  moreImagesOverlay: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreImagesText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  reportTimestamp: {
    fontSize: 12,
    color: '#C7AD7F',
    marginTop: 12,
    textAlign: 'right',
  },
  imageModalBackdrop: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  imageModalContent: {
    flex: 1,
    justifyContent: 'center',
  },
  imageModalClose: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 10,
    padding: 24,
  },
  imageModalCloseText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
  },
  imageModalImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
});
