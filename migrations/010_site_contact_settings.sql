-- Editable site contact & footer settings (admin CMS)

CREATE TABLE IF NOT EXISTS site_contact_settings (
  id VARCHAR(32) NOT NULL DEFAULT 'default',
  tagline TEXT NULL,
  email VARCHAR(320) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  emails_json JSON NULL,
  phones_json JSON NULL,
  registered_office_label VARCHAR(128) NULL DEFAULT 'Regist. Office:',
  registered_address TEXT NOT NULL,
  branch_office_label VARCHAR(128) NULL DEFAULT 'Branch Office:',
  branch_address TEXT NOT NULL,
  offices_json JSON NULL,
  social_facebook VARCHAR(512) NULL,
  social_twitter VARCHAR(512) NULL,
  social_linkedin VARCHAR(512) NULL,
  social_instagram VARCHAR(512) NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

INSERT INTO site_contact_settings (
  id, tagline, email, phone, emails_json, phones_json,
  registered_office_label, registered_address,
  branch_office_label, branch_address, offices_json,
  social_facebook, social_twitter, social_linkedin, social_instagram
) VALUES (
  'default',
  'Intelligent loan matching that works for you. Transparency in every step. Your financial success is our mission.',
  'support@rfincare.com',
  '7300069952',
  JSON_ARRAY('support@rfincare.com', 'info@rfincare.com'),
  JSON_ARRAY('7300069952', '7696664657'),
  'Regist. Office:',
  'Ward No 2, Baniya Bass, Mahajan, Bikaner, Rajasthan-334606 India',
  'Branch Office:',
  'Shop no 3, 2nd Floor, Shiv Market, Near Kirtistambh circle, Ganganagar Road, Bikaner -334001 India',
  JSON_ARRAY(
    JSON_OBJECT('title', 'Reg. Office', 'address', 'Ward No 2, Baniya Bass, Mahajan, Bikaner, Rajasthan-334606 India'),
    JSON_OBJECT('title', 'Circle Office', 'address', 'M125, Bharat Mata Chowk, Ganesh Nagar Ext. Niwaru Road, Jhotwara, Jaipur-302012 India'),
    JSON_OBJECT('title', 'Branch Office', 'address', 'Shop no 3, 2nd Floor, Shiv Market, Near Kirtistambh circle, Ganganagar Road, Bikaner-334001 India')
  ),
  '#',
  '#',
  '#',
  '#'
) ON DUPLICATE KEY UPDATE id = id;
