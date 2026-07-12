alter table students
  add column if not exists class_name text,
  add column if not exists grade text,
  add column if not exists parent_name text,
  add column if not exists parent_email text,
  add column if not exists email text;

alter table notes
  add column if not exists student_id uuid references students(id) on delete set null;
