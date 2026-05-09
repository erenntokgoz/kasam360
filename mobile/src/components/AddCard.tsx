import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

interface AddCardProps {
  title: string;
  subtitle: string;
  icon: string;
  onPress: () => void;
}

const AddCard: React.FC<AddCardProps> = ({ title, subtitle, icon, onPress }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  return (
    <Pressable 
      style={[styles.container, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}
      onPress={onPress}
    >
      <View style={[styles.iconCircle, { backgroundColor: theme.colors.accentTransparent }]}>
        <Icon name={icon} size={22} color={theme.colors.accent} />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textTertiary }]}>{subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 20,
    gap: 16,
    marginBottom: 16,
  },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
});

export default AddCard;
