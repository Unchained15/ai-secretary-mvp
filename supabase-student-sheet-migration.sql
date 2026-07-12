alter table students
  add column if not exists class_name text,
  add column if not exists grade text,
  add column if not exists parent_name text,
  add column if not exists parent_email text,
  add column if not exists email text,
  add column if not exists student_status text not null default 'green';

alter table notes
  add column if not exists student_id uuid references students(id) on delete set null,
  add column if not exists follow_up_note_id uuid references notes(id) on delete set null,
  add column if not exists status_update text;
