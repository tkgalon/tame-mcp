begin;

create function public.register_document_upload(p_collection_id uuid, p_name text, p_size_bytes bigint)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document_id uuid := gen_random_uuid();
  document_name text := btrim(p_name);
  extension text;
  media_type text;
  result public.documents;
begin
  if actor is null or not coalesce(public.is_web_owner(actor), false) then
    raise exception 'A web session is required.' using errcode = '42501';
  end if;

  if document_name is null or length(document_name) not between 1 and 255
    or document_name ~ '[[:cntrl:]]'
    or strpos(document_name, '/') > 0 or strpos(document_name, chr(92)) > 0
    or p_size_bytes is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'Invalid upload metadata.' using errcode = '22023';
  end if;

  extension := lower((regexp_match(document_name, '\.([^.]+)$'))[1]);
  media_type := case extension
    when 'pdf' then 'application/pdf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'txt' then 'text/plain'
    when 'md' then 'text/markdown'
    when 'markdown' then 'text/markdown'
    else null
  end;
  if media_type is null then
    raise exception 'Unsupported document type.' using errcode = '22023';
  end if;

  perform 1 from public.collections c
    where c.id = p_collection_id and c.owner_id = actor for key share;
  if not found then
    raise exception 'Collection not found.' using errcode = 'P0002';
  end if;

  insert into public.documents (id, owner_id, collection_id, name, media_type, size_bytes, storage_path)
    values (document_id, actor, p_collection_id, document_name, media_type, p_size_bytes,
      actor::text || '/' || document_id::text || '/original')
    returning * into result;
  return result;
end;
$$;

create function public.complete_document_upload(p_document_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document public.documents;
  object_metadata jsonb;
begin
  if actor is null or not coalesce(public.is_web_owner(actor), false) then
    raise exception 'A web session is required.' using errcode = '42501';
  end if;

  select * into document from public.documents d
    where d.id = p_document_id and d.owner_id = actor for update;
  if not found then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  select o.metadata into object_metadata from storage.objects o
    where o.bucket_id = 'documents' and o.name = document.storage_path;
  if not found then
    raise exception 'Uploaded object not found.' using errcode = 'P0002';
  end if;

  if (object_metadata ->> 'size') is distinct from document.size_bytes::text
    or lower(btrim(split_part(object_metadata ->> 'mimetype', ';', 1))) is distinct from document.media_type then
    raise exception 'Uploaded object does not match its registration.' using errcode = '22023';
  end if;

  -- A retry must not reset later processing states
  if document.status = 'uploading' then
    update public.documents set status = 'uploaded'
      where id = document.id and owner_id = actor returning * into document;
  end if;
  return document;
end;
$$;

revoke all on function public.register_document_upload(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.complete_document_upload(uuid) from public, anon, authenticated;
grant execute on function public.register_document_upload(uuid, text, bigint) to authenticated;
grant execute on function public.complete_document_upload(uuid) to authenticated;

commit;
