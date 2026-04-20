import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { usePostHog } from 'posthog-react-native';

import { Events } from '@/services/analytics';

import { Text } from '@/components/Themed';

const ONBOARDING_KEY = 'onboarding_complete';

export default function OnboardingScreen() {
  const router = useRouter();
  const posthog = usePostHog();

  const handleChoice = async (destination: '/(tabs)/' | '/(tabs)/report') => {
    posthog?.capture(Events.ONBOARDING_CHOICE, {
      choice: destination === '/(tabs)/' ? 'search' : 'submit',
    });
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace(destination);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.appName}>Roach Reports</Text>
          <Text style={styles.tagline}>NYC's crowd-sourced guide to apartment pest history</Text>
        </View>

        <View style={styles.prompt}>
          <Text style={styles.promptText}>What brings you here?</Text>
          <Text style={styles.promptSub}>
            Don't worry — you can do either at any time.
          </Text>
        </View>

        <View style={styles.cards}>
          <TouchableOpacity
            style={styles.card}
            onPress={() => handleChoice('/(tabs)/')}
            activeOpacity={0.85}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#F0E8D5' }]}>
              <FontAwesome name="search" size={28} color="#8B4411" />
            </View>
            <Text style={styles.cardTitle}>Search for an apartment</Text>
            <Text style={styles.cardDesc}>
              Look up roach history for a building before you sign a lease or move in.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.card, styles.cardAccent]}
            onPress={() => handleChoice('/(tabs)/report')}
            activeOpacity={0.85}
          >
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <FontAwesome name="pencil" size={28} color="#F5F5DD" />
            </View>
            <Text style={[styles.cardTitle, styles.cardTitleAccent]}>Review my own apartment</Text>
            <Text style={[styles.cardDesc, styles.cardDescAccent]}>
              Add your experience to help other renters make informed decisions.
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5DD',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  appName: {
    fontSize: 38,
    fontWeight: 'bold',
    color: '#8B4411',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    color: '#A57A5A',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 21,
  },
  prompt: {
    alignItems: 'center',
    marginBottom: 28,
  },
  promptText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#5C2D0A',
  },
  promptSub: {
    fontSize: 14,
    color: '#A57A5A',
    marginTop: 6,
    textAlign: 'center',
  },
  cards: {
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardAccent: {
    backgroundColor: '#AE6E4E',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8B4411',
    marginBottom: 6,
  },
  cardTitleAccent: {
    color: '#F5F5DD',
  },
  cardDesc: {
    fontSize: 14,
    color: '#A57A5A',
    lineHeight: 20,
  },
  cardDescAccent: {
    color: 'rgba(245, 245, 221, 0.8)',
  },
});
