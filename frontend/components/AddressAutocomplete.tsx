import React, { useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { placesApi } from '@/services/api';
import { PlacePrediction, ValidatedAddress } from '@/types';

interface AddressAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  onAddressValidated: (address: ValidatedAddress | null) => void;
  placeholder?: string;
}

export default function AddressAutocomplete({
  value,
  onChangeText,
  onAddressValidated,
  placeholder = '123 Main St, New York, NY 10001',
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isValidated, setIsValidated] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const sessionTokenRef = useRef<string>(generateSessionToken());

  function generateSessionToken(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

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
      setShowDropdown(results.length > 0);
    } catch (error) {
      console.error('Autocomplete error:', error);
      setPredictions([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleTextChange = (text: string) => {
    onChangeText(text);
    setIsValidated(false);
    onAddressValidated(null);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchPredictions(text);
    }, 500);
  };

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    setShowDropdown(false);
    setPredictions([]);
    onChangeText(prediction.description);
    setIsFetchingDetails(true);

    try {
      const details = await placesApi.getDetails(
        prediction.place_id,
        sessionTokenRef.current
      );
      setIsValidated(true);
      onAddressValidated(details);
      // Generate new session token for next search
      sessionTokenRef.current = generateSessionToken();
    } catch (error) {
      console.error('Failed to get place details:', error);
      setIsValidated(false);
      onAddressValidated(null);
    } finally {
      setIsFetchingDetails(false);
    }
  };

  const renderPrediction = ({ item }: { item: PlacePrediction }) => (
    <TouchableOpacity
      style={styles.predictionItem}
      onPress={() => handleSelectPrediction(item)}
    >
      <Text style={styles.predictionMain}>
        {item.structured_formatting.main_text}
      </Text>
      <Text style={styles.predictionSecondary}>
        {item.structured_formatting.secondary_text}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, isValidated && styles.inputValidated]}
          value={value}
          onChangeText={handleTextChange}
          placeholder={placeholder}
          placeholderTextColor="#999"
          onFocus={() => {
            if (predictions.length > 0) {
              setShowDropdown(true);
            }
          }}
        />
        {(isLoading || isFetchingDetails) && (
          <ActivityIndicator style={styles.loader} size="small" color="#666" />
        )}
        {isValidated && !isLoading && !isFetchingDetails && (
          <View style={styles.checkmark}>
            <Text style={styles.checkmarkText}>✓</Text>
          </View>
        )}
      </View>
      {showDropdown && predictions.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={predictions}
            renderItem={renderPrediction}
            keyExtractor={(item) => item.place_id}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={false}
          />
        </View>
      )}
      {isValidated && (
        <Text style={styles.validatedHint}>Address verified</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 1000,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  inputValidated: {
    borderColor: '#27ae60',
  },
  loader: {
    position: 'absolute',
    right: 12,
  },
  checkmark: {
    position: 'absolute',
    right: 12,
    backgroundColor: '#27ae60',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  predictionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  predictionMain: {
    fontSize: 15,
    fontWeight: '500',
  },
  predictionSecondary: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  validatedHint: {
    fontSize: 12,
    color: '#27ae60',
    marginTop: 4,
  },
});
