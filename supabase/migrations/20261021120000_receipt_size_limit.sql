-- 2026-10-21 owner request: receipts are limited to 7 MB. The app makes larger photos smaller before uploading
-- and refuses PDFs (or photos it can't shrink) over the limit; the bucket refuses anything larger as well.
-- Safe to run more than once. Existing receipts are not changed.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 7340032 where id = 'receipts';
  end if;
end;
$$;
