import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, ViewStyle } from 'react-native';
import { tokens, darkColors } from '../theme/tokens';

export interface ToastProps {
  message: string;
  type?: 'success' | 'danger' | 'warning' | 'info';
  visible: boolean;
  onHide?: () => void;
  style?: ViewStyle;
}

export const Toast = ({ message, type = 'info', visible, onHide, style }: ToastProps) => {
  const [rendered, setRendered] = useState(visible);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        hide();
      }, 3000);

      return () => clearTimeout(timer);
    } else if (rendered) {
      hide();
    }
  }, [visible]);

  const hide = () => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -20,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setRendered(false);
      if (onHide) onHide();
    });
  };

  if (!rendered) return null;

  const getTypeStyle = () => {
    switch (type) {
      case 'success':
        return { backgroundColor: darkColors.successTransparent, borderColor: darkColors.success };
      case 'danger':
        return { backgroundColor: darkColors.dangerTransparent, borderColor: darkColors.danger };
      case 'warning':
        return { backgroundColor: darkColors.warningTransparent, borderColor: darkColors.warning };
      default:
        return { backgroundColor: darkColors.accentTransparent, borderColor: darkColors.accent };
    }
  };

  const getTypeTextStyle = () => {
    switch (type) {
      case 'success':
        return { color: darkColors.successLight };
      case 'danger':
        return { color: darkColors.dangerLight };
      case 'warning':
        return { color: darkColors.warningLight };
      default:
        return { color: darkColors.accentLight };
    }
  };

  return (
    <Animated.View
      style={[
        styles.toast,
        getTypeStyle(),
        {
          opacity,
          transform: [{ translateY }],
        },
        style,
      ]}
    >
      <Text style={[styles.text, getTypeTextStyle()]}>{message}</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 50,
    left: tokens.spacing.md,
    right: tokens.spacing.md,
    padding: tokens.spacing.md,
    borderRadius: tokens.radii.base,
    borderWidth: 1,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: tokens.fontSizes.base,
    fontFamily: tokens.fonts.medium,
    textAlign: 'center',
  },
});
