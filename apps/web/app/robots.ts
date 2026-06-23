import type { MetadataRoute } from 'next';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://usezentra.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/login',
          '/signup',
          '/welcome',
          '/forgot',
          '/verify-email',
          '/help',
          '/legal/terms',
          '/legal/privacy',
        ],
        // Block authed app surfaces and anything with tracking params from
        // creating duplicate URLs in Google's index.
        disallow: [
          '/today',
          '/planner',
          '/planner/working',
          '/planner/working/mini',
          '/lists',
          '/lists/',
          '/shopping',
          '/shopping/',
          '/reminders',
          '/reflect',
          '/friends',
          '/settings',
          '/onboarding',
          '/zentra-ops',
          '/zentra-ops/',
          '/api/',
          '/*?*', // any URL with query string
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
