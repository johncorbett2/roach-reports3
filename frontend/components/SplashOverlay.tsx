import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ROACH_SIZE = 72;
const DURATION = 1600;

interface Props {
  onComplete: () => void;
}

export default function SplashOverlay({ onComplete }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(
      1,
      { duration: DURATION, easing: Easing.linear },
      (finished) => {
        'worklet';
        if (finished) runOnJS(onComplete)();
      }
    );
  }, []);

  const roachStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      progress.value,
      [0, 1],
      [-ROACH_SIZE, SCREEN_WIDTH],
      Extrapolation.CLAMP
    );

    const translateY = interpolate(
      progress.value,
      [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
      [0, -6, 0, 6, 0, -6, 0, 6, 0],
      Extrapolation.CLAMP
    );

    const rotationDeg = interpolate(
      progress.value,
      [0, 0.25, 0.5, 0.75, 1],
      [-3, 3, -3, 3, -3],
      Extrapolation.CLAMP
    );

    return {
      transform: [
        { translateX },
        { translateY },
        { rotate: `${rotationDeg}deg` },
      ],
    };
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.roach, roachStyle]}>
        <Text style={styles.roachEmoji}>🪳</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F5F5DD',
    zIndex: 999,
  },
  roach: {
    position: 'absolute',
    top: SCREEN_HEIGHT / 2 - ROACH_SIZE / 2,
  },
  roachEmoji: {
    fontSize: 64,
  },
});
