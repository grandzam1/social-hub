-- Catalog tables for profiles, posts, and media.
-- Primary keys stay text so existing Airtable record ids still work.
-- New ids are generated as "rec" plus 14 hex characters.

create extension if not exists pgcrypto;

create or replace function catalog_rec_id()
returns text
language sql
volatile
as $$
  select 'rec' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
$$;

create table profiles (
  id text primary key default catalog_rec_id(),
  namespace text not null default '',
  profile_key text not null,
  handle text not null default '',
  platform text not null default '',
  fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table posts (
  id text primary key default catalog_rec_id(),
  namespace text not null default '',
  post_key text not null,
  platform text not null default '',
  author text not null default '',
  scraped text,
  fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table media (
  id text primary key default catalog_rec_id(),
  namespace text not null default '',
  media_key text not null,
  post_id text,
  slide_order integer not null default 0,
  fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index profiles_namespace_key on profiles (namespace, profile_key);
create unique index posts_namespace_key on posts (namespace, post_key);
create unique index media_namespace_key on media (namespace, media_key);

-- listMediaForPost: one lookup returns every slide of a post, in order.
create index media_post_slides on media (namespace, post_id, slide_order);

-- Scraps and Batch list the newest posts, then media and profiles.
create index posts_scraped_list on posts (namespace, scraped desc nulls last);
create index media_created_list on media (namespace, created_at desc);
create index profiles_created_list on profiles (namespace, created_at desc);
create index profiles_handle_lookup on profiles (namespace, platform, handle);
create index posts_author_lookup on posts (namespace, platform, author);

create or replace function catalog_sync_row()
returns trigger
language plpgsql
as $$
declare
  merged jsonb;
  handle_value text;
  platform_value text;
  post_link text;
begin
  if tg_op = 'UPDATE' then
    merged := coalesce(old.fields, '{}'::jsonb) || coalesce(new.fields, '{}'::jsonb);
    if tg_table_name = 'media'
      and coalesce(merged->>'Saved copy', '') = ''
      and coalesce(old.fields->>'Saved copy', '') <> '' then
      merged := jsonb_set(merged, '{Saved copy}', old.fields->'Saved copy', true);
    end if;
    new.fields := merged;
  end if;

  if tg_table_name = 'profiles' then
    handle_value := coalesce(new.fields->>'Handle', '');
    platform_value := coalesce(new.fields->>'Platform', '');
    new.handle := handle_value;
    new.platform := platform_value;
    if new.profile_key is null or new.profile_key = '' then
      if handle_value <> '' and platform_value <> '' then
        new.profile_key := platform_value || ':' || handle_value;
      else
        new.profile_key := new.id;
      end if;
    end if;
  elsif tg_table_name = 'posts' then
    new.platform := coalesce(new.fields->>'Platform', '');
    new.author := coalesce(new.fields->>'Author', '');
    new.scraped := nullif(new.fields->>'Scraped', '');
    if (new.post_key is null or new.post_key = '') and coalesce(new.fields->>'Post ID', '') <> '' then
      new.post_key := new.fields->>'Post ID';
    elsif new.post_key is null or new.post_key = '' then
      new.post_key := new.id;
    end if;
  elsif tg_table_name = 'media' then
    post_link := new.fields#>>'{Post,0}';
    if post_link is not null and post_link <> '' then
      new.post_id := post_link;
    end if;
    if coalesce(new.fields->>'Order', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then
      new.slide_order := trunc((new.fields->>'Order')::numeric)::integer;
    end if;
    if (new.media_key is null or new.media_key = '') and coalesce(new.fields->>'Media ID', '') <> '' then
      new.media_key := new.fields->>'Media ID';
    elsif new.media_key is null or new.media_key = '' then
      new.media_key := new.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_sync
  before insert or update on profiles
  for each row execute function catalog_sync_row();

create trigger posts_sync
  before insert or update on posts
  for each row execute function catalog_sync_row();

create trigger media_sync
  before insert or update on media
  for each row execute function catalog_sync_row();

alter table profiles enable row level security;
alter table posts enable row level security;
alter table media enable row level security;

notify pgrst, 'reload schema';
