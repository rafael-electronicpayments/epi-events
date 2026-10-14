-- One-time bootstrap of the original fictional scheduling demo.
-- Do not replace a workspace that already contains scheduling data.
do $$
declare
  event_id integer;
  person_ids integer[] := '{}';
  activity_ids integer[] := '{}';
  generated_id integer;
  room_id integer;
  item jsonb;
  i integer;
  first_names text[] := string_to_array('Alex Priya Marcus Dana Jordan Sofia Ethan Maya Luis Hana Omar Chloe Ravi Nina Tomas Zoe Kwame Elena Ben Aisha Diego Leah Sam Mei Carlos',' ');
  last_names text[] := string_to_array('Rivera Shah Bell Okafor Lee Costa Nguyen Park Torres Ito Haddad Reed Patel Moore Silva Grant Mensah Rossi Cohen Khan Vega Stone Webb Chen Ortiz',' ');
  titles text[] := array['Demo Lead','Room Host','Registration','Hospitality','Room Host'];
begin
  perform 1 from public.ops_state where id=1 for update;
  if exists(select 1 from public.activity_log where action='Imported original mock schedules') then
    return;
  end if;
  if exists(select 1 from public.events) or exists(select 1 from public.people)
    or exists(select 1 from public.rooms) then
    raise exception 'Mock import requires an empty scheduling workspace. Existing data was not changed.';
  end if;

  insert into public.events(name,start_date,days) values('IMPACT27','2027-03-02',3) returning id into event_id;
  insert into public.events(name,start_date,days) values('IMPACT26','2026-11-07',6);
  insert into public.rooms(name) values ('Grand Ballroom'),('Salon 1'),('Salon 2'),('Salon 3'),('Salon 4'),('Salon 5'),('Salon 6'),('Salon 7');

  for i in 1..25 loop
    insert into public.people(name,title,account_type,phone,map_access)
      values(first_names[i] || ' ' || last_names[i],titles[((i-1)%5)+1],'staff','555-01' || (9+i),true)
      returning id into generated_id;
    person_ids := array_append(person_ids,generated_id);
  end loop;
  for item in select value from jsonb_array_elements('[
    ["Pat Quinn","AV Technician (Encore AV)"],
    ["Dr. Lena Ford","Speaker"],
    ["Vic Mercer","Entertainment"],
    ["Jo Adler","AV Technician (Encore AV)"]
  ]'::jsonb) loop
    insert into public.people(name,title,account_type,phone,map_access)
      values(item->>0,item->>1,'contractor','555-01' || (60+array_length(person_ids,1)),false)
      returning id into generated_id;
    person_ids := array_append(person_ids,generated_id);
  end loop;

  -- Mock activity positions map to generated IDs; no database IDs are assumed.
  for item in select value from jsonb_array_elements('[
    [0,"POS Lab: demo support","Salon 3",540,660,3],
    [0,"Breakout A: retail trends","Salon 5",540,660,2],
    [0,"Registration desk","Salon 1",480,720,4],
    [0,"Demo showcase","Salon 3",780,900,2],
    [0,"Partner workshop","Salon 7",780,930,2],
    [0,"Keynote rehearsal","Grand Ballroom",930,1020,3],
    [1,"Opening keynote","Grand Ballroom",540,630,5],
    [1,"Hands-on lab","Salon 2",570,660,3],
    [1,"Breakout B: payments","Salon 5",660,750,2],
    [1,"Customer panel","Salon 4",840,960,3],
    [2,"Closing workshop","Salon 6",540,660,2],
    [2,"Closing session","Grand Ballroom",690,750,4]
  ]'::jsonb) loop
    select r.id into room_id from public.rooms r where r.name=item->>2;
    insert into public.activities(event_id,room_id,title,day,start_minute,end_minute,staff_needed)
      values(event_id,room_id,item->>1,(item->>0)::integer,(item->>3)::integer,(item->>4)::integer,(item->>5)::integer)
      returning id into generated_id;
    activity_ids := array_append(activity_ids,generated_id);
  end loop;

  -- Original tuples: person index, activity index, acknowledged, checked in, tag.
  for item in select value from jsonb_array_elements('[
    [1,1,1,0,""],[2,1,1,0,""],[3,2,0,0,"changed"],
    [4,3,1,1,""],[5,3,1,1,""],[6,3,1,0,""],[2,3,1,0,""],
    [0,4,1,0,""],[9,4,1,0,""],[9,5,1,0,""],[10,5,0,0,"new"],
    [11,6,1,0,""],[8,6,1,0,""],[12,7,1,0,""],[13,7,1,0,""],
    [14,7,1,0,""],[15,7,1,0,""],[16,8,1,0,""],[20,8,1,0,""],
    [17,9,1,0,""],[18,9,1,0,""],[19,10,1,0,""],[20,10,1,0,""],
    [21,11,1,0,""],[22,11,1,0,""],[23,12,1,0,""],[24,12,1,0,""],
    [12,12,1,0,""],[25,7,1,0,""],[26,10,1,0,""],[27,12,1,0,""],
    [28,8,0,0,"new"]
  ]'::jsonb) loop
    insert into public.assignments(person_id,activity_id,acknowledged,checked_in,tag)
      values(person_ids[(item->>0)::integer+1],activity_ids[(item->>1)::integer],
        (item->>2)::integer=1,(item->>3)::integer=1,item->>4)
      returning id into generated_id;
    if (item->>2)::integer=0 then
      perform ops_private.notify_assignment(generated_id,case when item->>4='changed' then 'Changed assignment' else 'New assignment' end);
    end if;
  end loop;
  insert into public.activity_log(action,details)
    values('Imported original mock schedules','{"events":2,"people":29,"activities":12,"assignments":32}'::jsonb);
  update public.ops_state set revision=revision+1 where id=1;
end;
$$;
