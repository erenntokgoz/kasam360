import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions, Pressable } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useSetupStore } from '../store/useSetupStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');

const OnboardingScreen: React.FC = () => {
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const ONBOARDING_DATA = [
    {
      id: '1',
      title: t('onboarding.slide1Title'),
      description: t('onboarding.slide1Desc'),
      icon: 'dollar-sign',
    },
    {
      id: '2',
      title: t('onboarding.slide2Title'),
      description: t('onboarding.slide2Desc'),
      icon: 'credit-card',
    },
    {
      id: '3',
      title: t('onboarding.slide3Title'),
      description: t('onboarding.slide3Desc'),
      icon: 'camera',
    },
  ];

  const [currentIndex, setCurrentIndex] = useState(0);
  const { setSetupComplete } = useSetupStore();
  const insets = useSafeAreaInsets();

  const handleScroll = (event: any) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = event.nativeEvent.contentOffset.x / slideSize;
    setCurrentIndex(Math.round(index));
  };

  const handleStart = () => {
    setSetupComplete(true);
  };

  const renderItem = ({ item }: { item: typeof ONBOARDING_DATA[0] }) => (
    <View style={[styles.slide, { width }]}>
      <Animated.View entering={FadeInDown.delay(100).duration(500)} style={[styles.iconContainer, { backgroundColor: theme.colors.accentTransparent }]}>
        <Icon name={item.icon} size={72} color={theme.colors.accent} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.textContainer}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{item.title}</Text>
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>{item.description}</Text>
      </Animated.View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary }]}>
      <FlatList
        data={ONBOARDING_DATA}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
      
      <View style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.xl }]}>
        <View style={styles.pagination}>
          {ONBOARDING_DATA.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                currentIndex === index
                  ? [styles.activeDot, { backgroundColor: theme.colors.accent }]
                  : [styles.inactiveDot, { backgroundColor: theme.colors.border }],
              ]}
            />
          ))}
        </View>
        
        {currentIndex === ONBOARDING_DATA.length - 1 ? (
          <Animated.View entering={FadeIn.duration(300)}>
            <Pressable
              style={({ pressed }) => [
                styles.startButton,
                { backgroundColor: theme.colors.accent, ...theme.shadows.button },
                pressed && { opacity: 0.9 },
              ]}
              onPress={handleStart}
            >
              <Text style={[styles.startButtonText, { color: theme.colors.surface }]}>{t('onboarding.start')}</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={styles.buttonPlaceholder} />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconContainer: { width: 120, height: 120, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', marginBottom: 48 },
  textContainer: { alignItems: 'center' },
  title: { fontFamily: 'System', fontSize: 28, textAlign: 'center', marginBottom: 16 },
  description: { fontFamily: 'System', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  footer: { paddingHorizontal: 32, paddingTop: 16 },
  pagination: { flexDirection: 'row', justifyContent: 'center', marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  activeDot: { width: 24 },
  inactiveDot: {},
  startButton: { borderRadius: 10, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  startButtonText: { fontFamily: 'System', fontSize: 18, letterSpacing: 0.5 },
  buttonPlaceholder: { height: 56 },
});

export default OnboardingScreen;
