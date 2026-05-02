import React, { Component } from 'react';
import { Text } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { theme } from '../theme';

interface Props {
  name: string;
  size: number;
  color: string;
  fallbackText?: string;
}

interface State {
  hasError: boolean;
}

export class SafeIcon extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Text style={{ 
          color: this.props.color, 
          fontSize: this.props.size * 0.6,
          fontFamily: theme.fonts.light,
          fontWeight: '300'
        }}>
          {this.props.fallbackText || this.props.name}
        </Text>
      );
    }
    return <Icon name={this.props.name} size={this.props.size} color={this.props.color} />;
  }
}
