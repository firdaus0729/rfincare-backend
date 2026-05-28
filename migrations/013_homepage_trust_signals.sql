-- Homepage trust signals and certifications CMS content

CREATE TABLE IF NOT EXISTS homepage_trust_content (
  id VARCHAR(32) NOT NULL DEFAULT 'default',
  heading VARCHAR(255) NOT NULL DEFAULT 'Trusted by Thousands',
  subtitle TEXT NULL,
  stats_json JSON NOT NULL,
  certifications_json JSON NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

INSERT INTO homepage_trust_content (
  id, heading, subtitle, stats_json, certifications_json
) VALUES (
  'default',
  'Trusted by Thousands',
  'Our commitment to security, transparency, and customer success speaks for itself',
  JSON_ARRAY(
    JSON_OBJECT('id','applications','value','50,000+','label','Applications Processed','icon','FileCheck','color','var(--color-primary)'),
    JSON_OBJECT('id','approval','value','87%','label','Average Approval Rate','icon','TrendingUp','color','var(--color-success)'),
    JSON_OBJECT('id','processing','value','48 Hours','label','Average Processing Time','icon','Clock','color','var(--color-secondary)'),
    JSON_OBJECT('id','satisfaction','value','4.8/5','label','Customer Satisfaction','icon','Star','color','var(--color-warning)')
  ),
  JSON_ARRAY(
    JSON_OBJECT('id','ssl','name','SSL Secured','icon','Lock','description','256-bit encryption'),
    JSON_OBJECT('id','pci','name','PCI Compliant','icon','CreditCard','description','Payment security'),
    JSON_OBJECT('id','iso','name','ISO 27001','icon','Shield','description','Information security'),
    JSON_OBJECT('id','gdpr','name','GDPR Compliant','icon','FileText','description','Data protection')
  )
)
ON DUPLICATE KEY UPDATE id = id;

