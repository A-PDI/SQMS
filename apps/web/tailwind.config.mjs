import reference from './tailwind.reference.js';

export default {
  ...reference,
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    ...reference.theme,
    extend: {
      ...reference.theme.extend,
      colors: {
        ...reference.theme.extend.colors,
        primary: '#1D2B4F', 'primary-foreground': '#FFFFFF', accent: '#D4943A',
        background: '#F9FAFB', surface: '#FFFFFF', foreground: '#111827',
        muted: '#F3F4F6', 'muted-foreground': '#6B7280', border: '#D1D5DB',
        ring: '#1D2B4F', destructive: '#C0392B', success: '#1E7E4A',
        warning: '#D4943A', info: '#1A8C80',
      },
    },
  },
};
