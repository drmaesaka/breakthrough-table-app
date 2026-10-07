-- 2026-10-07 — Sunrise Network content in the app's Library.
--
-- Library now lists what is posted on Sunrise (Admin → Content), read from
-- Cause Machine's API — see lib/sunrise-library.ts. Two things the API does
-- not carry live here:
--
--   sunrise_video_links: the YouTube / Loom / Canva player for each Sunrise
--     video. Seeded below with the 81 links read from the signed-in Sunrise
--     pages on 2026-10-07; TCs add new ones in Admin → content. Service key
--     only (no policies): read and written by /api/library/sunrise and
--     /api/admin/sunrise.
--
--   groups.sunrise_group_id: which Sunrise group's posts a table sees.
--     Paired below by name where the names obviously match; TCs change it in
--     Admin → groups ("Sunrise group").
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.sunrise_video_links (
  resource_id text primary key,
  embed_url text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.sunrise_video_links enable row level security;

insert into public.sunrise_video_links (resource_id, embed_url) values
  ('86246', 'https://www.youtube-nocookie.com/embed/ZBF2PvjqcJE'),
  ('86284', 'https://www.youtube-nocookie.com/embed/JoQEY2sIMTg'),
  ('87468', 'https://www.youtube-nocookie.com/embed/GRAhYD9EWYo'),
  ('87472', 'https://www.youtube-nocookie.com/embed/b-Pn0yXL9y8'),
  ('87474', 'https://www.youtube-nocookie.com/embed/mwRH7QdFbjs'),
  ('87475', 'https://www.youtube-nocookie.com/embed/S9e1VVtFXmQ'),
  ('87477', 'https://www.youtube-nocookie.com/embed/MLyjcCKTzfc'),
  ('87479', 'https://www.youtube-nocookie.com/embed/xqLxyETmlWo'),
  ('87481', 'https://www.youtube-nocookie.com/embed/OKJImnk-gzQ'),
  ('87484', 'https://www.youtube-nocookie.com/embed/7uzynHWxn5Q'),
  ('87486', 'https://www.youtube-nocookie.com/embed/gXDMoiEkyuQ'),
  ('87488', 'https://www.youtube-nocookie.com/embed/FRiEJIEbTDo'),
  ('87490', 'https://www.youtube-nocookie.com/embed/CkL9eRJlnic'),
  ('87492', 'https://www.youtube-nocookie.com/embed/UQUHKkw7NYA'),
  ('87494', 'https://www.youtube-nocookie.com/embed/VbwpOKN-XqI'),
  ('87501', 'https://www.youtube-nocookie.com/embed/1iNR3jV4XS0'),
  ('87502', 'https://www.youtube-nocookie.com/embed/ivqfo5dXFLw'),
  ('87505', 'https://www.youtube-nocookie.com/embed/w5XpMg53K4c'),
  ('87508', 'https://www.youtube-nocookie.com/embed/UYSKW3IvZlQ'),
  ('87513', 'https://www.youtube-nocookie.com/embed/maPjqkiFBBg'),
  ('87514', 'https://www.youtube-nocookie.com/embed/_f4S83jXa40'),
  ('87516', 'https://www.youtube-nocookie.com/embed/5t-scLHEuxQ'),
  ('87960', 'https://www.youtube-nocookie.com/embed/5gLIulYvjtU'),
  ('87962', 'https://www.youtube-nocookie.com/embed/5gLIulYvjtU'),
  ('88444', 'https://www.youtube-nocookie.com/embed/NrZYOiSNbUE'),
  ('88465', 'https://www.youtube-nocookie.com/embed/5S1B7M5UnNk'),
  ('88516', 'https://www.youtube-nocookie.com/embed/5d6IZGF6nnw'),
  ('88617', 'https://www.youtube-nocookie.com/embed/NrZYOiSNbUE'),
  ('88954', 'https://www.youtube-nocookie.com/embed/Q2sixA1vPKk'),
  ('89134', 'https://www.youtube-nocookie.com/embed/MTTpFFdPAcA'),
  ('89272', 'https://www.youtube-nocookie.com/embed/NrZYOiSNbUE'),
  ('89276', 'https://www.youtube-nocookie.com/embed/IeelbDtPOr4'),
  ('89277', 'https://www.youtube-nocookie.com/embed/bLm5wmYtFp0'),
  ('89280', 'https://www.youtube-nocookie.com/embed/E44kFkyl_Y8'),
  ('89437', 'https://www.youtube-nocookie.com/embed/GszmHs8qPFE'),
  ('89532', 'https://www.youtube-nocookie.com/embed/IeelbDtPOr4'),
  ('89533', 'https://www.youtube-nocookie.com/embed/bLm5wmYtFp0'),
  ('89537', 'https://www.youtube-nocookie.com/embed/IeelbDtPOr4'),
  ('89538', 'https://www.youtube-nocookie.com/embed/bLm5wmYtFp0'),
  ('89540', 'https://www.youtube-nocookie.com/embed/LfxwCKin5Bg'),
  ('89609', 'https://www.youtube-nocookie.com/embed/eHJnEHyyN1Y'),
  ('89610', 'https://www.youtube-nocookie.com/embed/eXDNkwIeOqA'),
  ('89632', 'https://www.youtube-nocookie.com/embed/cvfhqjKLB1Q'),
  ('89633', 'https://www.youtube-nocookie.com/embed/VPyaBmPr_qM'),
  ('89645', 'https://www.loom.com/embed/dc9cddff520b4ac09fad89c76c206662'),
  ('89817', 'https://www.youtube-nocookie.com/embed/hDHx69NYXzQ'),
  ('89851', 'https://www.youtube-nocookie.com/embed/hYfbSECVUZM'),
  ('90103', 'https://www.youtube-nocookie.com/embed/mCUC3CzWvrs'),
  ('90294', 'https://www.youtube-nocookie.com/embed/Bmzk8t_8Wmc'),
  ('90473', 'https://www.loom.com/embed/88739f37ce2a4769ae956b6310e203de'),
  ('90599', 'https://www.canva.com/design/DAGcqQTSf34/8E9hwGIrLj_XAejTC2WnnQ/watch?embed'),
  ('90691', 'https://www.youtube-nocookie.com/embed/IE20cD0z8Fg'),
  ('90810', 'https://www.loom.com/embed/a138fd7c7ed444bc8fe346e83708d07f'),
  ('91093', 'https://www.youtube-nocookie.com/embed/g0rhN8U14dk'),
  ('91171', 'https://www.loom.com/embed/ecc0c129136b4b3e82f466d402ea85a1'),
  ('91208', 'https://www.youtube-nocookie.com/embed/xZJwMYeE9Ak'),
  ('91459', 'https://www.loom.com/embed/8886e176ce414881b2c66abf9459171d'),
  ('91581', 'https://www.youtube-nocookie.com/embed/Em1XDlzNwzQ'),
  ('92393', 'https://www.youtube-nocookie.com/embed/H3QhS4WDqcA'),
  ('92632', 'https://www.youtube-nocookie.com/embed/l1gXZu1i8TM'),
  ('92744', 'https://www.youtube-nocookie.com/embed/cEqZthCaMpo'),
  ('92938', 'https://www.youtube-nocookie.com/embed/hVD688Ydn0A'),
  ('92996', 'https://www.youtube-nocookie.com/embed/eiFphCHlaDk'),
  ('93061', 'https://www.youtube-nocookie.com/embed/6buJqRKDVm0'),
  ('93062', 'https://www.youtube-nocookie.com/embed/VPyaBmPr_qM'),
  ('93063', 'https://www.youtube-nocookie.com/embed/hYfbSECVUZM'),
  ('93066', 'https://www.youtube-nocookie.com/embed/tH6AyjGgcns'),
  ('93068', 'https://www.youtube-nocookie.com/embed/0q8umC3Kza0'),
  ('93069', 'https://www.youtube-nocookie.com/embed/JgQmpTiWedw'),
  ('93441', 'https://www.youtube-nocookie.com/embed/gABOJPHefPs'),
  ('93442', 'https://www.youtube-nocookie.com/embed/za5VkEFlwUs'),
  ('93675', 'https://www.youtube-nocookie.com/embed/Ptv2RQzVUuE'),
  ('94344', 'https://www.youtube-nocookie.com/embed/XihtuC_OrME'),
  ('94437', 'https://www.youtube-nocookie.com/embed/XOe6ZCYWHZ8'),
  ('94899', 'https://www.youtube-nocookie.com/embed/hbgnBv6odYM'),
  ('95921', 'https://www.youtube-nocookie.com/embed/J9mSYMH6SzI'),
  ('96705', 'https://www.youtube-nocookie.com/embed/V-GB-M87pUI'),
  ('97390', 'https://www.youtube-nocookie.com/embed/CmES1gx6Vec'),
  ('98589', 'https://www.youtube-nocookie.com/embed/RctTXhUqQWM'),
  ('99650', 'https://www.youtube-nocookie.com/embed/IBmekBDWcVQ'),
  ('99868', 'https://www.youtube-nocookie.com/embed/iGkVqeFUVNU')
on conflict (resource_id) do nothing;

alter table public.groups add column if not exists sunrise_group_id text;

update public.groups g set sunrise_group_id = m.sid
from (values
  ('7211', 'alumni group 1'), ('7133', 'bt alumni'), ('6845', 'table 14'), ('7096', 'table 28'), ('7148', 'table 29'), ('7164', 'table 30.5'), ('7167', 'table 31'), ('7208', 'table 32'), ('6842', 'table 5'), ('7027', 'table 1'), ('7027', 'lead off'), ('7027', 'lead off (table 1)'), ('6836', 'table 3'), ('6836', 'ifc table 3'), ('6836', 'infinite flight crew'), ('6836', 'infinite flight crew (table 3)'), ('6850', 'table 21'), ('6850', 'black jack'), ('6850', 'black jack (table 21)'), ('6852', 'virtual table 1'), ('6848', 'level up league')
) as m(sid, name)
where g.sunrise_group_id is null and lower(trim(g.name)) = m.name;

-- What got paired (shown in the results pane):
select name, sunrise_group_id from public.groups order by name;
