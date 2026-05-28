import { getPool } from '../db/pool.js';

const DEFAULT_TRUST_CONTENT = {
  heading: 'Trusted by Thousands',
  subtitle: 'Our commitment to security, transparency, and customer success speaks for itself',
  stats: [
    { id: 'applications', value: '50,000+', label: 'Applications Processed', icon: 'FileCheck', color: 'var(--color-primary)' },
    { id: 'approval', value: '87%', label: 'Average Approval Rate', icon: 'TrendingUp', color: 'var(--color-success)' },
    { id: 'processing', value: '48 Hours', label: 'Average Processing Time', icon: 'Clock', color: 'var(--color-secondary)' },
    { id: 'satisfaction', value: '4.8/5', label: 'Customer Satisfaction', icon: 'Star', color: 'var(--color-warning)' },
  ],
  certifications: [
    { id: 'ssl', name: 'SSL Secured', icon: 'Lock', description: '256-bit encryption' },
    { id: 'pci', name: 'PCI Compliant', icon: 'CreditCard', description: 'Payment security' },
    { id: 'iso', name: 'ISO 27001', icon: 'Shield', description: 'Information security' },
    { id: 'gdpr', name: 'GDPR Compliant', icon: 'FileText', description: 'Data protection' },
  ],
};

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function getHomepageTrustContent() {
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT heading, subtitle, stats_json, certifications_json, updated_at
     FROM homepage_trust_content WHERE id = 'default' LIMIT 1`,
  );

  if (!row) return { ...DEFAULT_TRUST_CONTENT };
  return {
    heading: row.heading || DEFAULT_TRUST_CONTENT.heading,
    subtitle: row.subtitle || DEFAULT_TRUST_CONTENT.subtitle,
    stats: parseJson(row.stats_json, DEFAULT_TRUST_CONTENT.stats),
    certifications: parseJson(row.certifications_json, DEFAULT_TRUST_CONTENT.certifications),
    updatedAt: row.updated_at,
  };
}

export async function upsertHomepageTrustContent(input, userId) {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO homepage_trust_content
      (id, heading, subtitle, stats_json, certifications_json, updated_by)
     VALUES
      ('default', :heading, :subtitle, :stats, :certs, :updated_by)
     ON DUPLICATE KEY UPDATE
      heading = VALUES(heading),
      subtitle = VALUES(subtitle),
      stats_json = VALUES(stats_json),
      certifications_json = VALUES(certifications_json),
      updated_by = VALUES(updated_by)`,
    {
      heading: input.heading,
      subtitle: input.subtitle || null,
      stats: JSON.stringify(input.stats || []),
      certs: JSON.stringify(input.certifications || []),
      updated_by: userId || null,
    },
  );

  return getHomepageTrustContent();
}

