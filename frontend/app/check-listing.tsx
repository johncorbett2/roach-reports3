import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { listingsApi } from '@/services/api';

type ScreenState = 'input' | 'loading' | 'not_found' | 'fetch_blocked' | 'error';

function BackButton() {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 8 }}>
      <FontAwesome name="chevron-left" size={18} color="#8B4411" />
    </TouchableOpacity>
  );
}

export default function CheckListingScreen() {
  const router = useRouter();
  const { url: urlParam } = useLocalSearchParams<{ url?: string }>();

  const [urlInput, setUrlInput] = useState(urlParam ?? '');
  const [state, setState] = useState<ScreenState>('input');
  const [extractedAddress, setExtractedAddress] = useState('');
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (urlParam) {
      setUrlInput(urlParam);
      runExtraction(urlParam);
    }
  }, [urlParam]);

  async function runExtraction(url: string) {
    setUrlError('');

    if (!url.trim()) {
      setUrlError('Please enter a StreetEasy listing URL');
      return;
    }

    // Pull the first URL out of the text — handles StreetEasy share text like
    // "Check out this home on StreetEasy https://streeteasy.com/..."
    const urlMatch = url.trim().match(/https?:\/\/[^\s]+/);
    const cleanUrl = urlMatch ? urlMatch[0] : url.trim();

    let parsed: URL;
    try {
      parsed = new URL(cleanUrl);
    } catch {
      setUrlError('That doesn\'t look like a valid URL');
      return;
    }

    if (parsed.hostname !== 'streeteasy.com' && !parsed.hostname.endsWith('.streeteasy.com')) {
      setUrlError('URL must be from streeteasy.com');
      return;
    }

    setState('loading');

    try {
      const result = await listingsApi.extractFromUrl(cleanUrl);
      setExtractedAddress(result.extracted_address);

      if (result.building) {
        router.replace(`/building/${result.building.id}`);
      } else {
        setState('not_found');
      }
    } catch (err: any) {
      if (err?.status === 502) {
        setState('fetch_blocked');
      } else if (err?.status === 422) {
        setState('error');
      } else {
        setState('error');
      }
    }
  }

  function renderContent() {
    if (state === 'loading') {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#AE6E4E" />
          <Text style={styles.loadingText}>Looking up this listing…</Text>
        </View>
      );
    }

    if (state === 'not_found') {
      return (
        <View style={styles.centered}>
          <FontAwesome name="check-circle" size={56} color="#27ae60" style={{ marginBottom: 16 }} />
          <Text style={styles.resultHeadline}>No reports found</Text>
          <Text style={styles.resultBody}>
            We have no roach reports on file for{'\n'}
            <Text style={{ fontWeight: '700' }}>{extractedAddress}</Text>
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() =>
              router.replace({
                pathname: '/(tabs)/report',
                params: { prefill_address: extractedAddress },
              })
            }
          >
            <RNView style={styles.ctaInner}>
              <Text style={styles.ctaText}>Submit a report for this address</Text>
              <FontAwesome name="upload" size={14} color="#F5F5DD" style={{ marginLeft: 8 }} />
            </RNView>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setState('input')}>
            <Text style={styles.secondaryButtonText}>Check another listing</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (state === 'fetch_blocked') {
      return (
        <View style={styles.centered}>
          <FontAwesome name="exclamation-circle" size={56} color="#f39c12" style={{ marginBottom: 16 }} />
          <Text style={styles.resultHeadline}>Couldn't read that listing</Text>
          <Text style={styles.resultBody}>
            StreetEasy blocked our request. Try searching by address instead.
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.replace('/(tabs)/')}
          >
            <Text style={styles.ctaText}>Go to Search</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setState('input')}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (state === 'error') {
      return (
        <View style={styles.centered}>
          <FontAwesome name="exclamation-triangle" size={56} color="#e74c3c" style={{ marginBottom: 16 }} />
          <Text style={styles.resultHeadline}>Something went wrong</Text>
          <Text style={styles.resultBody}>
            We couldn't extract an address from that page. Try searching by address instead.
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.replace('/(tabs)/')}
          >
            <Text style={styles.ctaText}>Go to Search</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setState('input')}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.instructionTitle}>Check a StreetEasy listing</Text>
          <Text style={styles.instructionBody}>
            Paste the URL of a StreetEasy listing to check it for roach reports.
          </Text>
          <TextInput
            style={[styles.input, urlError ? styles.inputError : null]}
            value={urlInput}
            onChangeText={(t) => { setUrlInput(t); setUrlError(''); }}
            placeholder="https://streeteasy.com/rental/..."
            placeholderTextColor="#C4A882"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => runExtraction(urlInput)}
          />
          {urlError ? <Text style={styles.errorText}>{urlError}</Text> : null}
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => runExtraction(urlInput)}
          >
            <Text style={styles.ctaText}>Check this listing</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerLeft: () => <BackButton /> }} />
      {renderContent()}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#FFFFFF',
  },
  instructionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#8B4411',
    marginBottom: 8,
    marginTop: 16,
  },
  instructionBody: {
    fontSize: 15,
    color: '#A57A5A',
    lineHeight: 22,
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0C8A8',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#FAFAFA',
    marginBottom: 6,
  },
  inputError: {
    borderColor: '#e74c3c',
  },
  errorText: {
    fontSize: 13,
    color: '#e74c3c',
    marginBottom: 16,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#A57A5A',
  },
  resultHeadline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#8B4411',
    marginBottom: 12,
    textAlign: 'center',
  },
  resultBody: {
    fontSize: 15,
    color: '#A57A5A',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  ctaButton: {
    backgroundColor: '#AE6E4E',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ctaText: {
    color: '#F5F5DD',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  secondaryButton: {
    marginTop: 14,
    padding: 8,
  },
  secondaryButtonText: {
    color: '#AE6E4E',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
