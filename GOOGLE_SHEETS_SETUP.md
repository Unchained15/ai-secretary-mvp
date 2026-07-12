# Connect Student Google Sheet

This lets the app import student names from a Google Sheet and attach consultation notes to a student.

## Sheet Format

The first row should be headers. These header names work best:

```text
Student's name | Grade | Class | Parents Name | Parents Email | Student Email
```

The app also understands:

- `Student`, `Student Name`, or `Student's name` for name
- `Homeroom` or `Section` for class
- `Year` or `Level` for grade
- `Parents Name` for parent or guardian name
- `Parents Email` for parent or guardian email
- `Student Email`, `E-mail`, or `Mail` for student email

## Part 1: Enable Google Sheets API

1. Open https://console.cloud.google.com
2. Open the same Google Cloud project used for Calendar.
3. Go to **APIs & Services**.
4. Open **Library**.
5. Search **Google Sheets API**.
6. Click **Enable**.

## Part 2: Update API Key Restrictions

If your Google API key is restricted, edit it and allow both:

- Google Calendar API
- Google Sheets API

## Part 3: Update OAuth Scope

In Google Auth platform, make sure the app can request this scope:

```text
https://www.googleapis.com/auth/spreadsheets.readonly
```

The app now requests both Calendar read-only and Sheets read-only access.

## Part 4: Add the Sheet ID

Open your Google Sheet. The URL looks like:

```text
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
```

Copy the part between `/d/` and `/edit`.

Then open `config.js` and fill in:

```js
STUDENT_SHEET_ID: "1pbhoD4-KRtSk3WxH69FUEvtWpvfPTv7E5OPx4c9mSfE",
STUDENT_SHEET_RANGE: "'2627 All Students'!B:G"
```

If your tab is not called `Students`, change the range. For example:

```js
STUDENT_SHEET_RANGE: "Sheet1!A:D"
```

## Part 5: Update Supabase

If you already created the database tables, run this file once in Supabase SQL Editor:

```text
supabase-student-sheet-migration.sql
```

## First Test

1. Upload the updated app files to GitHub.
2. Open the online app.
3. Go to **Students**.
4. Click **Import Sheet**.
5. Approve Google Sheets access if asked.

The student cards should show name, grade, class, parent contact, and student email.
