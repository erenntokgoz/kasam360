import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { tokens, darkColors } from '../theme/tokens';

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export const EmptyState = ({ title, message, icon, style }: EmptyStateProps) => {
  return (
    <View style={[styles.container, style]}>
      {icon && <View style={styles.iconContainer}>{icon}</View>}
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: tokens.spacing.xl,
    backgroundColor: 'transparent',
  },
  iconContainer: {
    marginBottom: tokens.spacing.md,
  },
  title: {
    fontSize: tokens.fontSizes.lg,
    fontFamily: tokens.fonts.bold,
    color: darkColors.textPrimary,
    textAlign: 'center',
    marginBottom: tokens.spacing.xs,
  },
  message: {
    fontSize: tokens.fontSizes.base,
    fontFamily: tokens.fonts.regular,
    color: darkColors.textSecondary,
    textAlign: 'center',
  },
});
