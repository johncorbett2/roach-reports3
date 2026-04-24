import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Text, View } from '@/components/Themed';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { buildingsApi } from '@/services/api';
import { Building, ValidatedAddress } from '@/types';
import { usePostHog } from 'posthog-react-native';
import { Events } from '@/services/analytics';

const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT_SEARCHES = 5;

// Derives a precise DB search query from a Google Places formatted_address.
// For named streets:   "332 Keap Street, Brooklyn, NY"       → "332 Keap"
// For numbered streets: "401 East 34th Street, New York, NY" → "401 East 34"
//   (strips ordinal suffix so "34th" matches HPD-style "34" stored in DB)
function buildSearchQuery(formattedAddress: string): string {
  const streetPart = formattedAddress.split(',')[0];
  const tokens = streetPart.split(' ');
  if (tokens.length < 2) return streetPart;

  const directionals = new Set(['north', 'south', 'east', 'west', 'n', 's', 'e', 'w']);

  let i = 1;
  while (i < tokens.length && directionals.has(tokens[i].toLowerCase())) {
    i++;
  }

  const streetToken = tokens[i] ?? '';
  if (/^\d/.test(streetToken)) {
    const streetNum = streetToken.replace(/(st|nd|rd|th)$/i, '');
    return [...tokens.slice(0, i), streetNum].join(' ');
  }

  return tokens.slice(0, i + 1).join(' ');
}

export default function SearchScreen() {
  const router = useRouter();
  const posthog = usePostHog();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Building[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [validatedAddress, setValidatedAddress] = useState<ValidatedAddress | null>(null);

  useEffect(() => {
    loadRecentSearches();
  }, []);

  const loadRecentSearches = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load recent searches:', error);
    }
  };

  const saveRecentSearch = async (query: string) => {
    try {
      const updated = [
        query,
        ...recentSearches.filter((s) => s.toLowerCase() !== query.toLowerCase()),
      ].slice(0, MAX_RECENT_SEARCHES);
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save recent search:', error);
    }
  };

  const handleSearchByText = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    setIsLoading(true);
    setHasSearched(true);
    try {
      const results = await buildingsApi.search(query);
      setSearchResults(results);
      saveRecentSearch(query);
      posthog?.capture(Events.BUILDING_SEARCHED, { result_count: results.length });
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [recentSearches]);

  const handleAddressValidated = useCallback((address: ValidatedAddress | null) => {
    setValidatedAddress(address);
    if (!address) {
      setSearchResults([]);
      setHasSearched(false);
    }
  }, []);

  const handleBuildingPress = (building: Building) => {
    router.push(`/building/${building.id}`);
  };

  const handleRecentSearchPress = (query: string) => {
    setSearchQuery(query);
    handleSearchByText(query);
  };

  const getReportSummary = (building: Building) => {
    const reports = building.reports || [];
    const total = reports.length;
    const positive = reports.filter((r) => r.has_roaches).length;

    if (total === 0) return 'No reports yet';
    if (positive === 0) return `${total} report${total > 1 ? 's' : ''} - No roaches reported`;
    return `${total} report${total > 1 ? 's' : ''} - ${positive} with roaches`;
  };

  const getStatusColor = (building: Building) => {
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

  const renderBuildingItem = ({ item }: { item: Building }) => (
    <TouchableOpacity
      style={styles.buildingItem}
      onPress={() => handleBuildingPress(item)}
    >
      <View style={[styles.statusDot, { backgroundColor: getStatusColor(item) }]} />
      <View style={styles.buildingInfo}>
        <Text style={styles.buildingAddress}>{item.address}</Text>
        <Text style={styles.buildingLocation}>
          {item.city}, {item.state} {item.zip}
        </Text>
        <Text style={styles.reportSummary}>{getReportSummary(item)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Roach Reports</Text>
        <Text style={styles.subtitle}>Search for a building to see reports</Text>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.autocompleteWrapper}>
          <AddressAutocomplete
            value={searchQuery}
            onChangeText={setSearchQuery}
            onAddressValidated={handleAddressValidated}
            placeholder="Enter an address..."
          />
        </View>
        <TouchableOpacity
          style={styles.searchButton}
          onPress={() => {
            const query = validatedAddress
              ? buildSearchQuery(validatedAddress.formatted_address)
              : searchQuery;
            handleSearchByText(query);
          }}
        >
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#AE6E4E" />
        </View>
      ) : hasSearched ? (
        searchResults.length > 0 ? (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            renderItem={renderBuildingItem}
            style={styles.resultsList}
            contentContainerStyle={styles.resultsContent}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No buildings found</Text>
            <Text style={styles.emptySubtext}>
              Try a different address or be the first to report!
            </Text>
          </View>
        )
      ) : (
        <View style={styles.recentContainer}>
          {recentSearches.length > 0 && (
            <>
              <Text style={styles.recentTitle}>Recent Searches</Text>
              {recentSearches.map((query, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.recentItem}
                  onPress={() => handleRecentSearchPress(query)}
                >
                  <Text style={styles.recentText}>{query}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          <View style={styles.tipContainer}>
            <Text style={styles.tipTitle}>Tips</Text>
            <Text style={styles.tipText}>
              Search by street address to find reports for any building in NYC.
            </Text>
            <Text style={styles.tipText}>
              Status colors: Red = recent reports, Yellow = older reports, Green = no roaches reported.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    color: '#A57A5A',
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    zIndex: 100,
    alignItems: 'flex-start',
  },
  autocompleteWrapper: {
    flex: 1,
  },
  searchButton: {
    backgroundColor: '#AE6E4E',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: '#F5F5DD',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsList: {
    flex: 1,
  },
  resultsContent: {
    padding: 20,
  },
  buildingItem: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
    marginTop: 4,
  },
  buildingInfo: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  buildingAddress: {
    fontSize: 16,
    fontWeight: '600',
  },
  buildingLocation: {
    fontSize: 14,
    color: '#A57A5A',
    marginTop: 2,
  },
  reportSummary: {
    fontSize: 14,
    color: '#A57A5A',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#A57A5A',
    marginTop: 8,
    textAlign: 'center',
  },
  recentContainer: {
    padding: 20,
  },
  recentTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  recentItem: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
  },
  recentText: {
    fontSize: 16,
  },
  tipContainer: {
    marginTop: 30,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#8B4411',
  },
  tipText: {
    fontSize: 14,
    color: '#A57A5A',
    marginBottom: 6,
    lineHeight: 20,
  },
});
