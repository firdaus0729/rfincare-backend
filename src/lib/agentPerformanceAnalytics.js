/**
 * Build time-series analytics and period-over-period trends for agent dashboards.
 */

function parseAppDate(app) {
  const raw = app.created_at || app.createdAt;
  return raw ? new Date(raw) : null;
}

function inRange(date, start, end) {
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= start && date <= end;
}

function buildBuckets(range) {
  const now = new Date();
  const buckets = [];

  if (range === 'week') {
    for (let i = 6; i >= 0; i -= 1) {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      buckets.push({
        name: start.toLocaleDateString('en-IN', { weekday: 'short' }),
        start,
        end,
      });
    }
    return buckets;
  }

  if (range === 'month') {
    for (let w = 3; w >= 0; w -= 1) {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() - w * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      buckets.push({ name: `W${4 - w}`, start, end });
    }
    return buckets;
  }

  if (range === 'quarter') {
    for (let m = 2; m >= 0; m -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - m, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
      buckets.push({
        name: start.toLocaleDateString('en-IN', { month: 'short' }),
        start,
        end,
      });
    }
    return buckets;
  }

  // year — last 12 calendar months
  for (let m = 11; m >= 0; m -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    buckets.push({
      name: start.toLocaleDateString('en-IN', { month: 'short' }),
      start,
      end,
    });
  }
  return buckets;
}

function aggregateBucket(apps, commissionById, bucket) {
  let clients = 0;
  let conversions = 0;
  let earnings = 0;

  for (const app of apps) {
    const t = parseAppDate(app);
    if (!inRange(t, bucket.start, bucket.end)) continue;
    clients += 1;
    if (String(app.status || '').toLowerCase() === 'approved') conversions += 1;
    earnings += commissionById.get(app.id) || 0;
  }

  return {
    name: bucket.name,
    clients,
    conversions,
    earnings,
  };
}

export function buildAgentPerformanceAnalytics(apps, commissionEntries) {
  const commissionById = new Map(
    (commissionEntries || []).map((e) => [e.id, Number(e.amount) || 0]),
  );

  const ranges = ['week', 'month', 'quarter', 'year'];
  const performanceAnalytics = {};
  for (const range of ranges) {
    const buckets = buildBuckets(range);
    performanceAnalytics[range] = buckets.map((b) =>
      aggregateBucket(apps, commissionById, b),
    );
  }

  return performanceAnalytics;
}

function countInWindow(apps, start, end) {
  return apps.filter((app) => {
    const t = parseAppDate(app);
    return inRange(t, start, end);
  }).length;
}

function approvedInWindow(apps, start, end) {
  return apps.filter((app) => {
    const t = parseAppDate(app);
    return inRange(t, start, end) && String(app.status || '').toLowerCase() === 'approved';
  }).length;
}

function commissionInWindow(apps, commissionById, start, end) {
  let sum = 0;
  for (const app of apps) {
    const t = parseAppDate(app);
    if (!inRange(t, start, end)) continue;
    if (String(app.status || '').toLowerCase() === 'approved') {
      sum += commissionById.get(app.id) || 0;
    }
  }
  return sum;
}

function trendMeta(current, previous) {
  if (previous === 0 && current === 0) {
    return { trend: 'up', change: '0%' };
  }
  if (previous === 0) {
    return { trend: 'up', change: '+100%' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return {
    trend: pct >= 0 ? 'up' : 'down',
    change: `${pct >= 0 ? '+' : ''}${pct}%`,
  };
}

/** Metrics cards with 30-day vs prior-30-day trend */
export function buildAgentMetricTrends(apps, commissionEntries) {
  const now = new Date();
  const currentEnd = new Date(now);
  currentEnd.setHours(23, 59, 59, 999);
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - 30);
  currentStart.setHours(0, 0, 0, 0);

  const prevEnd = new Date(currentStart);
  prevEnd.setMilliseconds(-1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - 30);
  prevStart.setHours(0, 0, 0, 0);

  const commissionById = new Map(
    (commissionEntries || []).map((e) => [e.id, Number(e.amount) || 0]),
  );

  const activeNow = apps.filter(
    (a) => !['approved', 'rejected'].includes(String(a.status || '').toLowerCase()),
  ).length;

  const curClients = countInWindow(apps, currentStart, currentEnd);
  const prevClients = countInWindow(apps, prevStart, prevEnd);
  const curApproved = approvedInWindow(apps, currentStart, currentEnd);
  const prevApproved = approvedInWindow(apps, prevStart, prevEnd);
  const curConv = curClients > 0 ? Math.round((curApproved / curClients) * 100) : 0;
  const prevConv = prevClients > 0 ? Math.round((prevApproved / prevClients) * 100) : 0;
  const curEarn = commissionInWindow(apps, commissionById, currentStart, currentEnd);
  const prevEarn = commissionInWindow(apps, commissionById, prevStart, prevEnd);

  return {
    clients: trendMeta(curClients, prevClients),
    conversions: trendMeta(curConv, prevConv),
    earnings: trendMeta(curEarn, prevEarn),
    activeClients: activeNow,
  };
}
