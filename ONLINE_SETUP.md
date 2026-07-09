# Put the App Online

This guide takes the prototype from "works on this computer" to "available anywhere with online sync."

## What You Need

- A Supabase account
- A GitHub account
- The files in this folder

Supabase stores your tasks, students, and notes. GitHub Pages hosts the app page.

## Part 1: Create Supabase

1. Go to https://supabase.com and create an account.
2. Create a new project.
3. Choose a project name such as `school-secretary`.
4. Save your database password somewhere safe.
5. Wait for Supabase to finish creating the project.

## Part 2: Create the Tables

1. In your Supabase project, open **SQL Editor**.
2. Create a new query.
3. Open `supabase-schema.sql` from this folder.
4. Copy all of it into the SQL Editor.
5. Run it.

This creates the tasks, students, notes, calendar events, and knowledge document tables.

## Part 3: Copy Your Supabase Keys

1. In Supabase, open **Project Settings**.
2. Open **API**.
3. Copy the project URL.
4. Copy the public anon key.
5. Open `config.js` in this app folder.
6. Paste the values like this:

```js
window.SECRETARY_CONFIG = {
  SUPABASE_URL: "https://your-project-id.supabase.co",
  SUPABASE_ANON_KEY: "your-public-anon-key"
};
```

The anon key is designed to be public in browser apps. The database stays protected by Row Level Security policies in `supabase-schema.sql`.

## Part 4: Allow Your Online App URL

After GitHub Pages gives you a website URL, add it in Supabase:

1. In Supabase, open **Authentication**.
2. Open **URL Configuration**.
3. Set the Site URL to your GitHub Pages URL.
4. Add the same URL to Redirect URLs.

Magic-link sign-in will not work correctly until this is done.

## Part 5: Publish with GitHub Pages

1. Go to https://github.com and create a new repository.
2. Upload these files from `ai-secretary-mvp`:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `supabase-schema.sql`
   - `README.md`
   - `ONLINE_SETUP.md`
3. Open the repository **Settings**.
4. Open **Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Choose your main branch and root folder.
7. Save.

GitHub will give you a public link. Open that link, sign in with your email, and the app should show **Online sync**.

## First Test

1. Open the online app.
2. Sign in with your email.
3. Add a task.
4. Open Supabase, then open **Table Editor**.
5. Check the `tasks` table.

If the task appears there, your online app is working.
