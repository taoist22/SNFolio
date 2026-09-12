import { CalendarEvent, CalendarFeed } from './types';
import { parseIcsContentStrict } from './icsParser';

export function normaliseFeedUrl(raw: string): string | null {
  const url = raw.trim().replace(/^webcal:\/\//i, 'https://');
  return url.startsWith('https://') ? url : null;
}

export async function fetchCalendarFeed(
  url: string,
  name: string,
  fetcher: typeof fetch = fetch,
  feedId?: string
): Promise<CalendarEvent[]> {
  const safeUrl = normaliseFeedUrl(url);
  if (!safeUrl) throw new Error('Calendar subscriptions must use HTTPS.');
  const response = await fetcher(safeUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Response is not an iCalendar feed.');
  return parseIcsContentStrict(text, name).map(event => ({
    ...event,
    sourceKind: 'feed' as const,
    sourceFeedId: feedId,
  }));
}

export async function refreshCalendarFeeds(
  feeds: CalendarFeed[],
  fetcher: typeof fetch = fetch
): Promise<{ events: CalendarEvent[]; successful: number; failed: number; errors?: string[] }> {
  const enabled = feeds.filter(feed => feed.enabled && feed.url);
  const events: CalendarEvent[] = [];
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const feed of enabled) {
    try {
      events.push(...await fetchCalendarFeed(
        feed.url as string,
        feed.name || 'Calendar',
        fetcher,
        feed.id
      ));
      successful++;
    } catch (error) {
      failed++;
      errors.push(`${feed.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { events, successful, failed, ...(errors.some(message => message.includes("Calendar import needs attention")) ? { errors } : {}) };
}
