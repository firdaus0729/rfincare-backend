-- About page editable CMS content

CREATE TABLE IF NOT EXISTS about_page_content (
  id VARCHAR(32) NOT NULL DEFAULT 'default',
  hero_title VARCHAR(255) NOT NULL DEFAULT 'About Rfincare',
  hero_subtitle TEXT NULL,
  stats_json JSON NOT NULL,
  values_json JSON NOT NULL,
  story_heading VARCHAR(255) NOT NULL DEFAULT 'Our Story',
  story_paragraphs_json JSON NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

INSERT INTO about_page_content (
  id,
  hero_title,
  hero_subtitle,
  stats_json,
  values_json,
  story_heading,
  story_paragraphs_json
) VALUES (
  'default',
  'About Rfincare',
  'Empowering Indians with smart financial solutions through technology and transparency',
  JSON_ARRAY(
    JSON_OBJECT('id','customers','value','50,000+','label','Happy Customers'),
    JSON_OBJECT('id','banks','value','100+','label','Partner Banks'),
    JSON_OBJECT('id','processed','value','₹500Cr+','label','Loans Processed'),
    JSON_OBJECT('id','satisfaction','value','98%','label','Satisfaction Rate')
  ),
  JSON_ARRAY(
    JSON_OBJECT('id','mission','icon','Target','title','Our Mission','description','To simplify the loan application process and make financial services accessible to everyone across India.'),
    JSON_OBJECT('id','vision','icon','Eye','title','Our Vision','description','To become India''s most trusted digital platform for loan comparison and application processing.'),
    JSON_OBJECT('id','values','icon','Heart','title','Our Values','description','Transparency, customer-first approach, innovation, and commitment to financial inclusion.'),
    JSON_OBJECT('id','promise','icon','Shield','title','Our Promise','description','Secure, fast, and reliable loan processing with complete transparency at every step.')
  ),
  'Our Story',
  JSON_ARRAY(
    'Founded in 2020, Rfincare emerged from a simple observation: getting a loan in India was unnecessarily complicated. Multiple bank visits, endless paperwork, and lack of transparency made the process frustrating for millions.',
    'We set out to change this. By leveraging technology and building strong partnerships with leading financial institutions, we created a platform that puts customers first. Today, we help thousands of Indians find the right loan products, compare options transparently, and complete applications digitally.',
    'Our team of financial experts, technology professionals, and customer service specialists work tirelessly to ensure every customer gets personalized guidance and the best possible loan terms for their unique situation.'
  )
)
ON DUPLICATE KEY UPDATE id = id;

