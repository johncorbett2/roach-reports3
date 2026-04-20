import * as Sentry from '@sentry/react-native';

export { Sentry };

export const Events = {
  ONBOARDING_CHOICE: 'onboarding_choice',
  BUILDING_SEARCHED: 'building_searched',
  BUILDING_VIEWED: 'building_viewed',
  REPORT_SUBMITTED: 'report_submitted',
} as const;
