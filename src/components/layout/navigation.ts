import {
  LayoutDashboard,
  School,
  Users,
  Calendar,
  Download,
  Upload,
  BarChart3,
  Settings,
  Map,
  ListChecks,
} from 'lucide-react';

export interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: 'Data',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/priorities', icon: ListChecks, label: 'Priorities' },
      { to: '/schools', icon: School, label: 'Schools' },
      { to: '/contacts', icon: Users, label: 'Contacts' },
      { to: '/events', icon: Calendar, label: 'Events' },
      { to: '/counties', icon: Map, label: 'Counties' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/import', icon: Download, label: 'Import Data' },
      { to: '/generate', icon: Upload, label: 'Generate Lists' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', icon: BarChart3, label: 'Reports' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];
