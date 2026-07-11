# Add Google Sign-In

This app can use Google sign-in through Supabase Auth. This is separate from Google Calendar access.

## Part 1: Create a Google OAuth Client

1. Open https://console.cloud.google.com
2. Open the same Google Cloud project you are using for Calendar.
3. Open **Google Auth platform**.
4. Open **Clients**.
5. Create or open a **Web application** client.

Under **Authorized JavaScript origins**, add your GitHub Pages origin:

```text
https://your-github-username.github.io
```

Under **Authorized redirect URIs**, add your Supabase callback URL:

```text
https://gcajyidoptusmxatlwxu.supabase.co/auth/v1/callback
```

Copy both:

- Client ID
- Client Secret

## Part 2: Enable Google Provider in Supabase

1. Open Supabase.
2. Open your project.
3. Go to **Authentication**.
4. Go to **Providers**.
5. Open **Google**.
6. Turn it on.
7. Paste the Google Client ID.
8. Paste the Google Client Secret.
9. Save.

## Part 3: Check Redirect URLs in Supabase

In Supabase:

1. Go to **Authentication**.
2. Open **URL Configuration**.
3. Site URL should be your GitHub Pages app URL.
4. Redirect URLs should include your GitHub Pages app URL.

After this, open the app and click **Sign in**, then **Continue with Google**.
