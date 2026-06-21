import React, { useState, useRef, useCallback } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  View as RNView,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import { placesApi } from '@/services/api';
import { PlacePrediction, ValidatedAddress } from '@/types';

interface AddressAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  onAddressValidated: (address: ValidatedAddress | null) => void;
  placeholder?: string;
  recentSearches?: string[];
  onRecentSearchSelect?: (query: string) => void;
}

export default function AddressAutocomplete({
  value,
  onChangeText,
  onAddressValidated,
  placeholder = '123 Main St, New York, NY 10001',
  recentSearches = [],
  onRecentSearchSelect,
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const sessionTokenRef = useRef<string>(generateSessionToken());
  const containerRef = useRef<RNView>(null);

  function generateSessionToken(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  const openDropdown = useCallback(() => {
    containerRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
      setDropdownPos({ top: pageY + height, left: pageX, width });
      setShowDropdown(true);
    });
  }, []);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setPredictions([]);
  }, []);

  const fetchPredictions = useCallback(async (input: string) => {
    if (input.length < 2) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }
    setIsLoading(true);
    try {
      const results = await placesApi.autocomplete(input, sessionTokenRef.current);
      setPredictions(results);
      if (results.length > 0) {
        openDropdown();
      } else {
        setShowDropdown(false);
      }
    } catch (error) {
      console.error('Autocomplete error:', error);
      setPredictions([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  }, [openDropdown]);

  const handleTextChange = (text: string) => {
    onChangeText(text);
    onAddressValidated(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.length === 0) {
      setPredictions([]);
      if (recentSearches.length > 0) {
        openDropdown();
      } else {
        setShowDropdown(false);
      }
      return;
    }

    setShowDropdown(false);
    debounceRef.current = setTimeout(() => fetchPredictions(text), 500);
  };

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    closeDropdown();
    Keyboard.dismiss();
    onChangeText(prediction.description);
    setIsFetchingDetails(true);
    try {
      const details = await placesApi.getDetails(prediction.place_id, sessionTokenRef.current);
      onAddressValidated(details);
      sessionTokenRef.current = generateSessionToken();
    } catch (error) {
      console.error('Failed to get place details:', error);
      onAddressValidated(null);
    } finally {
      setIsFetchingDetails(false);
    }
  };

  const handleSelectRecent = (query: string) => {
    closeDropdown();
    Keyboard.dismiss();
    onChangeText(query);
    onRecentSearchSelect?.(query);
  };

  const showRecents = value.length === 0 && recentSearches.length > 0 && predictions.length === 0;

  const renderPrediction = ({ item }: { item: PlacePrediction }) => (
    <TouchableOpacity style={styles.predictionItem} onPress={() => handleSelectPrediction(item)}>
      <Text style={styles.predictionMain}>{item.structured_formatting.main_text}</Text>
      <Text style={styles.predictionSecondary}>{item.structured_formatting.secondary_text}</Text>
    </TouchableOpacity>
  );

  const renderRecentItem = ({ item }: { item: string }) => (
    <TouchableOpacity style={styles.predictionItem} onPress={() => handleSelectRecent(item)}>
      <RNView style={styles.recentRow}>
        <FontAwesome name="clock-o" size={13} color="#C7AD7F" style={styles.recentIcon} />
        <Text style={styles.predictionMain}>{item}</Text>
      </RNView>
    </TouchableOpacity>
  );

  return (
    <RNView ref={containerRef} style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={handleTextChange}
          placeholder={placeholder}
          placeholderTextColor="#C7AD7F"
          onFocus={() => {
            if (value.length === 0 && recentSearches.length > 0) {
              openDropdown();
            } else if (predictions.length > 0) {
              openDropdown();
            }
          }}
        />
        {(isLoading || isFetchingDetails) && (
          <ActivityIndicator style={styles.loader} size="small" color="#666" />
        )}
      </View>

      {showDropdown && (
        <Modal transparent visible={true} animationType="none" onRequestClose={closeDropdown}>
          {/* Full-screen backdrop: tapping anywhere outside the dropdown closes it */}
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDropdown} />
          <RNView style={[styles.dropdown, { top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }]}>
            {showRecents ? (
              <>
                <Text style={styles.recentHeader}>Recent</Text>
                <FlatList
                  data={recentSearches}
                  renderItem={renderRecentItem}
                  keyExtractor={(_item, index) => `recent-${index}`}
                  keyboardShouldPersistTaps="handled"
                  scrollEnabled={false}
                />
              </>
            ) : (
              <FlatList
                data={predictions}
                renderItem={renderPrediction}
                keyExtractor={(item) => item.place_id}
                keyboardShouldPersistTaps="handled"
                scrollEnabled={false}
              />
            )}
          </RNView>
        </Modal>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 1000,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#C7AD7F',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: '#8B4411',
  },
  loader: {
    position: 'absolute',
    right: 12,
  },
  dropdown: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7AD7F',
    borderRadius: 12,
    maxHeight: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 10,
  },
  predictionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5DD',
  },
  predictionMain: {
    fontSize: 15,
    fontWeight: '500',
    color: '#8B4411',
  },
  predictionSecondary: {
    fontSize: 13,
    color: '#A57A5A',
    marginTop: 2,
  },
  recentHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: '#C7AD7F',
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentIcon: {
    marginRight: 8,
  },
});
