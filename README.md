# School Secretary AI MVP

This is the first local prototype of the executive-assistant app for teaching, counselling, and school administration.

## What works now

- Daily briefing with schedule, priorities, overdue tasks, and student follow-ups
- Task database with category, priority, due date, and status
- Student follow-up tracker
- Meeting note capture
- Assistant screen that can:
  - answer "What do I need to do today?"
  - add simple tasks from natural language
  - save notes
  - draft a basic parent email

## How to open it

Open `index.html` in a browser. The prototype stores demo data in browser local storage, so it works without Supabase, OpenAI, or a login.

## Next build steps

1. Replace browser local storage with Supabase tables.
2. Add authentication.
3. Connect Google Calendar for real schedules.
4. Add OpenAI structured extraction for tasks, notes, emails, and student follow-ups.
5. Add push reminders through Firebase Cloud Messaging.
6. Package the frontend as Flutter or a mobile-ready PWA.

## Going online

Use `ONLINE_SETUP.md` for the beginner-friendly Supabase and GitHub Pages setup. After `config.js` has your Supabase project URL and public anon key, the app supports magic-link sign-in and online sync for tasks, students, and notes.
