import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  Image,
  ActivityIndicator,
  View as RNView,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';

import { Text, View } from '@/components/Themed';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { reportsApi } from '@/services/api';
import { ValidatedAddress } from '@/types';

export default function ReportScreen() {
  const [address, setAddress] = useState('');
  const [validatedAddress, setValidatedAddress] = useState<ValidatedAddress | null>(null);
  const [unitNumber, setUnitNumber] = useState('');
  const [hasRoaches, setHasRoaches] = useState(false);
  const [severity, setSeverity] = useState(3);
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePhotoPress = () => {
    Alert.alert('Add Photo', 'Choose an option', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Gallery', onPress: pickImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImages([...images, result.assets[0].uri]);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your camera.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImages([...images, result.assets[0].uri]);
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!validatedAddress) {
      Alert.alert('Error', 'Please select a valid address from the suggestions.');
      return;
    }

    setIsSubmitting(true);

    try {
      const report = await reportsApi.create({
        address: validatedAddress.formatted_address,
        unit_number: unitNumber.trim() || undefined,
        has_roaches: hasRoaches,
        severity: hasRoaches ? severity : undefined,
        notes: notes.trim() || undefined,
        latitude: validatedAddress.latitude,
        longitude: validatedAddress.longitude,
        city: validatedAddress.city,
        state: validatedAddress.state,
        zip: validatedAddress.zip,
      });

      for (const imageUri of images) {
        await reportsApi.uploadImage(report.id, imageUri);
      }

      Alert.alert(
        'Success',
        'Your report has been submitted. Thank you for helping the community!',
        [{ text: 'OK', onPress: resetForm }]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setAddress('');
    setValidatedAddress(null);
    setUnitNumber('');
    setHasRoaches(false);
    setSeverity(3);
    setNotes('');
    setImages([]);
  };

  return (
    <ScrollView style={styles.scrollView}>
      <View style={styles.container}>

        {/* Building Address */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Building Address <Text style={styles.required}>*</Text>
          </Text>
          <AddressAutocomplete
            value={address}
            onChangeText={setAddress}
            onAddressValidated={setValidatedAddress}
            placeholder="e.g. 123 Main St"
          />
        </View>

        {/* Unit Number */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Unit Number <Text style={styles.labelOptional}>(Optional)</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={unitNumber}
            onChangeText={setUnitNumber}
            placeholder="e.g. 4B"
            placeholderTextColor="#C7C7CC"
          />
        </View>

        {/* Roach Activity Toggle */}
        <View style={styles.toggleCard}>
          <RNView style={styles.toggleContent}>
            <Text style={styles.toggleTitle}>Roach Activity?</Text>
            <Text style={styles.toggleSubtitle}>Have you seen roaches recently?</Text>
          </RNView>
          <Switch
            value={hasRoaches}
            onValueChange={setHasRoaches}
            trackColor={{ false: '#E5E5EA', true: '#3A3A3C' }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Severity (shown when hasRoaches) */}
        {hasRoaches && (
          <View style={styles.field}>
            <Text style={styles.label}>Severity</Text>
            <RNView style={styles.severityContainer}>
              {[1, 2, 3, 4, 5].map((level) => (
                <TouchableOpacity
                  key={level}
                  style={[
                    styles.severityButton,
                    severity === level && styles.severityButtonActive,
                  ]}
                  onPress={() => setSeverity(level)}
                >
                  <Text
                    style={[
                      styles.severityText,
                      severity === level && styles.severityTextActive,
                    ]}
                  >
                    {level}
                  </Text>
                </TouchableOpacity>
              ))}
            </RNView>
            <Text style={styles.severityHint}>
              {severity === 1 && 'Saw one once'}
              {severity === 2 && 'Occasional sightings'}
              {severity === 3 && 'Regular sightings'}
              {severity === 4 && 'Frequent infestations'}
              {severity === 5 && 'Severe infestation'}
            </Text>
          </View>
        )}

        {/* Additional Notes */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Additional Notes <Text style={styles.labelOptional}>(Optional)</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional details about your experience..."
            placeholderTextColor="#C7C7CC"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Add Photo */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Add Photo <Text style={styles.labelOptional}>(Optional)</Text>
          </Text>
          <TouchableOpacity style={styles.photoArea} onPress={handlePhotoPress} activeOpacity={0.7}>
            <FontAwesome name="camera" size={32} color="#C7C7CC" />
            <Text style={styles.photoTitle}>Tap to take photo</Text>
            <Text style={styles.photoSubtitle}>or upload from gallery</Text>
          </TouchableOpacity>
          {images.length > 0 && (
            <RNView style={styles.imagePreviewContainer}>
              {images.map((uri, index) => (
                <RNView key={index} style={styles.imagePreview}>
                  <Image source={{ uri }} style={styles.previewImage} />
                  <TouchableOpacity
                    style={styles.removeImageButton}
                    onPress={() => removeImage(index)}
                  >
                    <Text style={styles.removeImageText}>×</Text>
                  </TouchableOpacity>
                </RNView>
              ))}
            </RNView>
          )}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            (isSubmitting || !validatedAddress) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || !validatedAddress}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <RNView style={styles.submitButtonInner}>
              <FontAwesome name="upload" size={16} color="#fff" style={styles.submitIcon} />
              <Text style={styles.submitButtonText}>Submit Report</Text>
            </RNView>
          )}
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  container: {
    padding: 20,
    paddingBottom: 48,
  },
  field: {
    marginBottom: 20,
    zIndex: 0,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  labelOptional: {
    fontWeight: '400',
    color: '#8E8E93',
  },
  required: {
    color: '#FF3B30',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: '#1C1C1E',
  },
  textArea: {
    height: 100,
  },
  toggleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  toggleContent: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  toggleSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
  },
  severityContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  severityButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  severityButtonActive: {
    borderColor: '#1C1C1E',
    backgroundColor: '#1C1C1E',
  },
  severityText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#8E8E93',
  },
  severityTextActive: {
    color: '#FFFFFF',
  },
  severityHint: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 8,
    textAlign: 'center',
  },
  photoArea: {
    borderWidth: 1.5,
    borderColor: '#C7C7CC',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  photoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginTop: 12,
  },
  photoSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  imagePreviewContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  imagePreview: {
    position: 'relative',
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#8E8E93',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeImageText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    lineHeight: 20,
  },
  submitButton: {
    backgroundColor: '#1C1C1E',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  submitButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  submitIcon: {
    marginRight: 8,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});
