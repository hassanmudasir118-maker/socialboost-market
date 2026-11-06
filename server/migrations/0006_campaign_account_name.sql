-- Name of the channel / page / profile an advertiser wants promoted (shown to
-- creators next to the link, which already lives in campaigns.content_url).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS account_name TEXT;
