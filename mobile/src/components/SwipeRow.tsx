import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { tokens, darkColors } from '../theme/tokens';
import { useHaptics } from '../hooks/useHaptics';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

interface SwipeRowProps {
  children: React.ReactNode;
  onDelete: () => void;
}

export const SwipeRow = ({ children, onDelete }: SwipeRowProps) => {
  const translateX = useSharedValue(0);
  const { trigger } = useHaptics();

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Only allow swiping to the left
      if (event.translationX < 0) {
        translateX.value = event.translationX;
      }
    })
    .onEnd((event) => {
      // If swiped more than 80 logical pixels, keep it open and trigger haptic
      if (translateX.value < -80) {
        translateX.value = withSpring(-80);
        runOnJS(trigger)('medium');
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary }]}>
      <View style={[styles.backRow, { backgroundColor: theme.colors.dangerTransparent }]}>
        <Pressable
          style={[styles.deleteButton, { backgroundColor: theme.colors.danger }]}
          onPress={() => {
            trigger('heavy');
            onDelete();
            translateX.value = withSpring(0);
          }}
        >
          <Text style={[styles.deleteText, { color: '#fff' }]}>Sil</Text>
        </Pressable>
      </View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.frontRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, animatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    marginBottom: tokens.spacing.sm,
    backgroundColor: darkColors.primary,
  },
  frontRow: {
    backgroundColor: darkColors.surface,
    borderRadius: tokens.radii.base,
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  backRow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: darkColors.dangerTransparent,
    borderRadius: tokens.radii.base,
    paddingRight: tokens.spacing.md,
  },
  deleteButton: {
    backgroundColor: darkColors.danger,
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radii.sm,
  },
  deleteText: {
    color: darkColors.textPrimary,
    fontSize: tokens.fontSizes.base,
    fontFamily: tokens.fonts.bold,
  },
});
