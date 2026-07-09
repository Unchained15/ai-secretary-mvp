create table tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null check (category in ('Counselling', 'Teaching', 'Admin', 'University')),
  priority text not null check (priority in ('High', 'Medium', 'Low')),
  due_date date not null,
  status text not null default 'Open' check (status in ('Open', 'Done')),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  goal text,
  country_focus text,
  next_action text,
  deadline date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid references students(id) on delete set null,
  note_type text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  google_event_id text,
  title text not null,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  document_type text not null,
  storage_path text not null,
  extracted_text text,
  created_at timestamptz not null default now()
);

alter table tasks enable row level security;
alter table students enable row level security;
alter table notes enable row level security;
alter table calendar_events enable row level security;
alter table knowledge_documents enable row level security;

create policy "Users can read own tasks" on tasks
  for select to authenticated
  using (auth.uid() = owner_id);

create policy "Users can create own tasks" on tasks
  for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "Users can update own tasks" on tasks
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can delete own tasks" on tasks
  for delete to authenticated
  using (auth.uid() = owner_id);

create policy "Users can read own students" on students
  for select to authenticated
  using (auth.uid() = owner_id);

create policy "Users can create own students" on students
  for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "Users can update own students" on students
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can delete own students" on students
  for delete to authenticated
  using (auth.uid() = owner_id);

create policy "Users can read own notes" on notes
  for select to authenticated
  using (auth.uid() = owner_id);

create policy "Users can create own notes" on notes
  for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "Users can update own notes" on notes
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can delete own notes" on notes
  for delete to authenticated
  using (auth.uid() = owner_id);

create policy "Users can manage own calendar events" on calendar_events
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can manage own documents" on knowledge_documents
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
