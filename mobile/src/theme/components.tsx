import React from 'react';
import { View, Text, TextInput, Modal as RNModal, StyleSheet, ViewStyle, TextStyle, TextInputProps, ModalProps as RNModalProps } from 'react-native';
import { tokens, darkColors } from './tokens';

export const Screen = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[styles.screen, style]}>{children}</View>
);

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[styles.card, style]}>{children}</View>
);

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export const Input = ({ label, error, style, ...props }: InputProps) => (
  <View style={styles.inputContainer}>
    {label && <Text style={styles.label}>{label}</Text>}
    <TextInput
      style={[styles.input, error ? styles.inputError : {}, style]}
      placeholderTextColor={darkColors.textTertiary}
      {...props}
    />
    {error && <Text style={styles.errorText}>{error}</Text>}
  </View>
);

export interface ModalProps extends RNModalProps {
  children: React.ReactNode;
  onClose?: () => void;
  title?: string;
}

export const Modal = ({ children, title, onClose, ...props }: ModalProps) => (
  <RNModal transparent animationType="fade" {...props}>
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>
        {title && <Text style={styles.modalTitle}>{title}</Text>}
        {children}
      </View>
    </View>
  </RNModal>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: darkColors.primary,
  },
  card: {
    backgroundColor: darkColors.surface,
    borderRadius: tokens.radii.base,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  inputContainer: {
    marginBottom: tokens.spacing.md,
  },
  label: {
    color: darkColors.textSecondary,
    fontSize: tokens.fontSizes.sm,
    marginBottom: tokens.spacing.xs,
    fontFamily: tokens.fonts.medium,
  },
  input: {
    backgroundColor: darkColors.card,
    borderRadius: tokens.radii.sm,
    padding: tokens.spacing.md,
    color: darkColors.textPrimary,
    borderWidth: 1,
    borderColor: darkColors.border,
    fontSize: tokens.fontSizes.base,
  },
  inputError: {
    borderColor: darkColors.danger,
  },
  errorText: {
    color: darkColors.danger,
    fontSize: tokens.fontSizes.xs,
    marginTop: tokens.spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: darkColors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: tokens.spacing.lg,
  },
  modalContent: {
    backgroundColor: darkColors.surface,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.lg,
    width: '100%',
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  modalTitle: {
    color: darkColors.textPrimary,
    fontSize: tokens.fontSizes.xl,
    fontFamily: tokens.fonts.bold,
    marginBottom: tokens.spacing.md,
  },
});
