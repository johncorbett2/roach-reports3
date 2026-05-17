import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { useShareExtensionContext } from 'expo-share-extension';

export default function ShareExtension() {
  const { url, text, close } = useShareExtensionContext();

  useEffect(() => {
    // StreetEasy may share as a URL or as text like "Check out this home… https://streeteasy.com/..."
    const raw = url || text || '';
    const match = raw.match(/https?:\/\/[^\s]*streeteasy\.com[^\s]*/);
    const listingUrl = match ? match[0] : null;

    if (listingUrl) {
      Linking.openURL(
        `roachreports://check-listing?url=${encodeURIComponent(listingUrl)}`
      ).catch(() => close());
    } else {
      close();
    }
  }, [url, text]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#AE6E4E" />
      <Text style={styles.text} allowFontScaling={false}>
        Opening Roach Reports…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FDF6EC',
  },
  text: {
    marginTop: 12,
    fontSize: 16,
    color: '#8B4411',
    fontWeight: '500',
  },
});
