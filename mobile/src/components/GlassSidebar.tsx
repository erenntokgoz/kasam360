/**
 * GlassSidebar — Executive Glassmorphism Drawer
 * ──────────────────────────────────────────────────────────────────────────────
 * Custom drawer content rendered inside @react-navigation/drawer.
 * Uses @react-native-community/blur for a 15 px Gaussian blur backdrop.
 *
 * Styling spec:
 *   • 0.5 px ivory-white border-right
 *   • 20 % opacity background (no solid colours)
 *   • Feather line-icons only
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  DrawerContentScrollView,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { BlurView } from '@react-native-community/blur';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useAuthStore } from '../store/useAuthStore';

// ─── Menu Items ──────────────────────────────────────────────────────────────

interface MenuItem {
  label: string;
  icon: string;
  route: string;
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'Ledger',      icon: 'book-open',    route: 'Home' },
  { label: 'Analytics',   icon: 'bar-chart-2',  route: 'Analytics' },
  { label: 'Debts',       icon: 'credit-card',  route: 'Debts' },
  { label: 'Settings',    icon: 'settings',     route: 'Settings' },
];

// ─── Component ───────────────────────────────────────────────────────────────

const GlassSidebar: React.FC<DrawerContentComponentProps> = (props) => {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const activeRoute =
    props.state.routes[props.state.index]?.name ?? 'Home';

  return (
    <View style={styles.root}>
      {/* Blur backdrop — covers the entire sidebar */}
      {Platform.OS !== 'web' && (
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType="dark"
          blurAmount={15}
          reducedTransparencyFallbackColor={theme.colors.primary}
        />
      )}

      {/* Semi-transparent overlay for exact 20 % opacity */}
      <View style={styles.overlay} />

      {/* Content */}
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + theme.spacing.lg },
        ]}
      >
        {/* ─── Brand header ─────────────────────────────────────────── */}
        <View style={styles.brandSection}>
          <View style={styles.logoContainer}>
            <Icon name="layers" size={22} color={theme.colors.successLight} />
          </View>
          <Text style={styles.brandName}>Kasam360</Text>
          {user?.businessName && (
            <Text style={styles.businessName} numberOfLines={1}>
              {user.businessName}
            </Text>
          )}
        </View>

        {/* ─── Divider ──────────────────────────────────────────────── */}
        <View style={styles.divider} />

        {/* ─── Navigation items ─────────────────────────────────────── */}
        <View style={styles.menuSection}>
          {MENU_ITEMS.map((item) => {
            const isActive = item.route === activeRoute;
            return (
              <TouchableOpacity
                key={item.route}
                activeOpacity={0.7}
                style={[styles.menuItem, isActive && styles.menuItemActive]}
                onPress={() => props.navigation.navigate(item.route)}
              >
                <Icon
                  name={item.icon}
                  size={18}
                  color={
                    isActive
                      ? theme.colors.successLight
                      : theme.colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.menuLabel,
                    isActive && styles.menuLabelActive,
                  ]}
                >
                  {item.label}
                </Text>

                {isActive && <View style={styles.activeIndicator} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </DrawerContentScrollView>

      {/* ─── Footer / Logout ──────────────────────────────────────── */}
      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + theme.spacing.base },
        ]}
      >
        <View style={styles.divider} />
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.logoutButton}
          onPress={logout}
        >
          <Icon name="log-out" size={18} color={theme.colors.dangerLight} />
          <Text style={styles.logoutLabel}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    borderRightWidth: 0.5,
    borderRightColor: 'rgba(248, 249, 250, 0.08)',
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 28, 30, 0.20)',
  },

  scrollContent: {
    paddingHorizontal: theme.spacing.lg,
  },

  // ── Brand ──────────────────────────────────────────────────────────────
  brandSection: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  logoContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  brandName: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textPrimary,
    letterSpacing: 0.6,
  },
  businessName: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textTertiary,
    marginTop: 2,
  },

  // ── Divider ────────────────────────────────────────────────────────────
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },

  // ── Menu ───────────────────────────────────────────────────────────────
  menuSection: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.base,
    borderRadius: theme.radii.base,
  },
  menuItemActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  menuLabel: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textSecondary,
    marginLeft: theme.spacing.md,
    flex: 1,
  },
  menuLabelActive: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.semiBold,
  },
  activeIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.successLight,
  },

  // ── Footer ─────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: theme.spacing.lg,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.base,
    borderRadius: theme.radii.base,
  },
  logoutLabel: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSizes.base,
    color: theme.colors.dangerLight,
    marginLeft: theme.spacing.md,
  },
});

export default GlassSidebar;
