-- Lead detail recordings and Apollo prospects without a revealed phone number.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_url text;
ALTER TABLE leads ALTER COLUMN phone_e164 DROP NOT NULL;
