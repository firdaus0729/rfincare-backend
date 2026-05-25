import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from '../db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_ID = 'default';
let ensured = false;

const DEFAULTS = {
  tagline:
    'Intelligent loan matching that works for you. Transparency in every step. Your financial success is our mission.',
  email: 'support@rfincare.com',
  phone: '7300069952',
  emails: ['support@rfincare.com', 'info@rfincare.com'],
  phones: ['7300069952', '7696664657'],
  registeredOfficeLabel: 'Regist. Office:',
  registeredAddress: 'Ward No 2, Baniya Bass, Mahajan, Bikaner, Rajasthan-334606 India',
  branchOfficeLabel: 'Branch Office:',
  branchAddress:
    'Shop no 3, 2nd Floor, Shiv Market, Near Kirtistambh circle, Ganganagar Road, Bikaner -334001 India',
  offices: [
    {
      title: 'Reg. Office',
      address: 'Ward No 2, Baniya Bass, Mahajan, Bikaner, Rajasthan-334606 India',
    },
    {
      title: 'Circle Office',
      address:
        'M125, Bharat Mata Chowk, Ganesh Nagar Ext. Niwaru Road, Jhotwara, Jaipur-302012 India',
    },
    {
      title: 'Branch Office',
      address:
        'Shop no 3, 2nd Floor, Shiv Market, Near Kirtistambh circle, Ganganagar Road, Bikaner -334001 India',
    },
  ],
  socialFacebook: '#',
  socialTwitter: '#',
  socialLinkedin: '#',
  socialInstagram: '#',
};

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseOffices(value) {
  const arr = parseJsonArray(value);
  return arr
    .filter((o) => o && (o.title || o.address))
    .map((o) => ({
      title: o.title || 'Office',
      address: o.address || '',
    }));
}

export async function ensureSiteContactSchema() {
  if (ensured) return;
  const sql = readFileSync(
    join(__dirname, '../../migrations/010_site_contact_settings.sql'),
    'utf8',
  );
  const pool = getPool();
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      await pool.execute(statement);
    } catch (err) {
      if (err.code !== 'ER_TABLE_EXISTS_ERROR' && err.code !== 'ER_DUP_ENTRY') {
        throw err;
      }
    }
  }
  ensured = true;
}

function formatRow(row) {
  if (!row) return { ...DEFAULTS };
  const emails = parseJsonArray(row.emails_json);
  const phones = parseJsonArray(row.phones_json);
  let offices = parseOffices(row.offices_json);
  if (!offices.length) {
    offices = [
      { title: row.registered_office_label?.replace(':', '') || 'Regist. Office', address: row.registered_address },
      { title: row.branch_office_label?.replace(':', '') || 'Branch Office', address: row.branch_address },
    ].filter((o) => o.address);
  }

  return {
    tagline: row.tagline || DEFAULTS.tagline,
    email: row.email || DEFAULTS.email,
    phone: row.phone || DEFAULTS.phone,
    emails: emails.length ? emails : [row.email].filter(Boolean),
    phones: phones.length ? phones : [row.phone].filter(Boolean),
    registeredOfficeLabel: row.registered_office_label || DEFAULTS.registeredOfficeLabel,
    registeredAddress: row.registered_address || DEFAULTS.registeredAddress,
    branchOfficeLabel: row.branch_office_label || DEFAULTS.branchOfficeLabel,
    branchAddress: row.branch_address || DEFAULTS.branchAddress,
    offices,
    socialFacebook: row.social_facebook || '#',
    socialTwitter: row.social_twitter || '#',
    socialLinkedin: row.social_linkedin || '#',
    socialInstagram: row.social_instagram || '#',
    updatedAt: row.updated_at,
  };
}

export async function getSiteContactSettings() {
  await ensureSiteContactSchema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT * FROM site_contact_settings WHERE id = :id LIMIT 1`,
    { id: SETTINGS_ID },
  );
  if (!row) return formatRow(null);
  return formatRow(row);
}

export async function updateSiteContactSettings(input, updatedBy) {
  await ensureSiteContactSchema();
  const pool = getPool();

  const emails = input.emails?.length ? input.emails : [input.email].filter(Boolean);
  const phones = input.phones?.length ? input.phones : [input.phone].filter(Boolean);
  const offices =
    input.offices?.length > 0
      ? input.offices
      : [
          {
            title: input.registeredOfficeLabel?.replace(':', '').trim() || 'Regist. Office',
            address: input.registeredAddress,
          },
          {
            title: input.branchOfficeLabel?.replace(':', '').trim() || 'Branch Office',
            address: input.branchAddress,
          },
        ];

  await pool.execute(
    `INSERT INTO site_contact_settings (
       id, tagline, email, phone, emails_json, phones_json,
       registered_office_label, registered_address,
       branch_office_label, branch_address, offices_json,
       social_facebook, social_twitter, social_linkedin, social_instagram, updated_by
     ) VALUES (
       :id, :tagline, :email, :phone, :emails_json, :phones_json,
       :reg_label, :reg_addr, :branch_label, :branch_addr, :offices_json,
       :fb, :tw, :li, :ig, :updated_by
     )
     ON DUPLICATE KEY UPDATE
       tagline = VALUES(tagline),
       email = VALUES(email),
       phone = VALUES(phone),
       emails_json = VALUES(emails_json),
       phones_json = VALUES(phones_json),
       registered_office_label = VALUES(registered_office_label),
       registered_address = VALUES(registered_address),
       branch_office_label = VALUES(branch_office_label),
       branch_address = VALUES(branch_address),
       offices_json = VALUES(offices_json),
       social_facebook = VALUES(social_facebook),
       social_twitter = VALUES(social_twitter),
       social_linkedin = VALUES(social_linkedin),
       social_instagram = VALUES(social_instagram),
       updated_by = VALUES(updated_by)`,
    {
      id: SETTINGS_ID,
      tagline: input.tagline ?? DEFAULTS.tagline,
      email: input.email,
      phone: input.phone,
      emails_json: JSON.stringify(emails),
      phones_json: JSON.stringify(phones),
      reg_label: input.registeredOfficeLabel ?? DEFAULTS.registeredOfficeLabel,
      reg_addr: input.registeredAddress,
      branch_label: input.branchOfficeLabel ?? DEFAULTS.branchOfficeLabel,
      branch_addr: input.branchAddress,
      offices_json: JSON.stringify(offices),
      fb: input.socialFacebook || '#',
      tw: input.socialTwitter || '#',
      li: input.socialLinkedin || '#',
      ig: input.socialInstagram || '#',
      updated_by: updatedBy ?? null,
    },
  );

  return getSiteContactSettings();
}
