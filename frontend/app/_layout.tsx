import * as Sentry from '@sentry/react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PostHogProvider } from 'posthog-react-native';

import { useColorScheme } from '@/components/useColorScheme';
import SplashOverlay from '@/components/SplashOverlay';

const ONBOARDING_KEY = 'onboarding_complete';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  debug: false,
  tracesSampleRate: 0.2,
});

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

export default Sentry.wrap(RootLayout);

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(true);

  const handleSplashComplete = useCallback(async () => {
    if (__DEV__) await AsyncStorage.removeItem(ONBOARDING_KEY);
    const value = await AsyncStorage.getItem(ONBOARDING_KEY);
    setShowSplash(false);
    if (!value) router.replace('/onboarding');
  }, [router]);

  return (
    <PostHogProvider
      apiKey={process.env.EXPO_PUBLIC_POSTHOG_KEY ?? ''}
      options={{ host: 'https://us.i.posthog.com' }}
    >
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="splash" options={{ headerShown: false }} />
          <Stack.Screen name="building/[id]" options={{ headerShown: true, headerStyle: { backgroundColor: '#F5F5DD' }, headerTintColor: '#8B4411' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
        {showSplash && <SplashOverlay onComplete={handleSplashComplete} />}
      </ThemeProvider>
    </PostHogProvider>
  );
}
