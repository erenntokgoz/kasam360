import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const BorcAlacakScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Borçlar ve Alacaklar</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
});

export default BorcAlacakScreen;
