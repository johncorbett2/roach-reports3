import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#F5F5DD',
        tabBarInactiveTintColor: '#CC9767',
        tabBarStyle: { backgroundColor: '#8B4411', borderTopColor: '#6B3410' },
        headerShown: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '',
          headerShown: true,
          headerStyle: { backgroundColor: '#F5F5DD' },
          headerTintColor: '#8B4411',
          tabBarIcon: ({ color }) => <TabBarIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="map-marker" color={color} />,
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: '',
          headerShown: true,
          headerStyle: { backgroundColor: '#F5F5DD' },
          headerTintColor: '#8B4411',
          tabBarIcon: ({ color }) => <TabBarIcon name="plus-circle" color={color} />,
        }}
      />
    </Tabs>
  );
}
